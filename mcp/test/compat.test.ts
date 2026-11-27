import assert from 'node:assert/strict';
import test from 'node:test';

import { readZip } from '../../frontend/src/lib/localProcessing/zip.ts';
import { installDecompressionFallback } from '../src/compat.ts';
import { installNodeDom } from '../src/dom.ts';
import { templateBytes } from './helpers.ts';

installNodeDom();

test('fallback de DecompressionStream sobre zlib lê o XLSX como o nativo', async () => {
  const bytes = templateBytes('modelo_padrao_antecipacao_parcial.xlsx');
  const nativeEntries = await readZip(bytes.slice(0));
  installDecompressionFallback(true);
  const fallbackEntries = await readZip(bytes.slice(0));
  assert.deepEqual([...fallbackEntries.keys()].sort(), [...nativeEntries.keys()].sort());
  const sheet = [...nativeEntries.keys()].find((name) => name.startsWith('xl/worksheets/'))!;
  assert.deepEqual(fallbackEntries.get(sheet), nativeEntries.get(sheet));
});
