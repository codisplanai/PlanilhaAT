#!/usr/bin/env node
/**
 * Gera o conector do Planaut:
 *
 * - dist/planaut.mcpb: extensão do Claude Desktop;
 * - dist/planaut-mcp.mjs: o mesmo servidor num arquivo só, para o Claude Code
 *   e outros clientes MCP (`node planaut-mcp.mjs <pastas>`).
 *
 * 1. Empacota o servidor e o motor fiscal do site num único server/index.js (esbuild).
 * 2. Monta o manifest.json a partir de manifest.base.json, com a lista de
 *    ferramentas lida do próprio servidor (nunca fica desatualizada).
 * 3. Valida e compacta com o CLI oficial do MCPB.
 *
 * A versão vem de PLANAUT_MCP_VERSION (a release do site define a mesma
 * versão do Planaut); sem ela, usa a do package.json.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = (process.env.PLANAUT_MCP_VERSION || pkg.version).trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Versão inválida para o conector: "${version}" (use MAJOR.MINOR.PATCH).`);
  process.exit(1);
}
const stage = path.join(root, 'build', 'mcpb');
const dist = path.join(root, 'dist');
const mcpbCli = path.join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'server'), { recursive: true });
fs.mkdirSync(dist, { recursive: true });

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  // Dependências CommonJS (xmldom) dentro de um bundle ESM precisam de require.
  banner: { js: "import { createRequire as __planautCreateRequire } from 'node:module';\nconst require = __planautCreateRequire(import.meta.url);" },
  // A versão fica gravada no arquivo: o processo do cliente MCP não define a variável.
  define: { 'process.env.PLANAUT_MCP_VERSION': JSON.stringify(version) },
};

await build({
  ...shared,
  entryPoints: [path.join(root, 'src', 'index.ts')],
  outfile: path.join(stage, 'server', 'index.js'),
});

// Lista das ferramentas para o manifesto, lida do servidor real.
const probeFile = path.join(root, 'build', 'probe.mjs');
await build({
  ...shared,
  stdin: {
    contents: [
      "import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';",
      "import { Client } from '@modelcontextprotocol/sdk/client/index.js';",
      "import { createPlanautServer } from './src/server.ts';",
      'export async function listTools() {',
      "  const { server } = createPlanautServer({ baseUrl: 'https://localhost', email: null, senha: null, pastasPermitidas: [], pastaSaidaPadrao: null });",
      '  const [a, b] = InMemoryTransport.createLinkedPair();',
      "  const client = new Client({ name: 'build', version: '1' });",
      '  await Promise.all([server.connect(b), client.connect(a)]);',
      '  const { tools } = await client.listTools();',
      '  await client.close();',
      '  return tools;',
      '}',
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'probe.ts',
    loader: 'ts',
  },
  outfile: probeFile,
});
const { listTools } = await import(pathToFileURL(probeFile).href);
const tools = await listTools();
fs.rmSync(probeFile, { force: true });

const firstSentence = (text) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(clean);
  return (match ? match[1] : clean).slice(0, 240);
};

const base = JSON.parse(fs.readFileSync(path.join(root, 'manifest.base.json'), 'utf8'));
const manifest = {
  ...base,
  version,
  tools: tools.map((tool) => ({ name: tool.name, description: firstSentence(tool.description) })),
};
fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(stage, 'icon.png'));
fs.copyFileSync(path.join(root, 'README.md'), path.join(stage, 'README.md'));
fs.writeFileSync(
  path.join(stage, 'package.json'),
  `${JSON.stringify({ name: pkg.name, version, private: true, type: 'module' }, null, 2)}\n`,
);

function mcpb(args) {
  const result = spawnSync(process.execPath, [mcpbCli, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mcpb(['validate', path.join(stage, 'manifest.json')]);
const output = path.join(dist, 'planaut.mcpb');
fs.rmSync(output, { force: true });
mcpb(['pack', stage, output]);

// Arquivo único para o Claude Code: a extensão .mjs dispensa o package.json com "type": "module".
const standalone = path.join(dist, 'planaut-mcp.mjs');
fs.copyFileSync(path.join(stage, 'server', 'index.js'), standalone);

console.log(`\nConector ${version} (${tools.length} ferramentas):`);
console.log(`- ${path.relative(process.cwd(), output)} (Claude Desktop)`);
console.log(`- ${path.relative(process.cwd(), standalone)} (Claude Code e outros clientes MCP)`);
