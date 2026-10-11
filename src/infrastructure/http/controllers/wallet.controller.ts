import { Controller, Post, Get, Param, Body, Query, HttpStatus, HttpException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../../domain/value-objects/money';
import { Wallet } from '../../../domain/entities/wallet';

@Controller('wallets')
export class WalletController {
  constructor(private readonly em: EntityManager) {}

  @Post()
  async createWallet(
    @Body() body: { playerId: string; initialBalance: { amount: string; currency: string } },
  ) {
    if (!body.playerId || !body.initialBalance) {
      throw new HttpException('Payload inválido', HttpStatus.BAD_REQUEST);
    }

    const money = Money.from(body.initialBalance);
    const walletId = crypto.randomUUID();

    return await this.em.transactional(async (em) => {
      // Valida conflito de playerId + currency
      const existing = await em.getConnection().execute(
        `SELECT id FROM wallets WHERE player_id = ? AND currency = ? LIMIT 1`,
        [body.playerId, money.currency],
      );

      if (existing.length > 0) {
        throw new HttpException(
          'Wallet já existente para este playerId e moeda',
          HttpStatus.CONFLICT,
        );
      }

      const { wallet, openingLedgerEntry } = Wallet.open({
        id: walletId,
        playerId: body.playerId,
        initialBalance: money,
      });

      // Grava wallet
      await em.getConnection().execute(
        `INSERT INTO wallets (id, player_id, currency, balance, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet.id,
          wallet.playerId,
          wallet.currency,
          wallet.balance.toString(),
          wallet.version,
          wallet.createdAt,
          wallet.updatedAt,
        ],
      );

      // Grava transação OPENING e ledger correspondente se saldo inicial > 0
      if (openingLedgerEntry) {
        const openingTxId = openingLedgerEntry.transactionId;
        await em.getConnection().execute(
          `INSERT INTO wager_transactions 
            (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, status, created_at, processed_at)
           VALUES (?, 'system', ?, ?, 'opening-hash', ?, ?, 'opening-round', 'system', 'OPENING', ?, ?, 'PROCESSED', NOW(), NOW())`,
          [
            openingTxId,
            `opening-${wallet.id}`,
            `system-opening:${wallet.id}`,
            wallet.id,
            wallet.playerId,
            money.toString(),
            money.currency,
          ],
        );

        await em.getConnection().execute(
          `INSERT INTO wallet_ledger (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            openingLedgerEntry.id,
            openingLedgerEntry.walletId,
            openingLedgerEntry.transactionId,
            openingLedgerEntry.direction,
            openingLedgerEntry.money.toString(),
            openingLedgerEntry.money.currency,
            openingLedgerEntry.balanceBefore.toString(),
            openingLedgerEntry.balanceAfter.toString(),
          ],
        );
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }

  @Get(':walletId')
  async getWallet(@Param('walletId') walletId: string) {
    const rows = await this.em.getConnection().execute(
      `SELECT * FROM wallets WHERE id = ? LIMIT 1`,
      [walletId],
    );

    if (rows.length === 0) {
      throw new HttpException('Wallet não encontrada', HttpStatus.NOT_FOUND);
    }

    const row = rows[0];
    return {
      id: row.id,
      playerId: row.player_id,
      balance: { amount: row.balance, currency: row.currency },
      version: Number(row.version),
    };
  }

  @Get(':walletId/ledger')
  async getLedger(
    @Param('walletId') walletId: string,
    @Query('limit') limit = '50',
  ) {
    const lim = Math.min(Number(limit) || 50, 100);
    const rows = await this.em.getConnection().execute(
      `SELECT id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at 
       FROM wallet_ledger 
       WHERE wallet_id = ? 
       ORDER BY created_at ASC 
       LIMIT ?`,
      [walletId, lim],
    );

    return {
      walletId,
      entries: rows.map((r: any) => ({
        id: r.id,
        transactionId: r.transaction_id,
        direction: r.direction,
        money: { amount: r.amount, currency: r.currency },
        balanceBefore: { amount: r.balance_before, currency: r.currency },
        balanceAfter: { amount: r.balance_after, currency: r.currency },
        createdAt: r.created_at,
      })),
    };
  }

  @Post(':walletId/reconciliation')
  async reconcile(@Param('walletId') walletId: string) {
    const walletRows = await this.em.getConnection().execute(
      `SELECT balance, currency FROM wallets WHERE id = ? LIMIT 1`,
      [walletId],
    );

    if (walletRows.length === 0) {
      throw new HttpException('Wallet não encontrada', HttpStatus.NOT_FOUND);
    }

    const walletBalance = Money.rehydrate(walletRows[0].balance, walletRows[0].currency);

    const ledgerRows = await this.em.getConnection().execute(
      `SELECT direction, amount, currency FROM wallet_ledger WHERE wallet_id = ? ORDER BY created_at ASC`,
      [walletId],
    );

    let calculated = Money.zero(walletBalance.currency);
    for (const entry of ledgerRows) {
      const entryMoney = Money.rehydrate(entry.amount, entry.currency);
      if (entry.direction === 'CREDIT') {
        calculated = calculated.add(entryMoney);
      } else {
        calculated = calculated.subtract(entryMoney);
      }
    }

    const difference = walletBalance.subtract(calculated);
    const consistent = difference.isZero();

    return {
      walletId,
      storedBalance: walletBalance.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: ledgerRows.length,
    };
  }
}
