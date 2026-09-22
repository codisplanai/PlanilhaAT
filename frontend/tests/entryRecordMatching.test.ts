import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchEntryCfop,
  matchEntryDate,
  matchEntryRecords,
} from '../src/lib/localProcessing/entryMatching.ts';
import type { EntrySheetRecord, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

function note(overrides: Partial<ExtractedNote> = {}): ExtractedNote {
  return {
    filename: 'nota.xml',
    chaveAcesso: '',
    numeroNota: '1234',
    serie: '1',
    cnpjEmitente: '12345678000195',
    ufEmitente: 'SP',
    cnpjDestinatario: '98765432000188',
    ufDestinatario: 'BA',
    dataEmissao: '2026-01-10',
    vTotalNota: 100,
    vBcNota: 100,
    vIcmsNota: 0,
    origemExtracao: 'xml',
    rawMetadata: {},
    itens: [],
    ...overrides,
  };
}

function record(overrides: Partial<EntrySheetRecord> = {}): EntrySheetRecord {
  return {
    numeroNormalizado: '1234',
    serieNormalizada: '1',
    cnpjEmitenteNormalizado: '12345678000195',
    chaveAcessoNormalizada: '',
    dataEntrada: '2026-01-15',
    cfopNormalizado: '2102',
    ...overrides,
  };
}

test('cruza pela chave de acesso quando ela está disponível', () => {
  const chave = '1'.repeat(44);
  const alvo = record({ chaveAcessoNormalizada: chave, dataEntrada: '2026-02-02' });
  const outros = [record({ numeroNormalizado: '9999' }), alvo, record({ numeroNormalizado: '8888' })];

  assert.deepEqual(matchEntryRecords(note({ chaveAcesso: chave }), outros), [alvo]);
  assert.equal(matchEntryDate(note({ chaveAcesso: chave }), outros), '2026-02-02');
});

test('cai para emitente + número e tolera variações de série', () => {
  const records = [
    record({ serieNormalizada: '001' }),
    record({ serieNormalizada: '' }),
    record({ numeroNormalizado: '5555', serieNormalizada: '1' }),
  ];

  const matches = matchEntryRecords(note({ serie: '1' }), records);
  assert.equal(matches.length, 2);
  assert.equal(matchEntryCfop(note({ serie: '1' }), records), '2102');
});

test('não cruza quando a série diverge de fato', () => {
  const records = [record({ serieNormalizada: '2' })];
  assert.deepEqual(matchEntryRecords(note({ serie: '1' }), records), []);
});

test('ignora linhas sem emitente ou sem número, como o filtro original', () => {
  const records = [
    record({ cnpjEmitenteNormalizado: '' }),
    record({ numeroNormalizado: '' }),
  ];
  assert.deepEqual(matchEntryRecords(note(), records), []);
});

test('sem chave nem emitente utilizável, não há cruzamento', () => {
  assert.deepEqual(matchEntryRecords(note({ cnpjEmitente: '' }), [record()]), []);
  assert.deepEqual(matchEntryRecords(note({ numeroNota: '' }), [record()]), []);
  assert.deepEqual(matchEntryRecords(note(), []), []);
});

test('datas ambíguas não são adotadas automaticamente', () => {
  const records = [
    record({ dataEntrada: '2026-01-15' }),
    record({ dataEntrada: '2026-01-20', serieNormalizada: '' }),
  ];
  assert.equal(matchEntryDate(note(), records), null);
});

test('o índice reaproveitado devolve o mesmo resultado em chamadas repetidas', () => {
  const records = [record({ dataEntrada: '2026-03-01', cfopNormalizado: '2556' })];
  const target = note();

  assert.equal(matchEntryDate(target, records), '2026-03-01');
  assert.equal(matchEntryCfop(target, records), '2556');
  assert.equal(matchEntryDate(target, records), '2026-03-01');
});
