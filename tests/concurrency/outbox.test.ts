import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../mikro-orm.config';
import { OutboxPublisherWorker } from '../../src/infrastructure/messaging/outbox-publisher.worker';
import { SQSClient, ReceiveMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';

describe('Transactional Outbox Integration', () => {
  let orm: MikroORM;
  let worker: OutboxPublisherWorker;
  let sqsClient: SQSClient;
  let queueUrl: string;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
    sqsClient = new SQSClient({
      region: 'sa-east-1',
      endpoint: 'http://127.0.0.1:4566',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    const res = await sqsClient.send(
      new GetQueueUrlCommand({ QueueName: 'wager-transactions.fifo' }),
    );
    queueUrl = res.QueueUrl!;

    worker = new OutboxPublisherWorker(orm.em.fork(), queueUrl);
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  it('deve processar mensagens da outbox pendente e enviar para o SQS LocalStack', async () => {
    const em = orm.em.fork();

    const eventId = crypto.randomUUID();
    await em.getConnection().execute(
      `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
       VALUES (?, 'wallet-test-outbox', 'TestEvent', '{"test": true}'::jsonb, NOW(), 0, NOW())`,
      [eventId],
    );

    const processedCount = await worker.processPendingMessages(10);
    expect(processedCount).toBeGreaterThanOrEqual(1);

    const rows = await em.getConnection().execute(
      `SELECT published_at FROM outbox_messages WHERE id = ?`,
      [eventId],
    );
    expect(rows[0].published_at).not.toBeNull();

    const sqsResponse = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 2,
      }),
    );

    expect(sqsResponse.Messages).toBeDefined();
    expect(sqsResponse.Messages!.length).toBeGreaterThanOrEqual(1);
  });
});
