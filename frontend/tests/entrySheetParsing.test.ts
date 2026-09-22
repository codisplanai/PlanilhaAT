import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { parseEntrySheet } from '../src/lib/localProcessing/xlsx.ts';
import { matchEntryDate, matchEntryRecords } from '../src/lib/localProcessing/entryMatching.ts';
import type { ExtractedNote } from '../src/lib/localProcessing/domain.ts';

test('parseEntrySheet interpreta TSV (.XLS do Prosoft) com apóstrofos e normaliza campos', async () => {
  const tsv = [
    'Consulta de Notas Fiscais de Entrada',
    'Empresa: 0095 - TESTE LTDA',
    '',
    'Número Nota\tDt.Escritur.\tSérie\tSubSér\tCFOP\tTerceiro\tUF\tChave da Nota Fiscal Eletrônica',
    "'0000002610   \t03/08/2026\t'001      \t'\t'1102  \t'44730457000127\tBA\t29260844730457000127550010000026101001791840",
    "'0000018116   \t05/08/2026\t'006      \t'\t'1202  \t'15157837000469\tBA\t29260833847666000139550060000181161818384800",
  ].join('\r\n');

  const encoder = new TextEncoder();
  const buffer = encoder.encode(tsv).buffer;

  const records = await parseEntrySheet(buffer);
  assert.equal(records.length, 2);

  const r1 = records[0];
  assert.equal(r1.numeroNormalizado, '2610');
  assert.equal(r1.dataEntrada, '2026-08-03');
  assert.equal(r1.serieNormalizada, '001');
  assert.equal(r1.cnpjEmitenteNormalizado, '44730457000127');
  assert.equal(r1.chaveAcessoNormalizada, '29260844730457000127550010000026101001791840');
  assert.equal(r1.cfopNormalizado, '1102');
});

test('parseEntrySheet carrega o arquivo real exemplo_ENTRADA.XLS se presente', async () => {
  const samplePath = 'c:/Users/Rodrigo/Downloads/exemplo_ENTRADA.XLS';
  if (!fs.existsSync(samplePath)) return;

  const buffer = fs.readFileSync(samplePath).buffer;
  const records = await parseEntrySheet(buffer);

  assert.equal(records.length, 826);

  // Nota presente na planilha
  const notaPresente: ExtractedNote = {
    filename: 'nota1.xml',
    chaveAcesso: '29260844730457000127550010000026101001791840',
    numeroNota: '2610',
    serie: '1',
    cnpjEmitente: '44730457000127',
    ufEmitente: 'BA',
    cnpjDestinatario: '00000000000100',
    ufDestinatario: 'BA',
    dataEmissao: '2026-08-01',
    vTotalNota: 100,
    vBcNota: 100,
    vIcmsNota: 0,
    origemExtracao: 'xml',
    rawMetadata: {},
    itens: [],
  };

  const dt = matchEntryDate(notaPresente, records);
  assert.equal(dt, '2026-08-03');

  // Nota ausente da planilha (deve dar entrada não confirmada / Pago Antecipadamente)
  const notaAusente: ExtractedNote = {
    filename: 'nota2.xml',
    chaveAcesso: '31260817718478000154551040028464821000000000',
    numeroNota: '2846482',
    serie: '104',
    cnpjEmitente: '99999999000199',
    ufEmitente: 'SP',
    cnpjDestinatario: '17718478000154',
    ufDestinatario: 'BA',
    dataEmissao: '2026-08-28',
    vTotalNota: 200,
    vBcNota: 200,
    vIcmsNota: 0,
    origemExtracao: 'xml',
    rawMetadata: {},
    itens: [],
  };

  const matchesAusente = matchEntryRecords(notaAusente, records);
  assert.equal(matchesAusente.length, 0);
  assert.equal(matchEntryDate(notaAusente, records), null);
});
