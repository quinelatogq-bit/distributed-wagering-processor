import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../mikro-orm.config';
import {
  ProcessWagerTransactionUseCase,
  ProcessWagerInput,
} from '../../src/application/use-cases/process-wager-transaction.use-case';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../src/domain/entities/wager-transaction';

describe('Teste de Concorrência Real - Cenário Obrigatório', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
    // Limpa registros anteriores de testes
    const em = orm.em.fork();
    await em.getConnection().execute('DELETE FROM outbox_messages;');
    await em.getConnection().execute('DELETE FROM wallet_ledger;');
    await em.getConnection().execute('DELETE FROM wager_transactions;');
    await em.getConnection().execute('DELETE FROM wallets;');
  });

  afterAll(async () => {
    if (orm) {
      await orm.close(true);
    }
  });

  it('deve aprovar exatamente uma aposta e rejeitar a concorrente mantendo saldo final em 20.00 BRL', async () => {
    const em = orm.em.fork();
    const walletId = crypto.randomUUID();
    const playerId = crypto.randomUUID();

    // 1. Cria carteira com 100.00 BRL
    await em.getConnection().execute(
      `INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
       VALUES (?, ?, 'BRL', 100.00, 1, NOW(), NOW())`,
      [walletId, playerId],
    );

    const useCase1 = new ProcessWagerTransactionUseCase(orm.em.fork());
    const useCase2 = new ProcessWagerTransactionUseCase(orm.em.fork());

    const bet1: ProcessWagerInput = {
      providerId: 'provider-a',
      externalTransactionId: `tx-80-a-${crypto.randomUUID()}`,
      idempotencyKey: `key-80-a-${crypto.randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'game-slots',
      kind: WagerTransactionKind.Bet,
      money: { amount: '80.00', currency: 'BRL' },
    };

    const bet2: ProcessWagerInput = {
      providerId: 'provider-a',
      externalTransactionId: `tx-80-b-${crypto.randomUUID()}`,
      idempotencyKey: `key-80-b-${crypto.randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-2',
      gameId: 'game-slots',
      kind: WagerTransactionKind.Bet,
      money: { amount: '80.00', currency: 'BRL' },
    };

    // Executa ambas em paralelo no PostgreSQL
    const results = await Promise.all([
      useCase1.execute(bet1),
      useCase2.execute(bet2),
    ]);

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

    expect(processed.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].failureCode).toBe(FailureCode.InsufficientFunds);

    // Consulta o estado no banco de dados
    const finalWallet = await em.getConnection().execute(
      `SELECT balance, version FROM wallets WHERE id = ?`,
      [walletId],
    );
    expect(Number(finalWallet[0].balance)).toBe(20.00);

    // Valida as linhas no ledger
    const ledgerRows = await em.getConnection().execute(
      `SELECT * FROM wallet_ledger WHERE wallet_id = ?`,
      [walletId],
    );
    expect(ledgerRows.length).toBe(1);
    expect(Number(ledgerRows[0].amount)).toBe(80.00);
    expect(ledgerRows[0].direction).toBe('DEBIT');
  });
});
