import Decimal from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class Money {
  private static readonly DECIMAL_REGEX = /^\d+(\.\d{2})?$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });
  }

  static from(props: MoneyProps): Money {
    if (!props.currency || props.currency.trim().length !== 3) {
      throw new DomainError(`Moeda inválida: ${props.currency}`);
    }

    if (!props.amount || typeof props.amount !== 'string') {
      throw new DomainError('O montante deve ser uma string decimal válida');
    }

    const trimmed = props.amount.trim();

    if (!Money.DECIMAL_REGEX.test(trimmed)) {
      throw new DomainError(
        `Formato inválido: "${props.amount}". O valor deve ter até 2 casas decimais e não aceita notação científica ou caracteres especiais.`
      );
    }

    const parsed = new Decimal(trimmed);

    if (parsed.isNaN() || !parsed.isFinite()) {
      throw new DomainError('Valor financeiro inválido');
    }

    if (parsed.isNegative()) {
      throw new DomainError('Valores negativos não são permitidos nos contratos de entrada');
    }

    return new Money(parsed, props.currency.toUpperCase());
  }

  static zero(currency: string): Money {
    return new Money(new Decimal('0.00'), currency.toUpperCase());
  }

  static rehydrate(amount: string, currency: string): Money {
    return new Money(new Decimal(amount), currency.toUpperCase());
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.value.minus(other.value);
    return new Money(result, this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        `Conflito de moedas: operação entre ${this.currency} e ${other.currency} rejeitada.`
      );
    }
  }
}
