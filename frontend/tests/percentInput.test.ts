import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPercentInput, parsePercentInput } from '../src/lib/formatters.ts';

test('converte o percentual digitado em alíquota decimal', () => {
  assert.equal(parsePercentInput('12'), 0.12);
  assert.equal(parsePercentInput('12,06'), 0.1206);
  assert.equal(parsePercentInput(' 7.5 '), 0.075);
});

test('lê valores de até 1 como percentual, não como fração', () => {
  assert.equal(parsePercentInput('1'), 0.01);
  assert.equal(parsePercentInput('0,5'), 0.005);
});

test('campo vazio remove a alíquota', () => {
  assert.equal(parsePercentInput(''), null);
  assert.equal(parsePercentInput('   '), null);
});

test('recusa texto e percentuais fora de 0 a 100', () => {
  for (const value of ['abc', '-1', '100,01', '12%']) {
    assert.ok(Number.isNaN(parsePercentInput(value)), value);
  }
});

test('exibe a alíquota decimal como percentual editável', () => {
  assert.equal(formatPercentInput(0.12), '12');
  assert.equal(formatPercentInput(0.1206), '12,06');
  assert.equal(formatPercentInput(0), '0');
  assert.equal(formatPercentInput(null), '');
  assert.equal(formatPercentInput(undefined), '');
});

test('reabrir e salvar a empresa não altera a alíquota gravada', () => {
  for (const stored of [0.12, 0.1206, 0.07, 0.01, 0.005, 0]) {
    assert.equal(parsePercentInput(formatPercentInput(stored)), stored, String(stored));
  }
});
