import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { PLANILHA_LABELS } from '../../../frontend/src/constants/domain.ts';
import { readZip } from '../../../frontend/src/lib/localProcessing/zip.ts';
import {
  buildTemplateMapping,
  getDefaultTemplateLayout,
  isTemplateTributaria,
  requiredTemplateColumns,
} from '../../../frontend/src/lib/templateMapping.ts';
import type { TipoPlanilha } from '../engine.ts';
import { MAX_SHEET_FILE_BYTES, formatBytes } from '../files.ts';
import { DESTRUCTIVE, READ_ONLY, WRITE, type ToolContext, safe } from './common.ts';

type JsonRecord = Record<string, unknown>;

interface Mapping {
  start_row: number;
  columns: Record<string, string>;
  sheet_name?: string | null;
  header_cell?: string | null;
  aliquota_format?: string | null;
  extra_options?: JsonRecord;
}

const TIPOS = Object.keys(PLANILHA_LABELS) as [TipoPlanilha, ...TipoPlanilha[]];
const COLUMN_LETTERS = /^[A-Za-z]{1,3}$/;

function label(tipo: unknown): string {
  return PLANILHA_LABELS[tipo as TipoPlanilha] ?? String(tipo);
}

function escopo(template: JsonRecord): string {
  return template.empresa_id ? `empresa ${template.empresa_id}` : 'global';
}

function resumoTemplate(template: JsonRecord): JsonRecord {
  return {
    id: template.id,
    tipo: template.tipo,
    planilha: label(template.tipo),
    versao: template.versao,
    escopo: escopo(template),
    capacidade_linhas: template.capacidade_linhas ?? null,
    em_uso: Boolean(template.ativo),
    observacoes: template.observacoes ?? null,
    criado_em: template.criado_em,
  };
}

/** Abas do .xlsx (nome e visibilidade), lidas do workbook.xml sem abrir o Excel. */
export async function listarAbas(bytes: Uint8Array): Promise<Array<{ nome: string; visivel: boolean }>> {
  let entries: Map<string, Uint8Array>;
  try {
    entries = await readZip(bytes);
  } catch {
    throw new Error('O arquivo não é uma planilha .xlsx válida (não foi possível abrir o pacote).');
  }
  const workbook = entries.get('xl/workbook.xml');
  if (!workbook) throw new Error('O arquivo não é uma planilha .xlsx válida (sem xl/workbook.xml).');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(workbook), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('O workbook.xml do arquivo está corrompido.');
  return Array.from(doc.getElementsByTagNameNS('*', 'sheet')).map((sheet) => ({
    nome: sheet.getAttribute('name') ?? '',
    visivel: !['hidden', 'veryHidden'].includes(sheet.getAttribute('state') ?? ''),
  }));
}

export interface AjustesMapeamento {
  linha_inicial?: number;
  colunas?: Record<string, string | null>;
  celula_cabecalho?: string;
  formato_aliquota?: 'percent_number' | 'decimal';
  aba?: string;
}

/**
 * Aplica os ajustes pedidos sobre o mapeamento base e confere as colunas
 * obrigatórias do tipo — as mesmas exigidas pelo formulário do site.
 */
