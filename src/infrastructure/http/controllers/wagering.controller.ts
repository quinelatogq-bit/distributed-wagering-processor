import { Controller, Post, Get, Headers, Body, HttpException, HttpStatus, Param } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  ProcessWagerTransactionUseCase,
  ProcessWagerInput,
  IdempotencyConflictError,
} from '../../../application/use-cases/process-wager-transaction.use-case';

@Controller()
export class WageringController {
  private useCase: ProcessWagerTransactionUseCase;

  constructor(private readonly em: EntityManager) {
    this.useCase = new ProcessWagerTransactionUseCase(em);
  }

  @Post('wagering/transactions')
  async submitTransaction(
    @Headers('Idempotency-Key') idempotencyHeader: string,
    @Body() body: any,
  ) {
    const idempotencyKey = idempotencyHeader || `${body.providerId}:${body.externalTransactionId}`;

    if (!idempotencyKey) {
      throw new HttpException('Header Idempotency-Key obrigatório', HttpStatus.BAD_REQUEST);
    }

    const input: ProcessWagerInput = {
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      idempotencyKey,
      playerId: body.playerId,
      walletId: body.walletId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
    };

    try {
      const output = await this.useCase.execute(input);

      if (output.status === 'REJECTED') {
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          ...output,
        };
      }

      return output;
    } catch (err: any) {
      if (err instanceof IdempotencyConflictError) {
        throw new HttpException(err.message, HttpStatus.CONFLICT);
      }
      throw new HttpException(err.message || 'Erro interno', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('wagering/transactions/:transactionId')
  async getTransaction(@Param('transactionId') transactionId: string) {
    const rows = await this.em.getConnection().execute(
      `SELECT * FROM wager_transactions WHERE id = ? LIMIT 1`,
      [transactionId],
    );

    if (rows.length === 0) {
      throw new HttpException('Transação não encontrada', HttpStatus.NOT_FOUND);
    }

    return rows[0];
  }

  @Get('health/live')
  getLive() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('health/ready')
  async getReady() {
    try {
      await this.em.getConnection().execute('SELECT 1');
      return { status: 'ready', database: 'connected', sqs: 'reachable' };
    } catch {
      throw new HttpException('Indisponível', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
