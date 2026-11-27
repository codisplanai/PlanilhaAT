import { z } from 'zod';

import {
  DESTRUCTIVE,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolContext,
  cleanUndefined,
  matchesSearch,
  omit,
  safe,
} from './common.ts';

type Perfil = { id: number; nome: string; descricao?: string | null; configuracoes_extras?: Record<string, unknown> };
type Empresa = { id: number; razao_social: string; cnpj: string; perfil_regras_id: number; ativo?: boolean };

export const SECOES_REGRAS = ['aliquotas', 'cfop', 'reducao', 'reclassificacao', 'exclusao', 'fcp'] as const;

const CONFIG_KEYS = [
  'limitar_a_ori_reducoes',
  'politica_aliquotas_iguais_parcial',
  'politica_aliquotas_iguais_ufs',
  'mva_revenda_antecipacao_tributaria',
  'convenio_icms_52_91_anexo_i',
  'convenio_icms_52_91_anexo_ii',
] as const;

const CONFIG_HELP = [
  'limitar_a_ori_reducoes: boolean.',
  'politica_aliquotas_iguais_parcial: objeto UF -> boolean (ex.: {"SP": true}) para a Parcial quando A.ORI = A.DST.',
  'politica_aliquotas_iguais_ufs: lista de UFs.',
  'mva_revenda_antecipacao_tributaria: política especial de MVA "passo a passo" (enabled, empresa_cnpj, mvas.especial/demais com faixas 4/7/12/original, special_ncms, description_fallback_ncms, special_keywords, exclusion_keywords). '
    + 'É um tratamento à parte: não altere ao mexer na regra geral de MVA.',
  'convenio_icms_52_91_anexo_i / convenio_icms_52_91_anexo_ii: enabled, aplicar_automaticamente_seguros, solicitar_confirmacao_duvidosos, considerar_cst20_como_indicio (booleans) e ajustes (lista com id, ncm de 8 dígitos, acao automatico|revisar|nao_aplicar, termos_descricao, vigencia_inicio/fim AAAA-MM-DD, motivo).',
].join(' ');

const RULE_ENDPOINTS: Record<(typeof SECOES_REGRAS)[number], string> = {
  aliquotas: '/regras-aliquotas',
  cfop: '/regras-cfop',
  reducao: '/regras-reducao-produto',
  reclassificacao: '/regras-reclassificacao-cfop',
  exclusao: '/regras-exclusao-parcial',
  fcp: '/regras-fcp',
};

