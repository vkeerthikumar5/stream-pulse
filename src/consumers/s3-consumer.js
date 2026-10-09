import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createKafka } from '../kafka-client.js';
import { FLIGHT_TOPIC } from '../topics.js';

dotenv.config();

const kafka = createKafka('streampulse-s3-worker');
const consumer = kafka.consumer({ groupId: 's3-lake-group' });
const useAwsS3 = process.env.S3_USE_AWS === 'true';
const bucketName = process.env.S3_BUCKET_NAME;
if (useAwsS3 && !bucketName) {
  throw new Error('S3_BUCKET_NAME is required when S3_USE_AWS=true.');
}
const s3Client = useAwsS3 ? new S3Client({ region: process.env.AWS_REGION || 'us-east-1' }) : null;

let s3BatchBuffer = [];
const BATCH_SIZE = 10_000;

async function flushBatchToLocalLake() {
  if (s3BatchBuffer.length === 0) return;
  const batchToFlush = [...s3BatchBuffer];

  const today = new Date().toISOString().split('T')[0];
  const fileName = `batch-${Date.now()}-${process.pid}.json`;
  const body = JSON.stringify(batchToFlush, null, 2);

  try {
    if (s3Client) {
      const key = `data-lake-archive/date=${today}/${fileName}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      }));
      console.log(`[S3 DATA LAKE]: Flushed ${batchToFlush.length} flight positions to s3://${bucketName}/${key}`);
    } else {
      const dirPath = path.join(process.cwd(), 'data-lake-archive', `date=${today}`);
      const fullPath = path.join(dirPath, fileName);
      await fs.promises.mkdir(dirPath, { recursive: true });
      await fs.promises.writeFile(fullPath, body);
      console.log(`[LOCAL S3 DATA LAKE]: Flushed ${batchToFlush.length} flight positions to ${fullPath}`);
    }
    s3BatchBuffer.splice(0, batchToFlush.length);
  } catch (err) {
    console.error('[S3 DATA LAKE] Write failed:', err.message);
    throw err;
  }
}

async function runS3MockConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: FLIGHT_TOPIC, fromBeginning: false });
  console.log(`[S3 WORKER]: Listening to Kafka topic "${FLIGHT_TOPIC}" (Group: s3-lake-group)...`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      let flight;
      try {
        flight = JSON.parse(message.value.toString());
      } catch (err) {
        console.error('[S3 WORKER] Invalid flight message:', err.message);
        return;
      }
      if (!flight || typeof flight !== 'object' || typeof flight.icao24 !== 'string') {
        console.error('[S3 WORKER] Flight message is missing its aircraft ID.');
        return;
      }

      s3BatchBuffer.push(flight);
      if (s3BatchBuffer.length >= BATCH_SIZE) {
        try {
          await flushBatchToLocalLake();
        } catch (err) {
          s3BatchBuffer.pop();
          throw err;
        }
      }
    },
  });
}

runS3MockConsumer().catch((error) => {
  console.error('[S3 WORKER] Failed to start:', error.message || error);
  process.exit(1);
});