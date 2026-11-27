import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONNECTOR_DESKTOP_FILE,
  CONNECTOR_SERVER_FILE,
  DEFAULT_PLANAUT_URL as ENDERECO_DA_TELA,
} from '../../frontend/src/lib/integracaoIa.ts';
import { DEFAULT_PLANAUT_URL } from '../src/config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('tela Integração com IA, conector e manifesto usam o mesmo endereço padrão', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mcp', 'manifest.base.json'), 'utf8'));
  assert.equal(ENDERECO_DA_TELA, DEFAULT_PLANAUT_URL);
  assert.equal(manifest.user_config.planaut_url.default, DEFAULT_PLANAUT_URL);
});

test('os arquivos que a tela baixa são os que o build gera e a release anexa', () => {
  const build = fs.readFileSync(path.join(root, 'mcp', 'scripts', 'build.mjs'), 'utf8');
  const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  for (const file of [CONNECTOR_DESKTOP_FILE, CONNECTOR_SERVER_FILE]) {
    assert.ok(build.includes(`'${file}'`), `build.mjs gera ${file}`);
    assert.ok(release.includes(`connector/${file}`), `release.yml anexa ${file}`);
  }
});
