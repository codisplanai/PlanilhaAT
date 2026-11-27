/**
 * Dados da tela "Integração com IA": o endereço que o conector do Claude deve
 * usar, os links do conector publicado em cada release e os comandos de
 * instalação já preenchidos.
 *
 * Funções puras, sem `window`: a tela informa a origem e o endereço da API.
 */

/** Endereço padrão do conector (o mesmo de mcp/src/config.ts e do manifesto da extensão). */
export const DEFAULT_PLANAUT_URL = 'https://planaut.codisplan.com.br';

/** Cada release do site anexa o conector gerado com o mesmo motor de cálculo. */
export const CONNECTOR_RELEASE_URL = 'https://github.com/codisplanai/PlanilhaAT/releases/latest';
export const CONNECTOR_DESKTOP_FILE = 'planaut.mcpb';
export const CONNECTOR_SERVER_FILE = 'planaut-mcp.mjs';
export const CONNECTOR_DESKTOP_URL = `${CONNECTOR_RELEASE_URL}/download/${CONNECTOR_DESKTOP_FILE}`;
export const CONNECTOR_SERVER_URL = `${CONNECTOR_RELEASE_URL}/download/${CONNECTOR_SERVER_FILE}`;

export const PASSWORD_PLACEHOLDER = 'SUA_SENHA';
export const EMAIL_PLACEHOLDER = 'seu-email@escritorio.com.br';

export type ConnectorPlatform = 'windows' | 'unix';

export function detectConnectorPlatform(userAgent: string): ConnectorPlatform {
  return /windows/i.test(userAgent) ? 'windows' : 'unix';
}

/**
 * Endereço que o conector usa: a mesma base da API do site, sem `/api/v1`
 * (o conector acrescenta o prefixo, como o cliente do site).
 */
export function resolvePlanautUrl(apiBaseUrl: string | null | undefined, origin: string): string {
  const trim = (value: string) => value.trim().replace(/\/+$/, '');
  const base = trim(apiBaseUrl ?? '');
  const site = trim(origin);
  if (/^https?:\/\//i.test(base)) return base;
  if (base.startsWith('/')) return `${site}${base}`;
  return site;
}

export function isDefaultPlanautUrl(url: string): boolean {
  return url.trim().replace(/\/+$/, '').toLowerCase() === DEFAULT_PLANAUT_URL;
}

export interface ConnectorSetup {
  platform: ConnectorPlatform;
  planautUrl: string;
  email?: string | null;
}

/** Caminhos de exemplo: onde salvar o planaut-mcp.mjs e a pasta dos clientes. */
export function exampleConnectorPaths(platform: ConnectorPlatform): { server: string; pastas: string[] } {
  return platform === 'windows'
    ? { server: `C:\\Planaut\\${CONNECTOR_SERVER_FILE}`, pastas: ['C:\\Clientes'] }
    : { server: `/Users/voce/Planaut/${CONNECTOR_SERVER_FILE}`, pastas: ['/Users/voce/Clientes'] };
}

/** Aspas simples nos dois shells (PowerShell e bash/zsh): $, `, ; e & ficam literais. */
function quoteShell(value: string, platform: ConnectorPlatform): string {
  return platform === 'windows'
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function connectorEnv({ planautUrl, email }: ConnectorSetup): Record<string, string> {
  return {
    PLANAUT_URL: planautUrl,
    PLANAUT_EMAIL: email?.trim() || EMAIL_PLACEHOLDER,
    PLANAUT_SENHA: PASSWORD_PLACEHOLDER,
  };
}

/**
 * Comando do Claude Code (`claude mcp add`). As opções vêm antes do nome do
 * servidor e o `--env` aceita vários pares: se o nome viesse logo depois dele,
 * seria lido como mais um par, por isso `--scope` e `--transport` ficam no meio.
 * No Windows a sintaxe é a do PowerShell, numa linha só.
 */
export function buildClaudeCodeCommand(setup: ConnectorSetup): string {
  const { platform } = setup;
  const options = [
    ...Object.entries(connectorEnv(setup)).map(([key, value]) => `--env ${quoteShell(`${key}=${value}`, platform)}`),
    '--scope user --transport stdio',
  ];
  if (platform === 'windows') {
    const paths = exampleConnectorPaths('windows');
    const target = [paths.server, ...paths.pastas].map((value) => quoteShell(value, 'windows'));
    return ['claude mcp add', ...options, 'planaut', '--', 'node', ...target].join(' ');
  }
  return [
    'claude mcp add \\',
    ...options.map((option) => `  ${option} \\`),
    `  planaut -- node "$HOME/Planaut/${CONNECTOR_SERVER_FILE}" "$HOME/Clientes"`,
  ].join('\n');
}

/** Configuração `mcpServers` para clientes MCP configurados por JSON. */
export function buildMcpJsonConfig(setup: ConnectorSetup): string {
  const paths = exampleConnectorPaths(setup.platform);
  return JSON.stringify(
    {
      mcpServers: {
        planaut: {
          command: 'node',
          args: [paths.server, ...paths.pastas],
          env: connectorEnv(setup),
        },
      },
    },
    null,
    2,
  );
}
