import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

describe('HTTP API End-to-End Test', () => {
  let app: INestApplication;
  const baseUrl = 'http://127.0.0.1:3001';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(3001);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('deve criar wallet, apostar, checar ledger e reconciliar com 100% de consistência', async () => {
    const playerId = crypto.randomUUID();

    // 1. Criar Wallet com R$ 100.00
    const createRes = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: '100.00', currency: 'BRL' },
      }),
    });
    expect(createRes.status).toBe(201);
    const walletData = await createRes.json();
    const walletId = walletData.id;

    // 2. Fazer Aposta de R$ 25.00
    const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `idemp-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        providerId: 'prv-1',
        externalTransactionId: `ext-${crypto.randomUUID()}`,
        playerId,
        walletId,
        roundId: 'r-1',
        gameId: 'fortune-tiger',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });
    expect(betRes.status).toBe(201);
    const betData = await betRes.json();
    expect(betData.status).toBe('PROCESSED');
    expect(betData.balance.amount).toBe('75.00');

    // 3. Executar Reconciliação
    const reconRes = await fetch(`${baseUrl}/wallets/${walletId}/reconciliation`, {
      method: 'POST',
    });
    expect(reconRes.status).toBe(201);
    const reconData = await reconRes.json();
    expect(reconData.consistent).toBe(true);
    expect(reconData.difference.amount).toBe('0.00');
    expect(reconData.storedBalance.amount).toBe('75.00');
    expect(reconData.calculatedBalance.amount).toBe('75.00');

    // 4. Testar Health check
    const healthRes = await fetch(`${baseUrl}/health/live`);
    expect(healthRes.status).toBe(200);
  });
});
