import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MCP_VERSION, PlanautApi } from './api.ts';
import type { PlanautMcpConfig } from './config.ts';
import { FolderPolicy } from './files.ts';
import { GeracaoManager } from './generation.ts';
import type { ToolContext } from './tools/common.ts';
import { registerConsultaTools } from './tools/consultas.ts';
import { registerEmpresaTools } from './tools/empresas.ts';
import { registerGeracaoTools } from './tools/geracao.ts';
import { registerPerfilTools } from './tools/perfis.ts';
import { registerRegraTools } from './tools/regras.ts';
import { registerTemplateTools } from './tools/templates.ts';

export const SERVER_INSTRUCTIONS = `Planaut: sistema da contabilidade para apurar ICMS (Antecipação Parcial, Antecipação Tributária e DIFAL) a partir de XMLs de NF-e/CT-e e do SPED Fiscal, preenchendo os modelos oficiais de planilha.

Como trabalhar:
- Empresas seguem um perfil de regras compartilhado. Alterar uma regra muda a apuração de TODAS as empresas do perfil (e uma regra de CFOP global muda todos os perfis). Antes de criar, alterar ou excluir, mostre ao usuário o que vai mudar e peça confirmação.
- Alíquotas e percentuais nas ferramentas são sempre em percentual (20.5 = 20,5%).
- Para gerar planilhas: listar_arquivos_fiscais (descobre empresa e competência pelos XMLs/SPED) -> listar_empresas (acha o id) -> gerar_planilhas. Se vier "aguardando_decisao", apresente as pendências ao usuário e use responder_pendencias com as respostas dele. O sistema nunca adivinha em caso de ambiguidade: não decida pendências, não escolha MVA e não invente justificativas pelo usuário.
- A.ORI vem sempre do XML; a data de entrada vem do SPED ou da planilha contábil. Não proponha estimar esses valores.
- A configuração mva_revenda_antecipacao_tributaria do perfil é a política especial de MVA "passo a passo"; não a altere ao mexer na regra geral de MVA.
- Modelos de planilha: enviar_template cria uma nova versão a partir de um .xlsx do computador, copiando por padrão o mapeamento do modelo em uso. Rode primeiro com simular=true, mostre ao usuário as diferenças para o modelo em uso, as abas e o efeito, e só então envie. Colocar uma versão em uso (colocar_em_uso ou promover_template) muda as próximas gerações de todas as empresas daquela família: peça confirmação.
- As permissões são as do usuário logado no Planaut: se a API recusar por permissão, informe o usuário em vez de tentar contornar.`;

export interface PlanautServer {
  server: McpServer;
  api: PlanautApi;
  geracoes: GeracaoManager;
}

export function createPlanautServer(config: PlanautMcpConfig, fetchImpl: typeof fetch = fetch): PlanautServer {
  const server = new McpServer(
    { name: 'planaut', title: 'Planaut', version: MCP_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const api = new PlanautApi(config, fetchImpl);
  const policy = new FolderPolicy(config.pastasPermitidas);
  const geracoes = new GeracaoManager(api, policy, config.pastaSaidaPadrao);
  const context: ToolContext = { server, api, policy, geracoes };

  registerConsultaTools(context, config.pastaSaidaPadrao);
  registerEmpresaTools(context);
  registerPerfilTools(context);
  registerRegraTools(context);
  registerTemplateTools(context);
  registerGeracaoTools(context);

  return { server, api, geracoes };
}
