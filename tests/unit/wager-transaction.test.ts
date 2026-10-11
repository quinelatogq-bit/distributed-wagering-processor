import { describe, it, expect } from 'bun:test';
import { Money, DomainError } from '../../src/domain/value-objects/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../src/domain/entities/wager-transaction';
import { LedgerDirection } from '../../src/domain/entities/wallet-ledger-entry';

describe('WagerTransaction Entity', () => {
  const baseProps = {
    id: 'tx-1',
    providerId: 'prv-1',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'prv-1:ext-1',
    payloadHash: 'hash-abc',
    walletId: 'w-1',
    playerId: 'p-1',
    roundId: 'r-1',
    gameId: 'g-1',
    money: Money.from({ amount: '20.00', currency: 'BRL' }),
  };

  it('deve nascer em estado PENDING', () => {
    const tx = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Bet,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
  });

  it('deve exigir referência externa para REFUND e ROLLBACK', () => {
    expect(() =>
      WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
      }),
    ).toThrow(DomainError);

    expect(() =>
      WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
      }),
    ).toThrow(DomainError);
  });

  it('deve transicionar para PROCESSED e bloquear alterações após se tornar terminal', () => {
    const tx = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Bet,
    });

    tx.markProcessed(undefined);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);

    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(DomainError);
  });

  it('deve inverter a direção contábil corretamente em um ROLLBACK', () => {
    const bet = WagerTransaction.create({
      ...baseProps,
      kind: WagerTransactionKind.Bet,
    });
    expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);

    const rollback = WagerTransaction.create({
      ...baseProps,
      id: 'tx-2',
      externalTransactionId: 'ext-2',
      idempotencyKey: 'prv-1:ext-2',
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'ext-1',
    });

    expect(rollback.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
  });
});
