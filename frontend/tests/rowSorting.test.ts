import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRowsByEntryAndNumber } from '../src/lib/localProcessing/rowSorting.ts';
import type { LocalOutputRow } from '../src/types/localProcessing.ts';

function row(numero_nota: string, data_entrada: string | null, data_emissao: string, item_numero = 1): LocalOutputRow {
  return {
    numero_nota,
    data_entrada,
    data_emissao,
    item_numero,
  } as LocalOutputRow;
}

test('em todos os tipos, ordena por entrada e depois número numérico, nunca emissão', () => {
  const destinations = [
    'antecipacao_parcial', 'antecipacao_parcial_simples',
    'antecipacao_parcial_antecipado', 'antecipacao_parcial_antecipado_simples',
    'antecipacao_tributaria', 'antecipacao_tributaria_antecipado', 'difal',
  ];
  for (const destination of destinations) {
    const rows = [
      row('120', '2026-09-12', '2026-09-01T08:00:00'),
      row('15', '2026-09-12', '2026-09-11T08:00:00'),
      row('8', '2026-09-13', '2026-09-01T08:00:00'),
      row('5', '2026-09-12', '2026-09-10T08:00:00'),
      row('999', '2026-09-11', '2026-09-11T08:00:00'),
    ];
    sortRowsByEntryAndNumber(rows);
    assert.deepEqual(rows.map((r) => r.numero_nota), ['999', '5', '15', '120', '8'], destination);
  }
});

test('sem entrada, agrupa por dia da emissão e desempata pelo número, não pela hora', () => {
  const rows = [
    row('11', null, '2026-09-12T01:00:00'),
    row('2', null, '2026-09-12T22:00:00'),
    row('1', null, '2026-09-11T23:59:00'),
  ];
  sortRowsByEntryAndNumber(rows);
  assert.deepEqual(rows.map((r) => r.numero_nota), ['1', '2', '11']);
  assert.equal(rows[0].data_entrada, null);
});

test('desdobramentos usam número sem asterisco e mantêm a ordem dos subitens', () => {
  const rows = [
    row('10*', '2026-09-12', '2026-09-11T10:00:00', 2),
    row('11', '2026-09-12', '2026-09-10T10:00:00'),
    row('10', '2026-09-12', '2026-09-11T10:00:00', 1),
    row('9', '2026-09-12', '2026-09-12T10:00:00'),
  ];
  sortRowsByEntryAndNumber(rows);
  assert.deepEqual(rows.map((r) => r.numero_nota), ['9', '10', '10*', '11']);
});