export function registerPerfilTools({ server, api }: ToolContext): void {
  server.registerTool('listar_perfis', {
    title: 'Listar perfis de regras',
    description: 'Lista os perfis de regras (conjuntos de regras fiscais compartilhados entre empresas) com a quantidade de empresas que usam cada um.',
    inputSchema: { busca: z.string().optional().describe('Trecho do nome ou da descrição.') },
    annotations: READ_ONLY,
  }, safe(async ({ busca }) => {
    const [perfis, empresas] = await Promise.all([
      api.get<Perfil[]>('/perfis-regras'),
      api.get<Empresa[]>('/empresas'),
    ]);
    const uso = new Map<number, number>();
    for (const empresa of empresas) uso.set(empresa.perfil_regras_id, (uso.get(empresa.perfil_regras_id) ?? 0) + 1);
    return perfis
      .filter((perfil) => matchesSearch([perfil.nome, perfil.descricao], busca))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((perfil) => ({
        id: perfil.id,
        nome: perfil.nome,
        descricao: perfil.descricao ?? null,
        empresas: uso.get(perfil.id) ?? 0,
        configuracoes: Object.keys(perfil.configuracoes_extras ?? {}),
      }));
  }));

  server.registerTool('obter_perfil', {
    title: 'Ver perfil de regras',
    description: 'Mostra um perfil de regras: configurações extras, quantidade de regras por seção e as empresas vinculadas. '
      + 'Use listar_regras para ver as regras em detalhe.',
    inputSchema: { perfil_id: z.number().int().positive() },
    annotations: READ_ONLY,
  }, safe(async ({ perfil_id }) => {
    const perfil = await api.get<Perfil>(`/perfis-regras/${perfil_id}`);
    const [empresas, ...listas] = await Promise.all([
      api.get<Empresa[]>('/empresas', { perfil_id }),
      ...SECOES_REGRAS.map((secao) => api.get<unknown[]>(RULE_ENDPOINTS[secao], { perfil_id })),
    ]);
    return {
      ...omit(perfil as Record<string, unknown>, ['criado_em']),
      regras_por_secao: Object.fromEntries(SECOES_REGRAS.map((secao, index) => [secao, listas[index].length])),
      observacao_cfop: 'A contagem de cfop considera só as exceções do perfil; as regras globais valem para todos (ver listar_regras com efetivas).',
      empresas_vinculadas: empresas.length,
      empresas: empresas.slice(0, 40).map((empresa) => ({ id: empresa.id, razao_social: empresa.razao_social, cnpj: empresa.cnpj, ativo: empresa.ativo })),
    };
  }));

  server.registerTool('salvar_perfil', {
    title: 'Criar ou renomear perfil',
    description: 'Sem perfil_id, cria um perfil de regras vazio (nome obrigatório). Com perfil_id, altera nome e/ou descrição. '
      + 'Para configurações extras use configurar_perfil; para copiar um perfil inteiro use duplicar_perfil.',
    inputSchema: {
      perfil_id: z.number().int().positive().optional(),
      nome: z.string().min(1).max(100).optional(),
      descricao: z.string().nullable().optional(),
    },
    annotations: WRITE,
  }, safe(async ({ perfil_id, nome, descricao }) => {
    if (perfil_id) {
      const body = cleanUndefined({ nome, descricao });
      if (Object.keys(body).length === 0) throw new Error('Informe nome ou descrição para alterar.');
      const perfil = await api.put<Perfil>(`/perfis-regras/${perfil_id}`, body);
      return { acao: 'alterado', perfil: omit(perfil as Record<string, unknown>, ['criado_em']) };
    }
    if (!nome) throw new Error('Para criar um perfil, informe o nome.');
    const perfil = await api.post<Perfil>('/perfis-regras', { nome, descricao: descricao ?? null, configuracoes_extras: {} });
    return { acao: 'criado', perfil: omit(perfil as Record<string, unknown>, ['criado_em']) };
  }));

  server.registerTool('configurar_perfil', {
    title: 'Ajustar configuração do perfil',
    description: 'Define (ou remove, com valor=null) UMA chave das configurações extras do perfil, preservando as demais. '
      + `Chaves: ${CONFIG_HELP} Leia o perfil antes e confirme o novo valor com o usuário; a API valida o formato.`,
    inputSchema: {
      perfil_id: z.number().int().positive(),
      chave: z.enum(CONFIG_KEYS),
      valor: z.unknown().describe('Novo valor da chave (objeto, lista ou boolean), ou null para remover a chave.'),
    },
    annotations: WRITE_IDEMPOTENT,
  }, safe(async ({ perfil_id, chave, valor }) => {
    const perfil = await api.get<Perfil>(`/perfis-regras/${perfil_id}`);
    const atual = { ...(perfil.configuracoes_extras ?? {}) };
    const anterior = atual[chave];
    if (valor === null || valor === undefined) delete atual[chave];
    else atual[chave] = valor;
    const salvo = await api.put<Perfil>(`/perfis-regras/${perfil_id}`, { configuracoes_extras: atual });
    return {
      acao: valor === null || valor === undefined ? 'chave_removida' : 'chave_definida',
      perfil_id,
      chave,
      valor_anterior: anterior ?? null,
      valor_salvo: salvo.configuracoes_extras?.[chave] ?? null,
    };
  }));

  server.registerTool('duplicar_perfil', {
    title: 'Duplicar perfil',
    description: 'Cria um novo perfil copiando configurações e todas as regras de um perfil existente.',
    inputSchema: {
      perfil_id: z.number().int().positive().describe('Perfil de origem.'),
      novo_nome: z.string().min(1).max(100),
    },
    annotations: WRITE,
  }, safe(async ({ perfil_id, novo_nome }) => {
    const copia = await api.post<Perfil>(`/perfis-regras/${perfil_id}/duplicar`, { nome: novo_nome });
    return { acao: 'duplicado', origem_id: perfil_id, perfil: omit(copia as Record<string, unknown>, ['criado_em']) };
  }));

  server.registerTool('copiar_regras_entre_perfis', {
    title: 'Copiar regras para outros perfis',
    description: 'Copia regras de uma seção de um perfil para outros perfis (exige administrador). Regras já existentes no destino são ignoradas. '
      + 'Sem regra_ids, copia a seção inteira. Afeta todas as empresas dos perfis de destino: confirme com o usuário.',
    inputSchema: {
      perfil_origem_id: z.number().int().positive(),
      secao: z.enum(SECOES_REGRAS),
      regra_ids: z.array(z.number().int().positive()).min(1).optional(),
      perfil_destino_ids: z.array(z.number().int().positive()).optional(),
      todos_os_demais: z.boolean().default(false).describe('true copia para todos os outros perfis.'),
    },
    annotations: WRITE,
  }, safe(async ({ perfil_origem_id, secao, regra_ids, perfil_destino_ids, todos_os_demais }) => {
    if (!todos_os_demais && !perfil_destino_ids?.length) {
      throw new Error('Informe perfil_destino_ids ou todos_os_demais=true.');
    }
    return api.post(`/perfis-regras/${perfil_origem_id}/copiar-regras`, cleanUndefined({
      secao,
      regra_ids,
      perfil_destino_ids: perfil_destino_ids ?? [],
      todos_os_demais,
    }));
  }));

  server.registerTool('excluir_perfil', {
    title: 'Excluir perfil',
    description: 'Exclui um perfil de regras e suas regras (exige administrador; recusado se houver empresas vinculadas). '
      + 'Só chame após confirmação explícita do usuário.',
    inputSchema: { perfil_id: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  }, safe(async ({ perfil_id }) => {
    await api.delete(`/perfis-regras/${perfil_id}`);
    return { acao: 'excluido', perfil_id };
  }));
}

export { RULE_ENDPOINTS };
