import { EntityManager } from '@mikro-orm/postgresql';
import { createHash } from 'crypto';
import { Money } from '../../domain/value-objects/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../domain/entities/wager-transaction';
import { Wallet } from '../../domain/entities/wallet';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../domain/events/integration-event';
import { OutboxMessage } from '../../domain/entities/inbox-outbox';

export interface ProcessWagerInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class ProcessWagerTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  static computeCanonicalHash(input: ProcessWagerInput): string {
    const canonicalPayload = {
      gameId: input.gameId,
      kind: input.kind,
      money: {
        amount: input.money.amount,
        currency: input.money.currency.toUpperCase(),
      },
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
      roundId: input.roundId,
      walletId: input.walletId,
    };
    return createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
  }

  async execute(input: ProcessWagerInput): Promise<ProcessWagerOutput> {
    const payloadHash = ProcessWagerTransactionUseCase.computeCanonicalHash(input);
    const parsedMoney = Money.from(input.money);

    return await this.em.transactional(async (em) => {
      // 1. Verificação de idempotência persistente
      const existingTxRaw = await em.getConnection().execute(
        `SELECT * FROM wager_transactions WHERE idempotency_key = ? LIMIT 1`,
        [input.idempotencyKey],
      );

      if (existingTxRaw.length > 0) {
        const row = existingTxRaw[0];
        if (row.payload_hash !== payloadHash) {
          throw new IdempotencyConflictError(
            'Idempotency key já utilizada com payload divergente.',
          );
        }

        const walletRows = await em.getConnection().execute(
          `SELECT balance, currency FROM wallets WHERE id = ? LIMIT 1`,
          [row.wallet_id],
        );

        return {
          transactionId: row.id,
          status: row.status as WagerTransactionStatus,
          balance: {
            amount: walletRows[0].balance,
            currency: walletRows[0].currency,
          },
          idempotentReplay: true,
          failureCode: row.failure_code,
        };
      }

      // 2. Lock pessimista da carteira: SELECT ... FOR UPDATE
      const walletLockRaw = await em.getConnection().execute(
        `SELECT * FROM wallets WHERE id = ? FOR UPDATE`,
        [input.walletId],
      );

      if (walletLockRaw.length === 0) {
        throw new Error(`Wallet ${input.walletId} não encontrada.`);
      }

      const walletRow = walletLockRaw[0];
      const wallet = Wallet.rehydrate({
        id: walletRow.id,
        playerId: walletRow.player_id,
        currency: walletRow.currency,
        balance: Money.rehydrate(walletRow.balance, walletRow.currency),
        version: Number(walletRow.version),
        createdAt: new Date(walletRow.created_at),
        updatedAt: new Date(walletRow.updated_at),
      });

      const txId = crypto.randomUUID();
      const wagerTx = WagerTransaction.create({
        id: txId,
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money: parsedMoney,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      });

      // 3. Validação de saldo para débito (BET)
      if (input.kind === WagerTransactionKind.Bet && wallet.balance.isLessThan(parsedMoney)) {
        wagerTx.reject(FailureCode.InsufficientFunds);

        await em.getConnection().execute(
          `INSERT INTO wager_transactions 
            (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, status, failure_code, created_at, processed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            wagerTx.id,
            wagerTx.providerId,
            wagerTx.externalTransactionId,
            wagerTx.idempotencyKey,
            wagerTx.payloadHash,
            wagerTx.walletId,
            wagerTx.playerId,
            wagerTx.roundId,
            wagerTx.gameId,
            wagerTx.kind,
            wagerTx.money.toString(),
            wagerTx.money.currency,
            wagerTx.status,
            wagerTx.failureCode,
          ],
        );

        const rejectEvent = new WagerTransactionRejected({
          aggregateId: wallet.id,
          correlationId: wagerTx.id,
          data: {
            transactionId: wagerTx.id,
            providerId: wagerTx.providerId,
            externalTransactionId: wagerTx.externalTransactionId,
            walletId: wallet.id,
            failureCode: FailureCode.InsufficientFunds,
          },
        });

        const outbox = OutboxMessage.enqueue(rejectEvent);
        await em.getConnection().execute(
          `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
           VALUES (?, ?, ?, ?::jsonb, ?, ?, ?)`,
          [
            outbox.id,
            outbox.aggregateId,
            outbox.eventType,
            JSON.stringify(outbox.payload),
            outbox.occurredAt,
            outbox.attempts,
            outbox.nextAttemptAt,
          ],
        );

        return {
          transactionId: wagerTx.id,
          status: WagerTransactionStatus.Rejected,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
          failureCode: FailureCode.InsufficientFunds,
        };
      }

      // 4. Execução da operação autorizada
      let ledgerEntry = null;

      if (input.kind === WagerTransactionKind.Bet) {
        const res = wallet.debit(wagerTx.id, parsedMoney);
        ledgerEntry = res.ledgerEntry;
        wagerTx.markProcessed(undefined);
      } else if (input.kind === WagerTransactionKind.Win) {
        const res = wallet.credit(wagerTx.id, parsedMoney);
        ledgerEntry = res.ledgerEntry;
        wagerTx.markProcessed(undefined);
      } else if (input.kind === WagerTransactionKind.Loss) {
        wagerTx.markProcessed(undefined);
      }

      // Atualiza a carteira
      await em.getConnection().execute(
        `UPDATE wallets SET balance = ?, version = ?, updated_at = NOW() WHERE id = ?`,
        [wallet.balance.toString(), wallet.version, wallet.id],
      );

      // Insere o registro contábil no ledger
      if (ledgerEntry) {
        await em.getConnection().execute(
          `INSERT INTO wallet_ledger (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            ledgerEntry.id,
            ledgerEntry.walletId,
            ledgerEntry.transactionId,
            ledgerEntry.direction,
            ledgerEntry.money.toString(),
            ledgerEntry.money.currency,
            ledgerEntry.balanceBefore.toString(),
            ledgerEntry.balanceAfter.toString(),
          ],
        );
      }

      // Persiste a transação finalizada
      await em.getConnection().execute(
        `INSERT INTO wager_transactions 
          (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          wagerTx.id,
          wagerTx.providerId,
          wagerTx.externalTransactionId,
          wagerTx.idempotencyKey,
          wagerTx.payloadHash,
          wagerTx.walletId,
          wagerTx.playerId,
          wagerTx.roundId,
          wagerTx.gameId,
          wagerTx.kind,
          wagerTx.money.toString(),
          wagerTx.money.currency,
          wagerTx.status,
        ],
      );

      // Enfileira os eventos na Outbox
      const processedEvent = new WagerTransactionProcessed({
        aggregateId: wallet.id,
        correlationId: wagerTx.id,
        data: {
          transactionId: wagerTx.id,
          providerId: wagerTx.providerId,
          externalTransactionId: wagerTx.externalTransactionId,
          walletId: wallet.id,
          playerId: wagerTx.playerId,
          roundId: wagerTx.roundId,
          gameId: wagerTx.gameId,
          kind: wagerTx.kind,
          status: wagerTx.status,
          money: wagerTx.money.toJSON(),
        },
      });

      const outboxProcessed = OutboxMessage.enqueue(processedEvent);
      await em.getConnection().execute(
        `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
         VALUES (?, ?, ?, ?::jsonb, ?, ?, ?)`,
        [
          outboxProcessed.id,
          outboxProcessed.aggregateId,
          outboxProcessed.eventType,
          JSON.stringify(outboxProcessed.payload),
          outboxProcessed.occurredAt,
          outboxProcessed.attempts,
          outboxProcessed.nextAttemptAt,
        ],
      );

      if (ledgerEntry) {
        const balanceEvent = new WalletBalanceChanged({
          aggregateId: wallet.id,
          correlationId: wagerTx.id,
          data: {
            walletId: wallet.id,
            transactionId: wagerTx.id,
            direction: ledgerEntry.direction,
            money: ledgerEntry.money.toJSON(),
            balanceBefore: ledgerEntry.balanceBefore.toJSON(),
            balanceAfter: ledgerEntry.balanceAfter.toJSON(),
            walletVersion: wallet.version,
          },
        });
        const outboxBalance = OutboxMessage.enqueue(balanceEvent);
        await em.getConnection().execute(
          `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at)
           VALUES (?, ?, ?, ?::jsonb, ?, ?, ?)`,
          [
            outboxBalance.id,
            outboxBalance.aggregateId,
            outboxBalance.eventType,
            JSON.stringify(outboxBalance.payload),
            outboxBalance.occurredAt,
            outboxBalance.attempts,
            outboxBalance.nextAttemptAt,
          ],
        );
      }

      return {
        transactionId: wagerTx.id,
        status: WagerTransactionStatus.Processed,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }
}
