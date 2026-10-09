import dotenv from 'dotenv';
import { createKafka } from './kafka-client.js';
import { FLIGHT_TOPIC } from './topics.js';

dotenv.config();

const kafka = createKafka('streampulse-flight-producer');
const producer = kafka.producer();
const FLIGHT_LATITUDE = Number(process.env.FLIGHT_LATITUDE || 40.7128);
const FLIGHT_LONGITUDE = Number(process.env.FLIGHT_LONGITUDE || -74.0060);
const FLIGHT_RADIUS_NM = Number(process.env.FLIGHT_RADIUS_NM || 25);
const FLIGHT_API_URL = `https://api.adsb.lol/v2/lat/${FLIGHT_LATITUDE}/lon/${FLIGHT_LONGITUDE}/dist/${FLIGHT_RADIUS_NM}`;
const POLL_INTERVAL_MS = Number(process.env.FLIGHT_POLL_INTERVAL_MS || 10_000);
const SEND_BATCH_SIZE = 500;

if (!Number.isFinite(FLIGHT_LATITUDE) || FLIGHT_LATITUDE < -90 || FLIGHT_LATITUDE > 90) {
  throw new Error('FLIGHT_LATITUDE must be a number between -90 and 90.');
}
if (!Number.isFinite(FLIGHT_LONGITUDE) || FLIGHT_LONGITUDE < -180 || FLIGHT_LONGITUDE > 180) {
  throw new Error('FLIGHT_LONGITUDE must be a number between -180 and 180.');
}
if (!Number.isFinite(FLIGHT_RADIUS_NM) || FLIGHT_RADIUS_NM < 1 || FLIGHT_RADIUS_NM > 250) {
  throw new Error('FLIGHT_RADIUS_NM must be a number between 1 and 250.');
}
if (!Number.isFinite(POLL_INTERVAL_MS) || POLL_INTERVAL_MS < 5_000) {
  throw new Error('FLIGHT_POLL_INTERVAL_MS must be a number of at least 5000.');
}

let stopping = false;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function describeError(error) {
  const cause = error?.cause;
  if (!cause) return error?.message || String(error);
  return `${error.message || 'Request failed'} (${cause.code || cause.name}: ${cause.message})`;
}

async function fetchFlightStates() {
  const response = await fetch(FLIGHT_API_URL, {
    headers: {
      'user-agent': 'stream-pulse/1.0 (+https://github.com/vkeerthikumar5/stream-pulse)',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`ADSB.lol flight request failed (${response.status}): ${await response.text()}`);
  }

  const snapshot = await response.json();
  if (!Number.isFinite(snapshot.now) || !Array.isArray(snapshot.ac)) {
    throw new Error('ADSB.lol returned an invalid flight snapshot.');
  }
  return snapshot;
}

function toFlightEvent(aircraft, observedAt) {
  if (typeof aircraft.hex !== 'string' || !aircraft.hex) return null;
  const altBaro = aircraft.alt_baro;
  const seen = Number.isFinite(aircraft.seen) ? aircraft.seen : null;
  const seenPosition = Number.isFinite(aircraft.seen_pos) ? aircraft.seen_pos : null;

  return {
    icao24: aircraft.hex,
    callsign: aircraft.flight?.trim() || null,
    originCountry: null,
    observedAt: new Date(observedAt).toISOString(),
    timePosition: seenPosition == null ? null : new Date(observedAt - seenPosition * 1_000).toISOString(),
    lastContact: seen == null ? null : new Date(observedAt - seen * 1_000).toISOString(),
    longitude: aircraft.lon ?? null,
    latitude: aircraft.lat ?? null,
    baroAltitude: Number.isFinite(altBaro) ? altBaro : null,
    onGround: altBaro === 'ground' ? true : Number.isFinite(altBaro) ? false : null,
    velocity: aircraft.gs ?? null,
    trueTrack: aircraft.track ?? null,
    verticalRate: aircraft.baro_rate ?? aircraft.geom_rate ?? null,
    geoAltitude: aircraft.alt_geom ?? null,
    squawk: aircraft.squawk ?? null,
    spi: aircraft.spi ?? null,
    positionSource: aircraft.type ?? null,
    category: aircraft.category ?? null,
    registration: aircraft.r ?? null,
    aircraftType: aircraft.t ?? null,
    aircraftDescription: aircraft.desc ?? null,
    operator: aircraft.ownop ?? null,
    yearBuilt: aircraft.year ?? null,
    emergency: aircraft.emergency ?? null,
    messages: aircraft.messages ?? null,
    nic: aircraft.nic ?? null,
  };
}

async function publishFlights(aircraft, observedAt) {
  let published = 0;
  for (let offset = 0; offset < aircraft.length; offset += SEND_BATCH_SIZE) {
    const messages = aircraft
      .slice(offset, offset + SEND_BATCH_SIZE)
      .map((item) => toFlightEvent(item, observedAt))
      .filter(Boolean)
      .map((flight) => ({
        key: flight.icao24,
        value: JSON.stringify(flight),
      }));

    if (messages.length > 0) {
      await producer.send({ topic: FLIGHT_TOPIC, messages });
      published += messages.length;
    }
  }
  return published;
}

async function runProducer() {
  await producer.connect();
  console.log(`[PRODUCER]: Connected to Kafka; polling ADSB.lol every ${POLL_INTERVAL_MS} ms.`);
  console.log(`[PRODUCER]: Tracking aircraft within ${FLIGHT_RADIUS_NM} NM of ${FLIGHT_LATITUDE}, ${FLIGHT_LONGITUDE}.`);

  while (!stopping) {
    const startedAt = Date.now();
    try {
      const snapshot = await fetchFlightStates();
      const published = await publishFlights(snapshot.ac, snapshot.now);
      console.log(`[FLIGHT FEED]: Published ${published} aircraft to "${FLIGHT_TOPIC}".`);
    } catch (error) {
      console.error(
        '[FLIGHT FEED] Poll failed:',
        `${describeError(error)}. Check outbound HTTPS access to api.adsb.lol:443; Kafka is connected.`
      );
    }

    await delay(Math.max(0, POLL_INTERVAL_MS - (Date.now() - startedAt)));
  }

  await producer.disconnect();
}

process.once('SIGINT', () => {
  stopping = true;
});
process.once('SIGTERM', () => {
  stopping = true;
});

runProducer().catch(async (error) => {
  console.error('[PRODUCER] Failed to start:', error.message || error);
  await producer.disconnect().catch((disconnectError) => {
    console.error('[PRODUCER] Failed to disconnect:', disconnectError.message || disconnectError);
  });
  process.exitCode = 1;
});
