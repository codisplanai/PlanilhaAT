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
  assert.equal(shouldExcludeStFromTributaria('Armazém Recôncavo', withoutSt), false);
});

test('outras empresas mantêm o lançamento normal de valor pago', () => {
  for (const name of ['Comapel Comércio', 'Armazém Outros', 'Baia Ferro Feira', 'Outro Armazém Comércio']) {
    assert.equal(shouldExcludeStFromTributaria(name, withSt), false);
  }
});
