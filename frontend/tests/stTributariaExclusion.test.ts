import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldExcludeStFromTributaria } from '../src/lib/localProcessing/stTributariaExclusion.ts';

const withSt = { vStNota: 0.01, itens: [{ vIcmsSt: 0 }] };
const withoutSt = { vStNota: 0, itens: [{ vIcmsSt: 0 }] };

for (const company of [
  'Armazém Comércio',
  'ARMAZÉM COMÉRCIO DE MATERIAIS PARA CONSTRUÇÕES E FERRAGENS LTDA',
  'Armazém Recôncavo',
  'ARMAZEM RECONCAVO COMERCIO LTDA',
  'ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA',
  'Baia Ferro Salvador',
  'BAHIA FERRO SALVADOR',
  'BAÍA FERRO SALVADOR LTDA',
  'Casa VIP',
  'CASA VIP COMÉRCIO DE PISOS E REVESTIMENTOS LTDA',
  'Baía Ferro FSA',
  'BAIA FERRO FSA LTDA',
  'BAHIA FERRO FSA LTDA',
  'Bahia Ferro Industrial',
  'BAIA FERRO INDUSTRIAL',
  'Bahia Ferro Lauro',
  'BAIA FERRO LAURO',
  'Mercal',
  'MERCAL LTDA',
  'MERCADAO SUPERMERCADO LTDA',
  'MERCADÃO SUPERMERCADO ATACADO E VAREJO LTDA',
  'Mercadão Supermecado',
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
  for (const company of [
    'Armazém Recôncavo',
    'ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA',
    'Casa VIP',
    'BAHIA FERRO FSA LTDA',
    'Bahia Ferro Industrial',
    'Bahia Ferro Lauro',
    'Mercal',
    'MERCADAO SUPERMERCADO LTDA',
  ]) {
    assert.equal(shouldExcludeStFromTributaria(company, withoutSt), false);
  }
});

test('novas empresas excluem quando ST consta somente nos itens', () => {
  const itemStOnly = { vStNota: 0, itens: [{ vIcmsSt: 0 }, { vIcmsSt: 0.01 }] };
  for (const company of [
    'ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA',
    'Casa VIP',
    'BAHIA FERRO FSA LTDA',
    'Bahia Ferro Industrial',
    'Bahia Ferro Lauro',
    'Mercal',
    'MERCADAO SUPERMERCADO LTDA',
  ]) {
    assert.equal(shouldExcludeStFromTributaria(company, itemStOnly), true);
  }
});

test('outras empresas mantêm o lançamento normal de valor pago', () => {
  for (const name of [
    'Comapel Comércio',
    'Armazém Outros',
    'Baia Ferro Feira',
    'Casa Vipera',
    'Baia Ferro FS',
    'Bahia Ferro FS',
    'Outro Armazém Comércio',
    'MERCADÃO DE CARNES CARMO LTDA',
  ]) {
    assert.equal(shouldExcludeStFromTributaria(name, withSt), false);
  }
});
