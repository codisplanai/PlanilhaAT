#!/usr/bin/env node
/**
 * Servidor MCP local do Planaut (transporte stdio).
 *
 * Roda no computador do usuário, iniciado pelo Claude Desktop, Claude Code ou
 * outro cliente MCP. stdout é o canal do protocolo: diagnósticos vão para stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { installNodeCompat } from './compat.ts';
import { loadConfig } from './config.ts';
import { createPlanautServer } from './server.ts';

async function main(): Promise<void> {
  // O motor fiscal usa DOMParser/XMLSerializer e DecompressionStream do navegador.
  installNodeCompat();
  // Nenhuma biblioteca pode escrever no stdout do protocolo por engano.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);

  const config = loadConfig();
  const { server } = createPlanautServer(config);
  await server.connect(new StdioServerTransport());
  console.error(
    `[planaut-mcp] conectado. Planaut: ${config.baseUrl}. Pastas liberadas: ${config.pastasPermitidas.join(' ; ')}`,
  );
}

main().catch((error) => {
  console.error('[planaut-mcp] falha ao iniciar:', error instanceof Error ? error.message : error);
  process.exit(1);
});
