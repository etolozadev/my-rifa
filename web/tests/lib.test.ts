import { describe, expect, it } from 'vitest';
import { money, plural, timeLeft } from '../src/lib/format';
import { bookletIsFree, bookletNumbers, exactBooklet, pruneSelection, toggleNumber } from '../src/lib/selection';

describe('selection', () => {
  it('numera los talonarios de forma global', () => {
    expect(bookletNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(bookletNumbers(3, 5)).toEqual([11, 12, 13, 14, 15]);
  });

  it('reconoce cuando la selección es exactamente un talonario', () => {
    expect(exactBooklet([6, 7, 8, 9, 10], 5, 3)).toBe(2);
    expect(exactBooklet([10, 9, 8, 7, 6], 5, 3)).toBe(2);
    expect(exactBooklet([5, 6, 7, 8, 9], 5, 3)).toBeNull(); // cruza dos talonarios
    expect(exactBooklet([6, 7, 8], 5, 3)).toBeNull();
    expect(exactBooklet([16, 17, 18, 19, 20], 5, 3)).toBeNull(); // fuera de rango
  });

  it('un talonario solo es comprable completo si todos sus números están disponibles', () => {
    const numeros = [
      { n: 1, e: 'disponible' }, { n: 2, e: 'reservado' }, { n: 3, e: 'disponible' },
      { n: 4, e: 'disponible' }, { n: 5, e: 'disponible' }, { n: 6, e: 'disponible' },
    ] as const;
    const r = { numerosPorTalonario: 3, numeros: [...numeros] };
    expect(bookletIsFree(1, r)).toBe(false);
    expect(bookletIsFree(2, r)).toBe(true);
  });

  it('quita de la selección lo que ya no está disponible', () => {
    const r = { numeros: [{ n: 1, e: 'disponible' }, { n: 2, e: 'pagado' }, { n: 3, e: 'reservado' }] as any };
    expect([...pruneSelection(new Set([1, 2, 3]), r)]).toEqual([1]);
  });

  it('toggleNumber no muta el conjunto original', () => {
    const a = new Set([1]);
    const b = toggleNumber(a, 2);
    expect([...a]).toEqual([1]);
    expect([...b].sort()).toEqual([1, 2]);
    expect([...toggleNumber(b, 1)]).toEqual([2]);
  });
});

describe('format', () => {
  it('formatea pesos chilenos sin decimales', () => {
    expect(money(10000).replace(/\s/g, ' ')).toBe('$10.000');
  });
  it('calcula el tiempo restante', () => {
    const now = new Date('2026-10-01T12:00:00Z').getTime();
    expect(timeLeft('2026-10-01T11:00:00Z', now)).toBe('ya pasó');
    expect(timeLeft('2026-10-01T12:30:00Z', now)).toBe('falta menos de 1 hora');
    expect(timeLeft('2026-10-01T17:00:00Z', now)).toBe('faltan 5 horas');
    expect(timeLeft('2026-10-08T12:00:00Z', now)).toBe('faltan 7 días');
  });
  it('pluraliza', () => {
    expect(plural(1, 'número', 'números')).toBe('1 número');
    expect(plural(3, 'número', 'números')).toBe('3 números');
  });
});

describe('fechas del sorteo', () => {
  it('arma la etiqueta corta del día y la hora', async () => {
    const { dayLabel, timeLabel } = await import('../src/lib/format');
    const iso = '2026-10-21T15:30:00';
    expect(dayLabel(iso)).toBe('Miércoles 21 de octubre');
    expect(timeLabel(iso)).toBe('15:30');
  });
});
