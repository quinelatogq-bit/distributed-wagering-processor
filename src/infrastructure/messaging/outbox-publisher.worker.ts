import { SQSClient, SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';

export class OutboxPublisherWorker {
  private sqsClient: SQSClient;
  private queueUrl?: string;

  constructor(
    private readonly em: EntityManager,
    queueUrl?: string,
  ) {
    this.queueUrl = queueUrl;
    this.sqsClient = new SQSClient({
      region: 'sa-east-1',
      endpoint: process.env.AWS_ENDPOINT || 'http://127.0.0.1:4566',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
  }

  async getResolvedQueueUrl(): Promise<string> {
    if (this.queueUrl) return this.queueUrl;
    const res = await this.sqsClient.send(
      new GetQueueUrlCommand({ QueueName: 'wager-transactions.fifo' }),
    );
    this.queueUrl = res.QueueUrl!;
    return this.queueUrl;
  }

  async processPendingMessages(limit = 10): Promise<number> {
    const targetQueueUrl = await this.getResolvedQueueUrl();

    return await this.em.transactional(async (em) => {
      const pendingRows = await em.getConnection().execute(
        `SELECT * FROM outbox_messages 
         WHERE published_at IS NULL 
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         ORDER BY occurred_at ASC 
         LIMIT ? 
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      if (pendingRows.length === 0) {
        return 0;
      }

      for (const row of pendingRows) {
        try {
          const payloadString =
            typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);

          await this.sqsClient.send(
            new SendMessageCommand({
              QueueUrl: targetQueueUrl,
              MessageBody: payloadString,
              MessageGroupId: row.aggregate_id,
              MessageDeduplicationId: row.id,
            }),
          );

          await em.getConnection().execute(
            `UPDATE outbox_messages SET published_at = NOW() WHERE id = ?`,
            [row.id],
          );
        } catch (error) {
          console.error('Falha ao despachar evento para o SQS:', error);
          const nextAttempts = Number(row.attempts) + 1;
          const delaySeconds = Math.pow(2, nextAttempts);

          await em.getConnection().execute(
            `UPDATE outbox_messages 
             SET attempts = ?, next_attempt_at = NOW() + (? * INTERVAL '1 second') 
             WHERE id = ?`,
            [nextAttempts, delaySeconds, row.id],
          );
        }
      }

      return pendingRows.length;
    });
  }
}
