import { describe, it, expect } from 'bun:test';
import { Money, DomainError } from '../../src/domain/value-objects/money';
import { Wallet } from '../../src/domain/entities/wallet';
import { LedgerDirection } from '../../src/domain/entities/wallet-ledger-entry';

describe('Wallet Aggregate Root', () => {
  it('deve abrir uma carteira com saldo inicial e gerar registro contábil', () => {
    const initial = Money.from({ amount: '100.00', currency: 'BRL' });
    const { wallet, openingLedgerEntry } = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: initial,
    });

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(openingLedgerEntry).toBeDefined();
    expect(openingLedgerEntry?.direction).toBe(LedgerDirection.Credit);
    expect(openingLedgerEntry?.balanceAfter.toString()).toBe('100.00');
  });

  it('deve debitar valor corretamente e incrementar versão', () => {
    const { wallet } = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const debitResult = wallet.debit('tx-1', Money.from({ amount: '30.00', currency: 'BRL' }));

    expect(wallet.balance.toString()).toBe('70.00');
    expect(wallet.version).toBe(2);
    expect(debitResult.ledgerEntry.direction).toBe(LedgerDirection.Debit);
    expect(debitResult.ledgerEntry.balanceBefore.toString()).toBe('100.00');
    expect(debitResult.ledgerEntry.balanceAfter.toString()).toBe('70.00');
  });

  it('deve rejeitar débito se saldo for insuficiente (invariante: saldo nunca negativo)', () => {
    const { wallet } = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    expect(() => {
      wallet.debit('tx-1', Money.from({ amount: '50.01', currency: 'BRL' }));
    }).toThrow(DomainError);

    // Saldo e versão permanecem intactos
    expect(wallet.balance.toString()).toBe('50.00');
    expect(wallet.version).toBe(1);
  });
});
