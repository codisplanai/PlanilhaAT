import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldExcludeStFromTributaria } from '../src/lib/localProcessing/stTributariaExclusion.ts';

const withSt = { vStNota: 0.01, itens: [{ vIcmsSt: 0 }] };
const withoutSt = { vStNota: 0, itens: [{ vIcmsSt: 0 }] };

for (const company of [
  'Armazém Comércio',
  'ARMAZEM COMERCIO LTDA',
  'Armazém Recôncavo',
  'ARMAZEM RECONCAVO COMERCIO LTDA',
  'Baia Ferro Salvador',
  'BAÍA FERRO SALVADOR LTDA',
  'Casa VIP',
  'CASA VIP COMERCIO LTDA',
  'Baía Ferro FSA',
  'BAIA FERRO FSA LTDA',
]) {
  test(`exclui Tributária com vST para ${company}`, () => {
    assert.equal(shouldExcludeStFromTributaria(company, withSt), true);
  });
}

test('exclui a nota inteira se somente um item apresenta vICMSST', () => {
  assert.equal(shouldExcludeStFromTributaria('Armazém Comércio', {
    vStNota: 0,
    itens: [{ vIcmsSt: 0 }, { vIcmsSt: 0.01 }, { vIcmsSt: 0 }],
  }), true);
});

test('não exclui sem ST positiva', () => {
  for (const company of ['Armazém Recôncavo', 'Casa VIP', 'Baia Ferro FSA']) {
    assert.equal(shouldExcludeStFromTributaria(company, withoutSt), false);
  }
});

test('novas empresas excluem quando ST consta somente nos itens', () => {
  const itemStOnly = { vStNota: 0, itens: [{ vIcmsSt: 0 }, { vIcmsSt: 0.01 }] };
  for (const company of ['Casa VIP', 'Baia Ferro FSA']) {
    assert.equal(shouldExcludeStFromTributaria(company, itemStOnly), true);
  }
});

test('outras empresas mantêm o lançamento normal de valor pago', () => {
  for (const name of ['Comapel Comércio', 'Armazém Outros', 'Baia Ferro Feira', 'Casa Vipera', 'Baia Ferro FS', 'Outro Armazém Comércio']) {
    assert.equal(shouldExcludeStFromTributaria(name, withSt), false);
  }
});