export function aplicarAjustes(tipo: TipoPlanilha, base: Mapping, ajustes: AjustesMapeamento = {}): Mapping {
  const mapping: Mapping = {
    ...base,
    columns: { ...base.columns },
    extra_options: { ...(base.extra_options ?? {}) },
  };
  if (ajustes.linha_inicial !== undefined) mapping.start_row = ajustes.linha_inicial;
  for (const [campo, letra] of Object.entries(ajustes.colunas ?? {})) {
    const key = campo.trim();
    if (!key) continue;
    if (letra === null || letra === '') {
      delete mapping.columns[key];
    } else if (!COLUMN_LETTERS.test(letra)) {
      throw new Error(`Coluna inválida para "${key}": "${letra}". Use letras do Excel, como D ou AA.`);
    } else {
      mapping.columns[key] = letra.toUpperCase();
    }
  }
  if (ajustes.celula_cabecalho) {
    const cell = ajustes.celula_cabecalho.trim().toUpperCase();
    mapping.header_cell = cell;
    mapping.extra_options = { ...mapping.extra_options, header_cell: cell };
  }
  if (ajustes.formato_aliquota) {
    mapping.extra_options = { ...mapping.extra_options, aliquota_format: ajustes.formato_aliquota };
    if (mapping.aliquota_format) mapping.aliquota_format = ajustes.formato_aliquota;
  }
  if (ajustes.aba !== undefined) mapping.sheet_name = ajustes.aba.trim() || null;

  if (isTemplateTributaria(tipo)) {
    if (!mapping.columns.reducao) mapping.columns.reducao = 'I';
    if (!mapping.columns.valor_pago) mapping.columns.valor_pago = 'S';
  }
  const faltando = requiredTemplateColumns(tipo).filter((campo) => !mapping.columns[campo]);
  if (faltando.length) {
    throw new Error(`O mapeamento precisa das colunas: ${faltando.join(', ')}.`);
  }
  if (!Number.isInteger(mapping.start_row) || mapping.start_row < 1) {
    throw new Error('A linha inicial do mapeamento deve ser um inteiro maior ou igual a 1.');
  }
  return mapping;
}

function descreverModelo(template: JsonRecord): string {
  const capacidade = template.capacidade_linhas ? `${template.capacidade_linhas} linhas` : 'sem capacidade definida';
  return `modelo ${template.id} (${label(template.tipo)} v${template.versao}, ${escopo(template)}, ${capacidade})`;
}

/**
 * Modelo em uso que serve de referência para o novo: o da mesma família;
 * senão, o do mesmo tipo e escopo (de preferência o sem capacidade definida,
 * que é o modelo base); senão, o de capacidade mais próxima.
 */
export function escolherReferencia(ativos: JsonRecord[], capacidade: number): JsonRecord | null {
  const comMapeamento = ativos.filter((template) => (template.mapeamento_campos as Mapping | undefined)?.columns);
  const mesmaFamilia = comMapeamento.find((template) => (template.capacidade_linhas ?? null) === capacidade);
  if (mesmaFamilia) return mesmaFamilia;
  const base = comMapeamento.find((template) => template.capacidade_linhas == null);
  if (base) return base;
  return [...comMapeamento].sort(
    (a, b) => Math.abs(Number(a.capacidade_linhas) - capacidade) - Math.abs(Number(b.capacidade_linhas) - capacidade),
  )[0] ?? null;
}

const abaLegivel = (aba: string | null | undefined) => (!aba || aba.toLowerCase() === 'auto' ? 'automática' : aba);

/** O que muda entre o mapeamento do modelo em uso e o do novo modelo. */
export function compararMapeamentos(atual: Mapping, novo: Mapping): string[] {
  const diferencas: string[] = [];
  for (const [campo, letra] of Object.entries(atual.columns)) {
    const nova = novo.columns[campo];
    if (!nova) diferencas.push(`${campo}: sai (era ${letra})`);
    else if (nova !== letra) diferencas.push(`${campo}: ${letra} -> ${nova}`);
  }
  for (const [campo, letra] of Object.entries(novo.columns)) {
    if (!atual.columns[campo]) diferencas.push(`${campo}: entra (${letra})`);
  }
  if (atual.start_row !== novo.start_row) diferencas.push(`linha inicial: ${atual.start_row} -> ${novo.start_row}`);
  if (abaLegivel(atual.sheet_name) !== abaLegivel(novo.sheet_name)) {
    diferencas.push(`aba: ${abaLegivel(atual.sheet_name)} -> ${abaLegivel(novo.sheet_name)}`);
  }
  const cabecalho = (mapping: Mapping) => mapping.header_cell ?? (mapping.extra_options?.header_cell as string | undefined) ?? 'A2';
  if (cabecalho(atual) !== cabecalho(novo)) diferencas.push(`cabeçalho: ${cabecalho(atual)} -> ${cabecalho(novo)}`);
  const formato = (mapping: Mapping) => mapping.aliquota_format || String(mapping.extra_options?.aliquota_format ?? 'decimal');
  if (formato(atual) !== formato(novo)) diferencas.push(`formato das alíquotas: ${formato(atual)} -> ${formato(novo)}`);
  return diferencas;
}

