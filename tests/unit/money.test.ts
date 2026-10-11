import { describe, it, expect } from 'bun:test';
import { Money, DomainError } from '../../src/domain/value-objects/money';

describe('Money Value Object', () => {
  it('deve instanciar um valor com 2 casas decimais corretamente', () => {
    const m = Money.from({ amount: '25.50', currency: 'BRL' });
    expect(m.toString()).toBe('25.50');
    expect(m.currency).toBe('BRL');
  });

  it('deve somar e subtrair mantendo exatidão sem floating point issues', () => {
    const a = Money.from({ amount: '0.10', currency: 'BRL' });
    const b = Money.from({ amount: '0.20', currency: 'BRL' });
    const sum = a.add(b);
    expect(sum.toString()).toBe('0.30');

    const sub = sum.subtract(a);
    expect(sub.toString()).toBe('0.20');
  });

  it('deve rejeitar moedas diferentes', () => {
    const brl = Money.from({ amount: '10.00', currency: 'BRL' });
    const usd = Money.from({ amount: '10.00', currency: 'USD' });
    expect(() => brl.add(usd)).toThrow(DomainError);
  });

  it('deve rejeitar entradas com mais de 2 casas decimais ou caracteres inválidos', () => {
    expect(() => Money.from({ amount: '10.555', currency: 'BRL' })).toThrow(DomainError);
    expect(() => Money.from({ amount: '1e5', currency: 'BRL' })).toThrow(DomainError);
    expect(() => Money.from({ amount: '-50.00', currency: 'BRL' })).toThrow(DomainError);
  });
});
