import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import dotenv from 'dotenv';
import { createKafka } from '../kafka-client.js';
import { FLIGHT_TOPIC } from '../topics.js';

dotenv.config();

const kafka = createKafka('streampulse-os-worker');
const consumer = kafka.consumer({ groupId: 'opensearch-group' });

const osClient = new OpenSearchClient({ node: process.env.OPENSEARCH_NODE || 'http://localhost:9200' });

async function runOpenSearchConsumer() {
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: FLIGHT_TOPIC, fromBeginning: false });
    console.log(`[OPENSEARCH WORKER]: Listening to Kafka topic "${FLIGHT_TOPIC}" (Group: opensearch-group)...`);

    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        const bulkBody = [];
        for (const message of batch.messages) {
          try {
            const flight = JSON.parse(message.value.toString());
            if (typeof flight.icao24 !== 'string' || !flight.icao24) {
              throw new Error('Flight message is missing its aircraft ID.');
            }
            bulkBody.push({ index: { _index: 'flight-positions', _id: flight.icao24 } }, flight);
          } catch (error) {
            console.error('[OPENSEARCH] Invalid flight message:', error.message);
          }
        }

        if (bulkBody.length > 0) {
          const response = await osClient.bulk({ body: bulkBody });
          if (response.body.errors) {
            const failures = response.body.items
              .filter((item) => item.index?.error)
              .slice(0, 5)
              .map((item) => item.index.error);
            console.error(`[OPENSEARCH] Bulk indexing failed for ${response.body.items.filter((item) => item.index?.error).length} flights.`, failures);
            throw new Error('OpenSearch rejected one or more flight documents.');
          }
        }

        for (const message of batch.messages) resolveOffset(message.offset);
        await heartbeat();
      },
    });
  } catch (error) {
    console.error('Unable to connect to Kafka/OpenSearch services.');
    console.error('Start the required infrastructure first: docker compose up -d kafka opensearch');
    console.error(error.message || error);
    process.exit(1);
  }
}

runOpenSearchConsumer().catch((err) => {
  console.error('OpenSearch consumer failed to start:', err.message || err);
  process.exit(1);
});