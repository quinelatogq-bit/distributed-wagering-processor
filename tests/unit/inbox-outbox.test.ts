import { describe, it, expect } from 'bun:test';
import { InboxMessage, OutboxMessage } from '../../src/domain/entities/inbox-outbox';
import { WalletBalanceChanged } from '../../src/domain/events/integration-event';
import { LedgerDirection } from '../../src/domain/entities/wallet-ledger-entry';

describe('Inbox & Outbox Entities', () => {
  it('Inbox deve registrar recebimento e marcar processado', () => {
    const msg = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'sqs-consumer',
      payloadHash: 'hash-1',
    });

    expect(msg.isProcessed()).toBe(false);
    msg.markProcessed();
    expect(msg.isProcessed()).toBe(true);
  });

  it('Outbox deve enfileirar evento e calcular backoff exponencial no retry', () => {
    const event = new WalletBalanceChanged({
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      data: {
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: { amount: '10.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '90.00', currency: 'BRL' },
        walletVersion: 2,
      },
    });

    const outbox = OutboxMessage.enqueue(event);
    expect(outbox.isPending()).toBe(true);
    expect(outbox.attempts).toBe(0);

    const now = new Date();
    outbox.scheduleRetry(now);

    expect(outbox.attempts).toBe(1);
    expect(outbox.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());

    outbox.markPublished();
    expect(outbox.isPending()).toBe(false);
  });
});
