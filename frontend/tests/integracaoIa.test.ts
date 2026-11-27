import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONNECTOR_DESKTOP_URL,
  CONNECTOR_SERVER_URL,
  DEFAULT_PLANAUT_URL,
  EMAIL_PLACEHOLDER,
  PASSWORD_PLACEHOLDER,
  buildClaudeCodeCommand,
  buildMcpJsonConfig,
  detectConnectorPlatform,
  isDefaultPlanautUrl,
  resolvePlanautUrl,
} from '../src/lib/integracaoIa.ts';

test('endereço do conector segue a base da API do site, sem barra final', () => {
  assert.equal(resolvePlanautUrl('', 'https://planaut.codisplan.com.br/'), DEFAULT_PLANAUT_URL);
  assert.equal(resolvePlanautUrl(undefined, 'https://planaut.dev.codisplan.com.br'), 'https://planaut.dev.codisplan.com.br');
  assert.equal(resolvePlanautUrl(' https://api.exemplo.com.br// ', 'https://app.exemplo.com.br'), 'https://api.exemplo.com.br');
  assert.equal(resolvePlanautUrl('/backend', 'https://app.exemplo.com.br'), 'https://app.exemplo.com.br/backend');
  assert.equal(isDefaultPlanautUrl('https://planaut.codisplan.com.br/'), true);
  assert.equal(isDefaultPlanautUrl('https://planaut.dev.codisplan.com.br'), false);
});

test('links do conector apontam sempre para a release mais recente', () => {
  assert.equal(CONNECTOR_DESKTOP_URL, 'https://github.com/codisplanai/PlanilhaAT/releases/latest/download/planaut.mcpb');
  assert.equal(CONNECTOR_SERVER_URL, 'https://github.com/codisplanai/PlanilhaAT/releases/latest/download/planaut-mcp.mjs');
});

test('plataforma pelo navegador: Windows usa PowerShell, o resto bash/zsh', () => {
  assert.equal(detectConnectorPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectConnectorPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)'), 'unix');
  assert.equal(detectConnectorPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'unix');
});

test('comando do Claude Code no PowerShell: opções antes do nome e nada de --env colado no nome', () => {
  const command = buildClaudeCodeCommand({
    platform: 'windows',
    planautUrl: DEFAULT_PLANAUT_URL,
    email: 'ana@codisplan.com.br',
  });
  assert.equal(command.includes('\n'), false);
  assert.equal(
    command,
    "claude mcp add --env 'PLANAUT_URL=https://planaut.codisplan.com.br' --env 'PLANAUT_EMAIL=ana@codisplan.com.br' "
      + `--env 'PLANAUT_SENHA=${PASSWORD_PLACEHOLDER}' --scope user --transport stdio planaut -- node 'C:\\Planaut\\planaut-mcp.mjs' 'C:\\Clientes'`,
  );
});

test('comando do Claude Code no bash/zsh: uma opção por linha e caminhos a partir de $HOME', () => {
  const command = buildClaudeCodeCommand({ platform: 'unix', planautUrl: 'https://planaut.dev.codisplan.com.br', email: "o'neil@x.com" });
  const lines = command.split('\n');
  assert.equal(lines[0], 'claude mcp add \\');
  assert.ok(lines.slice(0, -1).every((line) => line.endsWith(' \\')), 'toda linha, menos a última, continua o comando');
  assert.ok(lines.includes("  --env 'PLANAUT_EMAIL=o'\\''neil@x.com' \\"), 'aspa simples do e-mail escapada para o shell');
  assert.ok(lines.includes("  --env 'PLANAUT_URL=https://planaut.dev.codisplan.com.br' \\"));
  assert.equal(lines.at(-2), '  --scope user --transport stdio \\');
  assert.equal(lines.at(-1), '  planaut -- node "$HOME/Planaut/planaut-mcp.mjs" "$HOME/Clientes"');
});

test('JSON para outros clientes MCP é válido e escapa as barras do Windows', () => {
  const windows = JSON.parse(buildMcpJsonConfig({ platform: 'windows', planautUrl: DEFAULT_PLANAUT_URL, email: '' }));
  assert.deepEqual(windows.mcpServers.planaut, {
    command: 'node',
    args: ['C:\\Planaut\\planaut-mcp.mjs', 'C:\\Clientes'],
    env: {
      PLANAUT_URL: DEFAULT_PLANAUT_URL,
      PLANAUT_EMAIL: EMAIL_PLACEHOLDER,
      PLANAUT_SENHA: PASSWORD_PLACEHOLDER,
    },
  });
  const unix = JSON.parse(buildMcpJsonConfig({ platform: 'unix', planautUrl: DEFAULT_PLANAUT_URL, email: 'ana@x.com' }));
  assert.deepEqual(unix.mcpServers.planaut.args, ['/Users/voce/Planaut/planaut-mcp.mjs', '/Users/voce/Clientes']);
  assert.equal(unix.mcpServers.planaut.env.PLANAUT_EMAIL, 'ana@x.com');
});
