import sqlite3 from 'sqlite3';
import dotenv from 'dotenv';
import { createKafka } from '../kafka-client.js';
import { FLIGHT_TOPIC } from '../topics.js';

dotenv.config();

const db = new sqlite3.Database(process.env.SQLITE_DB_PATH || './streampulse.db', (err) => {
    if (err) console.error('[SQLite Error]:', err.message);
    else console.log('[SQL WORKER]: Connected to local SQLite database.');
});

const tableReady = new Promise((resolve, reject) => {
    db.run(`
        CREATE TABLE IF NOT EXISTS FlightState (
            Icao24 TEXT PRIMARY KEY,
            Callsign TEXT,
            OriginCountry TEXT,
            ObservedAt TEXT NOT NULL,
            TimePosition TEXT,
            LastContact TEXT,
            Longitude REAL,
            Latitude REAL,
            BaroAltitude REAL,
            OnGround INTEGER,
            Velocity REAL,
            TrueTrack REAL,
            VerticalRate REAL,
            GeoAltitude REAL,
            Squawk TEXT,
            Spi INTEGER,
            PositionSource TEXT,
            Category TEXT,
            Registration TEXT,
            AircraftType TEXT,
            AircraftDescription TEXT,
            Operator TEXT,
            YearBuilt TEXT,
            Emergency TEXT,
            Messages INTEGER,
            Nic INTEGER
        )
    `, (err) => err ? reject(err) : resolve());
});

const kafka = createKafka('streampulse-sql-worker');

const consumer = kafka.consumer({ groupId: 'sql-consumer-group' });

const upsertFlight = `
    INSERT INTO FlightState (
        Icao24, Callsign, OriginCountry, ObservedAt, TimePosition, LastContact,
        Longitude, Latitude, BaroAltitude, OnGround, Velocity, TrueTrack,
        VerticalRate, GeoAltitude, Squawk, Spi, PositionSource, Category,
        Registration, AircraftType, AircraftDescription, Operator, YearBuilt,
        Emergency, Messages, Nic
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(Icao24) DO UPDATE SET
        Callsign = excluded.Callsign,
        OriginCountry = excluded.OriginCountry,
        ObservedAt = excluded.ObservedAt,
        TimePosition = excluded.TimePosition,
        LastContact = excluded.LastContact,
        Longitude = excluded.Longitude,
        Latitude = excluded.Latitude,
        BaroAltitude = excluded.BaroAltitude,
        OnGround = excluded.OnGround,
        Velocity = excluded.Velocity,
        TrueTrack = excluded.TrueTrack,
        VerticalRate = excluded.VerticalRate,
        GeoAltitude = excluded.GeoAltitude,
        Squawk = excluded.Squawk,
        Spi = excluded.Spi,
        PositionSource = excluded.PositionSource,
        Category = excluded.Category,
        Registration = excluded.Registration,
        AircraftType = excluded.AircraftType,
        AircraftDescription = excluded.AircraftDescription,
        Operator = excluded.Operator,
        YearBuilt = excluded.YearBuilt,
        Emergency = excluded.Emergency,
        Messages = excluded.Messages,
        Nic = excluded.Nic
`;

function runSql(query, parameters = []) {
    return new Promise((resolve, reject) => {
        db.run(query, parameters, (err) => err ? reject(err) : resolve());
    });
}

async function ensureFlightStateColumns() {
    const columns = await new Promise((resolve, reject) => {
        db.all('PRAGMA table_info(FlightState)', (err, rows) => err ? reject(err) : resolve(rows));
    });
    const existingColumns = new Set(columns.map((column) => column.name));
    const requiredColumns = [
        ['Registration', 'TEXT'],
        ['AircraftType', 'TEXT'],
        ['AircraftDescription', 'TEXT'],
        ['Operator', 'TEXT'],
        ['YearBuilt', 'TEXT'],
        ['Emergency', 'TEXT'],
        ['Messages', 'INTEGER'],
        ['Nic', 'INTEGER'],
    ];

    for (const [name, type] of requiredColumns) {
        if (!existingColumns.has(name)) {
            await runSql(`ALTER TABLE FlightState ADD COLUMN ${name} ${type}`);
        }
    }
}

async function run() {
    await tableReady;
    await ensureFlightStateColumns();
    await consumer.connect();
    await consumer.subscribe({ topic: FLIGHT_TOPIC, fromBeginning: false });
    console.log(`[SQL WORKER]: Listening to Kafka topic "${FLIGHT_TOPIC}" (Group: sql-consumer-group)...`);

    await consumer.run({
        eachBatchAutoResolve: false,
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
            let transactionStarted = false;
            let savedCount = 0;
            try {
                await runSql('BEGIN TRANSACTION');
                transactionStarted = true;
                for (const message of batch.messages) {
                    let data;
                    try {
                        data = JSON.parse(message.value.toString());
                    } catch (err) {
                        console.error('[SQLite] Invalid flight message:', err.message);
                        continue;
                    }
                    if (!data || typeof data !== 'object' ||
                        typeof data.icao24 !== 'string' || !data.icao24 || !data.observedAt) {
                        console.error('[SQLite] Flight message is missing its aircraft ID or observation time.');
                        continue;
                    }

                    const {
                        icao24, callsign, originCountry, observedAt, timePosition, lastContact,
                        longitude, latitude, baroAltitude, onGround, velocity, trueTrack,
                        verticalRate, geoAltitude, squawk, spi, positionSource, category,
                        registration, aircraftType, aircraftDescription, operator: aircraftOperator,
                        yearBuilt, emergency, messages, nic,
                    } = data;
                    await runSql(upsertFlight, [
                        icao24, callsign ?? null, originCountry ?? null, observedAt,
                        timePosition ?? null, lastContact ?? null, longitude ?? null, latitude ?? null,
                        baroAltitude ?? null, onGround == null ? null : Number(onGround),
                        velocity ?? null, trueTrack ?? null, verticalRate ?? null, geoAltitude ?? null,
                        squawk ?? null, spi == null ? null : Number(spi),
                        positionSource ?? null, category ?? null, registration ?? null,
                        aircraftType ?? null, aircraftDescription ?? null, aircraftOperator ?? null,
                        yearBuilt ?? null, emergency ?? null, messages ?? null, nic ?? null,
                    ]);
                    savedCount++;
                    if (savedCount % 100 === 0) await heartbeat();
                }
                await runSql('COMMIT');
                transactionStarted = false;
                for (const message of batch.messages) resolveOffset(message.offset);
                await heartbeat();
                if (savedCount > 0) console.log(`[SQLite] Updated ${savedCount} flight positions.`);
            } catch (err) {
                if (transactionStarted) {
                    await runSql('ROLLBACK').catch((rollbackError) => {
                        console.error('[SQLite] Transaction rollback failed:', rollbackError.message);
                    });
                }
                console.error('[SQLite] Batch processing failed:', err.message || err);
                throw err;
            }
        },
    });
}

run().catch((error) => {
    console.error('[SQL WORKER] Failed to start:', error.message || error);
    process.exit(1);
});