import { Kafka } from 'kafkajs';

export function createKafka(clientId) {
  return new Kafka({
    clientId,
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
    retry: {
      initialRetryTime: 1_000,
      maxRetryTime: 30_000,
      retries: 10,
    },
  });
}
