import assert from 'node:assert/strict';
import test from 'node:test';

import { getMonthPeriod } from '../src/lib/periods.ts';

test('cobre o mês corrente de ponta a ponta', () => {
  const periodo = getMonthPeriod(0, new Date(2026, 6, 15, 10, 0, 0));
  assert.deepEqual(periodo, { start: '2026-07-01', end: '2026-07-31' });
});

test('recua para o mês anterior e atravessa a virada do ano', () => {
  assert.deepEqual(
    getMonthPeriod(-1, new Date(2026, 6, 15)),
    { start: '2026-06-01', end: '2026-06-30' },
  );
  assert.deepEqual(
    getMonthPeriod(-1, new Date(2026, 0, 10)),
    { start: '2025-12-01', end: '2025-12-31' },
  );
});

test('resolve fevereiro bissexto pelo próprio calendário', () => {
  assert.deepEqual(
    getMonthPeriod(0, new Date(2028, 1, 5)),
    { start: '2028-02-01', end: '2028-02-29' },
  );
});

test('a data local do primeiro dia não escorrega para o mês anterior', () => {
  // Meia-noite local do dia 1: era exatamente aqui que a conversão para UTC
  // devolvia o último dia do mês anterior em fusos a leste de Greenwich.
  const periodo = getMonthPeriod(0, new Date(2026, 8, 1, 0, 0, 0));
  assert.equal(periodo.start, '2026-09-01');
  assert.equal(periodo.end, '2026-09-30');
});

test('o fim nunca antecede o início', () => {
  for (let offset = -14; offset <= 14; offset += 1) {
    const { start, end } = getMonthPeriod(offset, new Date(2026, 0, 31));
    assert.ok(end >= start, `período invertido no deslocamento ${offset}`);
    assert.match(start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(end, /^\d{4}-\d{2}-\d{2}$/);
  }
});
