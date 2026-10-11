import { Money, DomainError } from '../value-objects/money';
import { WalletLedgerEntry, LedgerDirection } from './wallet-ledger-entry';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplyOperationResult {
  ledgerEntry: WalletLedgerEntry;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): { wallet: Wallet; openingLedgerEntry?: WalletLedgerEntry } {
    const now = new Date();
    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );

    let openingLedgerEntry: WalletLedgerEntry | undefined;

    // Se houver saldo inicial > 0, produz a entrada contábil de OPENING
    if (props.initialBalance.isPositive()) {
      openingLedgerEntry = WalletLedgerEntry.create({
        id: crypto.randomUUID(),
        walletId: wallet.id,
        transactionId: crypto.randomUUID(),
        direction: LedgerDirection.Credit,
        money: props.initialBalance,
        balanceBefore: Money.zero(props.initialBalance.currency),
        balanceAfter: props.initialBalance,
        createdAt: now,
      });
    }

    return { wallet, openingLedgerEntry };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(transactionId: string, amount: Money, entryId = crypto.randomUUID()): ApplyOperationResult {
    this.assertSameCurrency(amount);

    if (this._balance.isLessThan(amount)) {
      throw new DomainError('Saldo insuficiente para realizar o débito');
    }

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.subtract(amount);

    const ledgerEntry = WalletLedgerEntry.create({
      id: entryId,
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Debit,
      money: amount,
      balanceBefore,
      balanceAfter,
      createdAt: new Date(),
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date();

    return { ledgerEntry };
  }

  credit(transactionId: string, amount: Money, entryId = crypto.randomUUID()): ApplyOperationResult {
    this.assertSameCurrency(amount);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(amount);

    const ledgerEntry = WalletLedgerEntry.create({
      id: entryId,
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money: amount,
      balanceBefore,
      balanceAfter,
      createdAt: new Date(),
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = new Date();

    return { ledgerEntry };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new DomainError(
        `Moeda incompatível: a carteira opera com ${this.currency}, mas recebeu ${money.currency}`,
      );
    }
  }
}