export function registerTemplateTools({ server, api, policy }: ToolContext): void {
  const modelosEmUso = (tipo: TipoPlanilha, empresaId?: number) => api.get<JsonRecord[]>('/templates', {
    tipo,
    empresa_id: empresaId,
    apenas_global: empresaId ? undefined : true,
    ativo: true,
  });

  server.registerTool('listar_templates', {
    title: 'Listar modelos de planilha',
    description: 'Lista os modelos oficiais (.xlsx) por tipo de planilha: versão, se é global ou exclusivo de uma empresa, capacidade de linhas '
      + 'e se está em uso. O motor escolhe o menor modelo em uso cuja capacidade comporte as linhas da apuração.',
    inputSchema: {
      tipo: z.enum(TIPOS).optional(),
      empresa_id: z.number().int().positive().optional().describe('Só modelos exclusivos desta empresa.'),
      apenas_globais: z.boolean().default(false).describe('Só modelos padrão (sem empresa).'),
      apenas_em_uso: z.boolean().default(true),
    },
    annotations: READ_ONLY,
  }, safe(async ({ tipo, empresa_id, apenas_globais, apenas_em_uso }) => {
    const templates = await api.get<JsonRecord[]>('/templates', {
      tipo,
      empresa_id,
      apenas_global: apenas_globais ? true : undefined,
      ativo: apenas_em_uso ? true : undefined,
    });
    return templates.map(resumoTemplate);
  }));

  server.registerTool('obter_template', {
    title: 'Ver modelo de planilha',
    description: 'Mostra um modelo de planilha com o mapeamento completo (linha inicial, colunas de cada campo, aba, célula do cabeçalho e formato das alíquotas). '
      + 'Use antes de enviar uma nova versão com o mesmo layout.',
    inputSchema: { template_id: z.number().int().positive() },
    annotations: READ_ONLY,
  }, safe(async ({ template_id }) => {
    const template = await api.get<JsonRecord>(`/templates/${template_id}`);
    return {
      ...resumoTemplate(template),
      mapeamento: template.mapeamento_campos ?? null,
      hash_arquivo: typeof template.arquivo_hash === 'string' ? `${template.arquivo_hash.slice(0, 12)}…` : null,
    };
  }));

  server.registerTool('enviar_template', {
    title: 'Enviar modelo de planilha',
    description: 'Envia um arquivo .xlsx do computador como nova versão de um modelo de planilha (exige administrador / Contador Sênior). '
      + 'Cada tipo, escopo (global ou empresa) e capacidade de linhas forma uma família com uma versão em uso. '
      + 'Por padrão o mapeamento é copiado do modelo em uso do mesmo tipo (aceita ajustes) e o resultado mostra as diferenças para ele. '
      + 'Use simular=true para conferir mapeamento, abas, diferenças e efeito antes de enviar, e confirme com o usuário: '
      + 'com colocar_em_uso=true a versão passa a valer nas próximas gerações dessa família.',
    inputSchema: {
      arquivo: z.string().min(1).describe('Caminho completo do .xlsx, dentro das pastas liberadas.'),
      tipo: z.enum(TIPOS),
      capacidade_linhas: z.number().int().min(1).describe('Quantas linhas de dados o modelo comporta (o motor escolhe o menor modelo que caiba).'),
      colocar_em_uso: z.boolean().describe('true: passa a ser a versão usada (desativa as outras da família). false: fica guardada para promover depois. '
        + 'Sem versão em uso na família, ela entra em uso de qualquer jeito.'),
      empresa_id: z.number().int().positive().optional().describe('Modelo exclusivo desta empresa; sem isso, é modelo padrão global.'),
      observacoes: z.string().max(500).optional(),
      mapeamento_base: z.enum(['modelo_em_uso', 'padrao_do_site', 'copiar_de_template']).default('modelo_em_uso')
        .describe('modelo_em_uso: o mapeamento do modelo em uso do mesmo tipo e escopo (ou o global, para modelo de empresa). '
          + 'padrao_do_site: o layout que o formulário do site sugere para o tipo (o dos modelos oficiais). '
          + 'copiar_de_template: o mapeamento de um modelo cadastrado.'),
      copiar_de_template_id: z.number().int().positive().optional().describe('Obrigatório com mapeamento_base=copiar_de_template.'),
      ajustes: z.object({
        linha_inicial: z.number().int().min(1).optional(),
        colunas: z.record(z.string(), z.string().nullable()).optional()
          .describe('Campo -> letra da coluna (ex.: {"mva": "H", "data_entrada": "B"}); null remove o campo. Campos comuns: item_index, numero_nota, '
            + 'data_entrada, data_emissao, v_total, base_calculo, ipi_despesas, mva, reducao, red, aliq_simples, a_dst, a_ori, valor_pago.'),
        celula_cabecalho: z.string().regex(/^[A-Za-z]{1,3}[1-9]\d*$/).optional().describe('Célula do cabeçalho da empresa, ex.: A2.'),
        formato_aliquota: z.enum(['percent_number', 'decimal']).optional().describe('percent_number grava 20,5; decimal grava 0,205.'),
        aba: z.string().optional().describe('Nome da aba que recebe os dados, ou "auto".'),
      }).optional(),
      simular: z.boolean().default(false).describe('true: só monta e confere, sem enviar.'),
    },
    annotations: WRITE,
  }, safe(async (args) => {
    const real = await policy.resolveExisting(args.arquivo);
    const nome = path.basename(real);
    if (!nome.toLowerCase().endsWith('.xlsx')) throw new Error('O modelo precisa ser um arquivo .xlsx.');
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size === 0) throw new Error(`O arquivo ${nome} está vazio ou não é um arquivo.`);
    if (stat.size > MAX_SHEET_FILE_BYTES) {
      throw new Error(`O arquivo tem ${formatBytes(stat.size)}; o limite para modelos é ${formatBytes(MAX_SHEET_FILE_BYTES)}.`);
    }
    const bytes = new Uint8Array(await fs.readFile(real));
    const abas = await listarAbas(bytes);

    const ativosNoEscopo = await modelosEmUso(args.tipo, args.empresa_id);
    const emUso = ativosNoEscopo.find((template) => (template.capacidade_linhas ?? null) === args.capacidade_linhas) ?? null;
    let referencia = escolherReferencia(ativosNoEscopo, args.capacidade_linhas);
    if (!referencia && args.empresa_id) referencia = escolherReferencia(await modelosEmUso(args.tipo), args.capacidade_linhas);

    let base: Mapping;
    let origem: string;
    if (args.mapeamento_base === 'copiar_de_template') {
      if (!args.copiar_de_template_id) throw new Error('Informe copiar_de_template_id para copiar o mapeamento de um modelo existente.');
      const fonte = await api.get<JsonRecord>(`/templates/${args.copiar_de_template_id}`);
      const mapeamento = fonte.mapeamento_campos as Mapping | undefined;
      if (!mapeamento?.columns) throw new Error(`O modelo ${args.copiar_de_template_id} não tem mapeamento para copiar.`);
      base = JSON.parse(JSON.stringify(mapeamento)) as Mapping;
      origem = `copiado do ${descreverModelo(fonte)}`;
    } else if (args.mapeamento_base === 'padrao_do_site') {
      base = buildTemplateMapping(args.tipo, getDefaultTemplateLayout(args.tipo)) as Mapping;
      origem = 'padrão do formulário do site para o tipo';
    } else {
      if (!referencia) {
        throw new Error(
          `Não há modelo em uso de ${label(args.tipo)} para copiar o mapeamento. `
          + 'Use mapeamento_base "padrao_do_site" (layout sugerido pelo site) ou "copiar_de_template".',
        );
      }
      base = JSON.parse(JSON.stringify(referencia.mapeamento_campos)) as Mapping;
      origem = `copiado do ${descreverModelo(referencia)}, em uso`;
    }
    const mapeamento = aplicarAjustes(args.tipo, base, args.ajustes);

    const abaDeclarada = mapeamento.sheet_name && mapeamento.sheet_name.toLowerCase() !== 'auto' ? mapeamento.sheet_name : null;
    if (abaDeclarada && !abas.some((aba) => aba.nome === abaDeclarada)) {
      throw new Error(
        `A aba "${abaDeclarada}" do mapeamento não existe no arquivo. Abas encontradas: ${abas.map((aba) => aba.nome).join(', ')}. `
        + 'Use ajustes.aba com o nome certo ou "auto" (aba do mês da competência).',
      );
    }

    const entraraEmUso = args.colocar_em_uso || !emUso;
    const efeito = entraraEmUso
      ? emUso
        ? `Passa a ser a versão em uso no lugar da v${emUso.versao} (id ${emUso.id}).`
        : 'Não há versão em uso nesta família: a nova versão entra em uso.'
      : `Fica guardada sem uso; a v${emUso?.versao} (id ${emUso?.id}) continua em uso até ser promovida.`;
    const familiaTexto = `${label(args.tipo)} · ${args.empresa_id ? `empresa ${args.empresa_id}` : 'global'} · ${args.capacidade_linhas} linhas`;
    const comparacao = referencia
      ? {
        comparado_com: `${descreverModelo(referencia)}, em uso`,
        diferencas: compararMapeamentos(referencia.mapeamento_campos as Mapping, mapeamento),
      }
      : { comparado_com: null, diferencas: [] as string[] };

    if (args.simular) {
      return {
        acao: 'simulacao',
        arquivo: real,
        abas: abas.map((aba) => (aba.visivel ? aba.nome : `${aba.nome} (oculta)`)),
        familia: familiaTexto,
        efeito,
        origem_mapeamento: origem,
        ...comparacao,
        mapeamento,
      };
    }

    const form = new FormData();
    form.append('tipo', args.tipo);
    form.append('capacidade_linhas', String(args.capacidade_linhas));
    if (args.empresa_id) form.append('empresa_id', String(args.empresa_id));
    form.append('mapeamento_json', JSON.stringify(mapeamento));
    if (args.observacoes) form.append('observacoes', args.observacoes);
    form.append('promover_ativo', String(args.colocar_em_uso));
    form.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nome);
    const criado = await api.postForm<JsonRecord>('/templates/upload', form);
    return {
      acao: 'enviado',
      template: resumoTemplate(criado),
      familia: familiaTexto,
      efeito: criado.ativo ? 'A nova versão está em uso.' : 'A nova versão foi guardada sem uso; use promover_template para colocá-la em uso.',
      origem_mapeamento: origem,
      ...comparacao,
      mapeamento: criado.mapeamento_campos ?? null,
    };
  }));

  server.registerTool('promover_template', {
    title: 'Colocar modelo em uso',
    description: 'Coloca uma versão de modelo em uso; as outras versões da mesma família (tipo, escopo e capacidade) deixam de ser usadas. '
      + 'Vale para as próximas gerações de todas as empresas que usam essa família: confirme com o usuário.',
    inputSchema: { template_id: z.number().int().positive() },
    annotations: WRITE,
  }, safe(async ({ template_id }) => {
    const template = await api.post<JsonRecord>(`/templates/${template_id}/promover`);
    return { acao: 'em_uso', template: resumoTemplate(template) };
  }));

  server.registerTool('desativar_template', {
    title: 'Desativar modelo exclusivo',
    description: 'Tira de uso um modelo exclusivo de empresa, que volta a usar o modelo padrão global. Modelos globais não podem ser desativados '
      + 'sem colocar outra versão em uso. Confirme com o usuário antes.',
    inputSchema: { template_id: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  }, safe(async ({ template_id }) => {
    const template = await api.post<JsonRecord>(`/templates/${template_id}/desativar`);
    return { acao: 'desativado', template: resumoTemplate(template) };
  }));
}
