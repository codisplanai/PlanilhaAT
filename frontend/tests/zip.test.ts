import assert from 'node:assert/strict';
import test from 'node:test';

import { readZip, writeZip } from '../src/lib/localProcessing/zip.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('escreve e relê um pacote com várias entradas', async () => {
  const entries = new Map<string, Uint8Array>([
    ['nota-1.xml', encoder.encode('<NFe>primeira</NFe>')],
    ['pasta/nota-2.xml', encoder.encode('<NFe>segunda com acento: ção</NFe>')],
    ['vazio.txt', encoder.encode('')],
  ]);

  const lido = await readZip(writeZip(entries));

  assert.deepEqual([...lido.keys()].sort(), ['nota-1.xml', 'pasta/nota-2.xml', 'vazio.txt']);
  assert.equal(decoder.decode(lido.get('nota-1.xml')), '<NFe>primeira</NFe>');
  assert.equal(decoder.decode(lido.get('pasta/nota-2.xml')), '<NFe>segunda com acento: ção</NFe>');
  assert.equal(lido.get('vazio.txt')?.byteLength, 0);
});

test('preserva o conteúdo byte a byte', async () => {
  const payload = new Uint8Array(5000);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31) % 256;

  const lido = await readZip(writeZip(new Map([['dados.bin', payload]])));
  assert.deepEqual(lido.get('dados.bin'), payload);
});

test('recusa um arquivo que não é ZIP', async () => {
  await assert.rejects(
    () => readZip(encoder.encode('isto não é um zip').buffer as ArrayBuffer),
    /diretório central não encontrado/,
  );
});

test('recusa um pacote truncado em vez de falhar de forma opaca', async () => {
  const completo = new Uint8Array(writeZip(new Map([['nota.xml', encoder.encode('<NFe/>')]])));
  // Zera o início do primeiro cabeçalho local, mantendo o diretório central.
  const corrompido = completo.slice();
  corrompido[0] = 0;

  await assert.rejects(() => readZip(corrompido), /ZIP inválido|corrompido/);
});

test('sinaliza ZIP64 com uma mensagem acionável', async () => {
  const bytes = new Uint8Array(writeZip(new Map([['nota.xml', encoder.encode('<NFe/>')]])));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.byteLength - 22;
  view.setUint16(endOffset + 10, 0xffff, true);

  await assert.rejects(() => readZip(bytes), /ZIP64/);
});
