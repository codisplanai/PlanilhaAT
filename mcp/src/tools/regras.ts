import { z } from 'zod';

import { DESTINO_CFOP_LABELS } from '../../../frontend/src/constants/domain.ts';
import {
  DESTRUCTIVE,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolContext,
  cleanUndefined,
  formatRule,
  percent,
  percentToDecimalString,
  safe,
} from './common.ts';
import { RULE_ENDPOINTS, SECOES_REGRAS } from './perfis.ts';

type Rule = Record<string, unknown>;

const SECAO_LABELS: Record<(typeof SECOES_REGRAS)[number], string> = {
  aliquotas: 'Alíquotas de destino (A.DST) por UF e NCM',
  cfop: 'Roteamento de CFOP para planilha',
  reducao: 'Reduções de alíquota por produto',
  reclassificacao: 'Reclassificação de CFOP por produto',
  exclusao: 'Exclusões de mercadoria da Antecipação Parcial',
  fcp: 'FCP (Fundo de Combate à Pobreza) por produto',
};

const SECOES_COM_EXCECAO = ['reducao', 'reclassificacao', 'fcp'] as const;

const ncmPrefixo = z.string().describe('NCM de 8 dígitos ou prefixo de 4 a 8 dígitos (ex.: 2203, 7314.31, 72142000).');
const ncm8 = z.string().describe('NCM completo de 8 dígitos.');
const cfop = z.string().describe('CFOP de 4 dígitos (ex.: 6102) ou só o sufixo de 3 dígitos (102).');
const termosComCuringa = z.array(z.string()).describe(
  'Palavras da descrição do produto; termine com * para casar pelo início da palavra (ex.: "vergalh*"). Acentos e maiúsculas são ignorados.',
);

function requireFields(body: Record<string, unknown>, fields: Record<string, string>): void {
  const missing = Object.entries(fields).filter(([key]) => body[key] === undefined || body[key] === null).map(([, label]) => label);
  if (missing.length) throw new Error(`Para criar a regra, informe: ${missing.join(', ')}.`);
}

async function saveRule(
  api: ToolContext['api'],
  endpoint: string,
  regraId: number | undefined,
  body: Record<string, unknown>,
  required: Record<string, string>,
): Promise<Record<string, unknown>> {
  if (regraId) {
    const update = { ...body };
    delete update.perfil_regras_id;
    if (Object.keys(update).length === 0) throw new Error('Nenhum campo para alterar foi informado.');
    return { acao: 'alterada', regra: formatRule(await api.put<Rule>(`${endpoint}/${regraId}`, update)) };
  }
  requireFields(body, required);
  return { acao: 'criada', regra: formatRule(await api.post<Rule>(endpoint, body)) };
}

const pct = (value: number | null | undefined) => (value === undefined || value === null ? undefined : percentToDecimalString(value));

