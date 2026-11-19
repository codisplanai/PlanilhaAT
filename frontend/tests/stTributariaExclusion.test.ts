import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldExcludeStItemFromTributaria } from '../src/lib/localProcessing/stTributariaExclusion.ts';

const withSt = { rawMetadata: { icms_st_xml: 0.01 } };
const withoutSt = { rawMetadata: { icms_st_xml: 0 } };
const paidItem = { vIcmsSt: 0.01 };
const unpaidItem = { vIcmsSt: 0 };

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
    assert.equal(shouldExcludeStItemFromTributaria(company, withSt, paidItem), true);
  });
}

test('NF-e mista: somente o item com vICMSST positivo deve ser excluído', () => {
  const note = { rawMetadata: { icms_st_xml: 0.01 } };
  assert.equal(shouldExcludeStItemFromTributaria('Armazém Comércio', note, unpaidItem), false);
  assert.equal(shouldExcludeStItemFromTributaria('Armazém Comércio', note, paidItem), true);
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
    assert.equal(shouldExcludeStItemFromTributaria(company, withoutSt, unpaidItem), false);
  }
});

test('novas empresas excluem quando ST consta somente nos itens', () => {
  const itemStOnly = { rawMetadata: { icms_st_xml: 0.01 } };
  for (const company of [
    'ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA',
    'Casa VIP',
    'BAHIA FERRO FSA LTDA',
    'Bahia Ferro Industrial',
    'Bahia Ferro Lauro',
    'Mercal',
    'MERCADAO SUPERMERCADO LTDA',
  ]) {
    assert.equal(shouldExcludeStItemFromTributaria(company, itemStOnly, paidItem), true);
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
    assert.equal(shouldExcludeStItemFromTributaria(name, withSt, paidItem), false);
  }
});

test('CFOP 6102 reclassificado para 6403 não comprova imposto pago', () => {
  assert.equal(shouldExcludeStItemFromTributaria(
    'Casa VIP', { rawMetadata: { icms_st_xml: 80 } }, { vIcmsSt: 0 },
  ), false);
});

test('SPED sem XML não pode justificar exclusão por ST', () => {
  assert.equal(shouldExcludeStItemFromTributaria(
    'Baia Ferro FSA', { rawMetadata: {} }, { vIcmsSt: 80 },
  ), false);
});

test('vST global sem vICMSST por produto não exclui item de NF-e mista', () => {
  assert.equal(shouldExcludeStItemFromTributaria(
    'Armazém Comércio', { rawMetadata: { icms_st_xml: 80 } }, { vIcmsSt: 0 },
  ), false);
});
