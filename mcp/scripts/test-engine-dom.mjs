#!/usr/bin/env node
/**
 * Roda a suíte do motor fiscal local (frontend/tests) com o DOM XML do
 * servidor MCP no lugar do polyfill mínimo dos testes.
 *
 * Garante que o motor se comporta no Node, com um parser XML completo, como
 * nos testes do navegador. Os testes são copiados para uma pasta temporária
 * dentro de frontend/ (para manter os caminhos relativos a ../storage) e a
 * pasta é removida ao final.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(here, '..');
const frontendRoot = path.resolve(mcpRoot, '..', 'frontend');
const sourceTests = path.join(frontendRoot, 'tests');
const tempTests = path.join(frontendRoot, '.tests-mcp-dom');

fs.rmSync(tempTests, { recursive: true, force: true });
fs.mkdirSync(tempTests, { recursive: true });

try {
  for (const name of fs.readdirSync(sourceTests)) {
    if (!name.endsWith('.ts')) continue;
    fs.copyFileSync(path.join(sourceTests, name), path.join(tempTests, name));
  }
  const domModule = path.relative(tempTests, path.join(mcpRoot, 'src', 'dom.ts')).split(path.sep).join('/');
  fs.writeFileSync(
    path.join(tempTests, 'domPolyfill.ts'),
    [
      '// Gerado por mcp/scripts/test-engine-dom.mjs: usa o DOM do servidor MCP.',
      `import { installNodeDom } from '${domModule.startsWith('.') ? domModule : `./${domModule}`}';`,
      '',
      'export function installDomParserPolyfill(): void {',
      '  installNodeDom();',
      '}',
      '',
    ].join('\n'),
  );

  const testFiles = fs
    .readdirSync(tempTests)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => path.join('.tests-mcp-dom', name));

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--test', ...testFiles],
    { cwd: frontendRoot, stdio: 'inherit' },
  );
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(tempTests, { recursive: true, force: true });
}