export function registerRegraTools({ server, api }: ToolContext): void {
  server.registerTool('listar_regras', {
    title: 'Listar regras de um perfil',
    description: 'Lista as regras fiscais de um perfil, agrupadas por seção: '
      + `${SECOES_REGRAS.map((secao) => `${secao} (${SECAO_LABELS[secao]})`).join('; ')}. `
      + 'Para cfop, mostra a visão efetiva (regras globais + exceções do perfil, com a origem de cada uma). '
      + 'Alíquotas aparecem como aliquota_percentual.',
    inputSchema: {
      perfil_id: z.number().int().positive(),
      secoes: z.array(z.enum(SECOES_REGRAS)).min(1).optional().describe('Seções desejadas; sem isso, todas.'),
      ncm: z.string().optional().describe('Filtra por NCM exato (aliquotas, reducao, reclassificacao, exclusao, fcp).'),
      uf: z.string().length(2).optional().describe('Filtra por UF (aliquotas, exclusao, fcp).'),
    },
    annotations: READ_ONLY,
  }, safe(async ({ perfil_id, secoes, ncm, uf }) => {
    const alvo = secoes ?? [...SECOES_REGRAS];
    const ncmLimpo = ncm?.replace(/\D/g, '') || undefined;
    const ufLimpa = uf?.toUpperCase();
    const resultado: Record<string, unknown> = { perfil_id };
    await Promise.all(alvo.map(async (secao) => {
      let regras: Rule[];
      if (secao === 'cfop') {
        regras = await api.get<Rule[]>('/regras-cfop/efetivas', { perfil_id });
        regras = regras.map((regra) => ({
          ...regra,
          destino_descricao: DESTINO_CFOP_LABELS[regra.destino as keyof typeof DESTINO_CFOP_LABELS] ?? regra.destino,
        }));
      } else {
        const query: Record<string, string | number | undefined> = { perfil_id };
        if (ncmLimpo) query.ncm = ncmLimpo;
        if (ufLimpa && ['aliquotas', 'exclusao', 'fcp'].includes(secao)) query.uf = ufLimpa;
        regras = (await api.get<Rule[]>(RULE_ENDPOINTS[secao], query)).map(formatRule);
      }
      resultado[secao] = { descricao: SECAO_LABELS[secao], total: regras.length, regras };
    }));
    return resultado;
  }));

  server.registerTool('salvar_regra_aliquota', {
    title: 'Criar ou alterar alíquota de destino (A.DST)',
    description: 'Alíquota de destino (A.DST) do perfil por UF. Sem NCM, é a regra padrão da UF; com NCM (ou prefixo), é exceção para esses produtos. '
      + 'Sem regra_id cria (perfil_id, uf e aliquota_percentual obrigatórios); com regra_id altera só os campos enviados (ncm=null volta a ser padrão da UF). '
      + 'Afeta todas as empresas do perfil: confirme com o usuário.',
    inputSchema: {
      regra_id: z.number().int().positive().optional(),
      perfil_id: z.number().int().positive().optional(),
      uf: z.string().length(2).optional(),
      ncm: ncmPrefixo.nullable().optional(),
      aliquota_percentual: percent('A.DST.').optional(),
      descricao: z.string().nullable().optional(),
    },
    annotations: WRITE,
  }, safe(async ({ regra_id, perfil_id, uf, ncm, aliquota_percentual, descricao }) => saveRule(
    api,
    '/regras-aliquotas',
    regra_id,
    cleanUndefined({ perfil_regras_id: perfil_id, uf: uf?.toUpperCase(), ncm, aliquota: pct(aliquota_percentual), descricao }),
    { perfil_regras_id: 'perfil_id', uf: 'uf', aliquota: 'aliquota_percentual' },
  )));

  server.registerTool('salvar_regra_cfop', {
    title: 'Criar ou alterar roteamento de CFOP',
    description: 'Define para qual planilha vai o item pelo CFOP (sufixo de 3 dígitos): antecipacao_parcial, antecipacao_tributaria, difal ou ignorar. '
      + 'Sem regra_id cria uma exceção do perfil (perfil_id obrigatório). Regras globais valem para TODOS os perfis: só crie com global=true '
      + 'se o usuário pedir isso explicitamente. Com regra_id altera cfop, destino ou descrição.',
    inputSchema: {
      regra_id: z.number().int().positive().optional(),
      perfil_id: z.number().int().positive().optional(),
      global: z.boolean().default(false).describe('true cria regra padrão global (sem perfil). Exige pedido explícito do usuário.'),
      cfop: cfop.optional(),
      destino: z.enum(['antecipacao_parcial', 'antecipacao_tributaria', 'difal', 'ignorar']).optional(),
      descricao: z.string().nullable().optional(),
    },
    annotations: WRITE,
  }, safe(async ({ regra_id, perfil_id, global, cfop: cfopValue, destino, descricao }) => {
    if (!regra_id) {
      if (global && perfil_id) throw new Error('Use perfil_id OU global=true, não os dois.');
      if (!global && !perfil_id) throw new Error('Informe perfil_id (ou global=true para uma regra padrão de todos os perfis).');
      return saveRule(api, '/regras-cfop', undefined, cleanUndefined({
        perfil_regras_id: global ? null : perfil_id,
        cfop_sufixo: cfopValue,
        destino,
        descricao,
      }), { cfop_sufixo: 'cfop', destino: 'destino' });
    }
    return saveRule(api, '/regras-cfop', regra_id, cleanUndefined({ cfop_sufixo: cfopValue, destino, descricao }), {});
  }));

  server.registerTool('salvar_regra_reducao', {
    title: 'Criar ou alterar redução por produto',
    description: 'Alíquota reduzida para produtos (NCM ou prefixo + termos da descrição) na Antecipação Parcial ou na Tributária. '
      + 'Sem regra_id cria (perfil_id, ncm e aliquota_percentual obrigatórios); com regra_id altera os campos enviados. '
      + 'Listas de termos enviadas substituem as anteriores. Use adicionar_excecao_regra para descrições específicas.',
    inputSchema: {
      regra_id: z.number().int().positive().optional(),
      perfil_id: z.number().int().positive().optional(),
      ncm: ncmPrefixo.optional(),
      aliquota_percentual: percent('Alíquota reduzida.').optional(),
      escopo: z.enum(['antecipacao_parcial', 'antecipacao_tributaria']).optional().describe('Padrão: antecipacao_parcial.'),
      termos_inclusao: termosComCuringa.optional(),
      termos_exclusao: termosComCuringa.optional(),
      descricao: z.string().max(255).nullable().optional().describe('Ex.: fundamento legal.'),
    },
    annotations: WRITE,
  }, safe(async ({ regra_id, perfil_id, ncm, aliquota_percentual, escopo, termos_inclusao, termos_exclusao, descricao }) => saveRule(
    api,
    '/regras-reducao-produto',
    regra_id,
    cleanUndefined({ perfil_regras_id: perfil_id, ncm, aliquota: pct(aliquota_percentual), escopo, termos_inclusao, termos_exclusao, descricao }),
    { perfil_regras_id: 'perfil_id', ncm: 'ncm', aliquota: 'aliquota_percentual' },
  )));

  server.registerTool('salvar_regra_reclassificacao', {
    title: 'Criar ou alterar reclassificação de CFOP',
    description: 'Faz um produto (NCM + termos) assumir outro CFOP antes do roteamento, opcionalmente só quando vier com um CFOP de origem. '
      + 'Sem regra_id cria (perfil_id, ncm e cfop_destino obrigatórios); com regra_id altera os campos enviados (cfop_origem=null remove a condição).',
    inputSchema: {
      regra_id: z.number().int().positive().optional(),
      perfil_id: z.number().int().positive().optional(),
      ncm: ncm8.optional(),
      cfop_destino: cfop.optional().describe('CFOP que o item passa a ter.'),
      cfop_origem: cfop.nullable().optional().describe('Só reclassifica itens com este CFOP na nota (opcional).'),
      termos_inclusao: termosComCuringa.optional(),
      termos_exclusao: termosComCuringa.optional(),
      descricao: z.string().max(255).nullable().optional(),
    },
    annotations: WRITE,
  }, safe(async ({ regra_id, perfil_id, ncm, cfop_destino, cfop_origem, termos_inclusao, termos_exclusao, descricao }) => saveRule(
    api,
    '/regras-reclassificacao-cfop',
    regra_id,
    cleanUndefined({
      perfil_regras_id: perfil_id,
      ncm,
      cfop_destino_sufixo: cfop_destino,
      cfop_origem_sufixo: cfop_origem,
      termos_inclusao,
      termos_exclusao,
      descricao,
    }),
    { perfil_regras_id: 'perfil_id', ncm: 'ncm', cfop_destino_sufixo: 'cfop_destino' },
  )));

  server.registerTool('salvar_regra_exclusao', {
    title: 'Criar ou alterar exclusão da Antecipação Parcial',
    description: 'Tira da Antecipação Parcial mercadorias (NCM + palavras obrigatórias na descrição) por isenção ou por imposto pago na entrada. '
      + 'Os termos são palavras inteiras, sem curinga. Sem regra_id cria (perfil_id, ncm, termos_obrigatorios e motivo obrigatórios); '
      + 'com regra_id altera os campos enviados (ativo=false desliga sem excluir).',
    inputSchema: {
      regra_id: z.number().int().positive().optional(),
      perfil_id: z.number().int().positive().optional(),
      uf: z.string().length(2).optional().describe('Padrão: BA.'),
      ncm: ncm8.optional(),
      termos_obrigatorios: z.array(z.string()).min(1).optional(),
      motivo: z.enum(['isencao', 'imposto_pago_entrada']).optional()
        .describe('imposto_pago_entrada também alimenta a planilha de controle de imposto pago na entrada.'),
      descricao: z.string().max(255).nullable().optional(),
      ativo: z.boolean().optional(),
    },
    annotations: WRITE,
  }, safe(async ({ regra_id, perfil_id, uf, ncm, termos_obrigatorios, motivo, descricao, ativo }) => saveRule(
    api,
    '/regras-exclusao-parcial',
    regra_id,
    cleanUndefined({ perfil_regras_id: perfil_id, uf: uf?.toUpperCase(), ncm, termos_obrigatorios, motivo, descricao, ativo }),
    { perfil_regras_id: 'perfil_id', ncm: 'ncm', termos_obrigatorios: 'termos_obrigatorios', motivo: 'motivo' },
  )));

  server.registerTool('salvar_regra_fcp', {
    title: 'Criar ou alterar regra de FCP',
    description: 'Percentual de FCP para produtos (NCM ou prefixo + termos). Na Antecipação Tributária do Regime Normal o FCP sai em aba própria; '
      + 'nas demais planilhas soma à A.DST. Sem regra_id cria (perfil_id, ncm e aliquota_percentual obrigatórios); com regra_id altera os campos enviados.',
    inputSchema: {
      regra_id: z.number().int().positive().optional(),
      perfil_id: z.number().int().positive().optional(),
      uf: z.string().length(2).optional().describe('Padrão: BA.'),
      ncm: ncmPrefixo.optional(),
      aliquota_percentual: z.number().gt(0).max(100).optional().describe('Percentual do FCP (ex.: 2 para 2%).'),
      termos_inclusao: termosComCuringa.optional(),
      termos_exclusao: termosComCuringa.optional(),
      aplicar_com_termo_acordo: z.boolean().optional().describe('false: não aplica quando a empresa tem termo de acordo. Padrão: true.'),
      descricao: z.string().max(255).nullable().optional(),
    },
    annotations: WRITE,
  }, safe(async (args) => saveRule(
    api,
    '/regras-fcp',
    args.regra_id,
    cleanUndefined({
      perfil_regras_id: args.perfil_id,
      uf: args.uf?.toUpperCase(),
      ncm: args.ncm,
      aliquota: pct(args.aliquota_percentual),
      termos_inclusao: args.termos_inclusao,
      termos_exclusao: args.termos_exclusao,
      aplicar_com_termo_acordo: args.aplicar_com_termo_acordo,
      descricao: args.descricao,
    }),
    { perfil_regras_id: 'perfil_id', ncm: 'ncm', aliquota: 'aliquota_percentual' },
  )));

  server.registerTool('excluir_regra', {
    title: 'Excluir regra',
    description: 'Exclui uma regra de qualquer seção (para exclusão de mercadoria, prefira desativar com salvar_regra_exclusao ativo=false). '
      + 'Só chame após confirmação explícita do usuário.',
    inputSchema: {
      secao: z.enum(SECOES_REGRAS),
      regra_id: z.number().int().positive(),
    },
    annotations: DESTRUCTIVE,
  }, safe(async ({ secao, regra_id }) => {
    await api.delete(`${RULE_ENDPOINTS[secao]}/${regra_id}`);
    return { acao: 'excluida', secao, regra_id };
  }));

  server.registerTool('adicionar_excecao_regra', {
    title: 'Adicionar exceção por descrição',
    description: 'Registra uma descrição exata de produto como exceção de uma regra de reducao, reclassificacao ou fcp. '
      + 'enquadrado=true força a regra para essa descrição; false deixa essa descrição fora da regra.',
    inputSchema: {
      secao: z.enum(SECOES_COM_EXCECAO),
      regra_id: z.number().int().positive(),
      descricao_exata: z.string().min(1).max(255),
      enquadrado: z.boolean(),
      observacao: z.string().max(255).optional(),
    },
    annotations: WRITE,
  }, safe(async ({ secao, regra_id, descricao_exata, enquadrado, observacao }) => {
    const body = secao === 'reclassificacao'
      ? { descricao_exata, aplicar: enquadrado, observacao: observacao ?? null }
      : { descricao_exata, enquadrado, observacao: observacao ?? null };
    const excecao = await api.post<Rule>(`${RULE_ENDPOINTS[secao]}/${regra_id}/excecoes`, body);
    return { acao: 'excecao_adicionada', secao, regra_id, excecao: formatRule(excecao) };
  }));

  server.registerTool('remover_excecao_regra', {
    title: 'Remover exceção',
    description: 'Remove uma exceção por descrição de uma regra de reducao, reclassificacao ou fcp. Confirme com o usuário antes.',
    inputSchema: {
      secao: z.enum(SECOES_COM_EXCECAO),
      regra_id: z.number().int().positive(),
      excecao_id: z.number().int().positive(),
    },
    annotations: DESTRUCTIVE,
  }, safe(async ({ secao, regra_id, excecao_id }) => {
    await api.delete(`${RULE_ENDPOINTS[secao]}/${regra_id}/excecoes/${excecao_id}`);
    return { acao: 'excecao_removida', secao, regra_id, excecao_id };
  }));

  server.registerTool('carregar_exclusoes_padrao_ba', {
    title: 'Carregar exclusões padrão da Bahia',
    description: 'Insere no perfil as regras padrão de exclusão de mercadorias da Antecipação Parcial na BA. Regras já existentes são mantidas.',
    inputSchema: { perfil_id: z.number().int().positive() },
    annotations: WRITE_IDEMPOTENT,
  }, safe(async ({ perfil_id }) => {
    const resultado = await api.post<{ inseridas: number; existentes: number; total: number; regras: Rule[] }>(
      '/regras-exclusao-parcial/carregar-padrao-ba',
      { perfil_regras_id: perfil_id },
    );
    return { inseridas: resultado.inseridas, existentes: resultado.existentes, total: resultado.total };
  }));

  server.registerTool('aplicar_preset_fcp_bebidas_ba', {
    title: 'Aplicar preset de FCP de bebidas (BA)',
    description: 'Insere no perfil as regras de FCP de 2% para bebidas na BA e as exceções de A.DST de 25% correspondentes. Regras já existentes são mantidas.',
    inputSchema: { perfil_id: z.number().int().positive() },
    annotations: WRITE_IDEMPOTENT,
  }, safe(async ({ perfil_id }) => api.request('POST', '/regras-fcp/preset-bebidas-ba', { query: { perfil_regras_id: perfil_id } })));
}
