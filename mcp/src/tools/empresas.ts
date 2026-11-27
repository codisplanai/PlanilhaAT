import { z } from 'zod';

import {
  DESTRUCTIVE,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolContext,
  cleanUndefined,
  decimalToPercent,
  formatEmpresa,
  matchesSearch,
  percent,
  percentToDecimalString,
  safe,
} from './common.ts';

type Empresa = Record<string, unknown>;

const uf = z.string().length(2).describe('UF com 2 letras, ex.: BA.');
const fornecedor = z.object({
  cnpj: z.string().describe('CNPJ do fornecedor (14 dígitos, com ou sem máscara).'),
  nome: z.string().max(255).optional(),
  modo: z.enum(['confirmacao', 'automatico']).default('confirmacao')
    .describe('"confirmacao": a geração pergunta nota a nota se vai para a DIFAL; "automatico": vai sempre para a DIFAL.'),
});

export function registerEmpresaTools({ server, api }: ToolContext): void {
  server.registerTool('listar_empresas', {
    title: 'Listar empresas',
    description: 'Lista as empresas clientes cadastradas no Planaut (id, razão social, CNPJ, UF, perfil de regras, regime, atividade, termo de acordo). '
      + 'Use "busca" para filtrar por parte da razão social ou do CNPJ antes de usar o id em outras ferramentas.',
    inputSchema: {
      busca: z.string().optional().describe('Trecho da razão social ou do CNPJ.'),
      uf: uf.optional(),
      perfil_id: z.number().int().positive().optional().describe('Só empresas deste perfil de regras.'),
      incluir_inativas: z.boolean().default(false),
      limite: z.number().int().min(1).max(400).default(50),
    },
    annotations: READ_ONLY,
  }, safe(async ({ busca, uf: ufFiltro, perfil_id, incluir_inativas, limite }) => {
    const empresas = await api.get<Empresa[]>('/empresas', { uf: ufFiltro?.toUpperCase(), perfil_id });
    const filtradas = empresas
      .filter((empresa) => incluir_inativas || empresa.ativo !== false)
      .filter((empresa) => matchesSearch([empresa.razao_social, empresa.cnpj], busca));
    return {
      total: filtradas.length,
      exibidas: Math.min(filtradas.length, limite),
      empresas: filtradas.slice(0, limite).map((empresa) => formatEmpresa(empresa, true)),
    };
  }));

  server.registerTool('obter_empresa', {
    title: 'Ver empresa',
    description: 'Mostra o cadastro completo de uma empresa, incluindo inscrição estadual, A.ORI fixa da Parcial, termo de acordo, '
      + 'fornecedores de uso e consumo e o nome do perfil de regras.',
    inputSchema: { empresa_id: z.number().int().positive() },
    annotations: READ_ONLY,
  }, safe(async ({ empresa_id }) => {
    const empresa = await api.get<Empresa>(`/empresas/${empresa_id}`);
    const perfil = await api.get<Record<string, unknown>>(`/perfis-regras/${empresa.perfil_regras_id}`).catch(() => null);
    return { ...formatEmpresa(empresa), perfil_nome: perfil?.nome ?? null };
  }));

  server.registerTool('salvar_empresa', {
    title: 'Cadastrar ou alterar empresa',
    description: 'Sem empresa_id, cadastra uma empresa (razao_social, cnpj, uf e perfil_id obrigatórios). '
      + 'Com empresa_id, altera somente os campos enviados. Para remover a inscrição estadual ou a A.ORI fixa, envie null. '
      + 'fornecedores_uso_consumo substitui a lista inteira: leia a empresa antes para não perder fornecedores. '
      + 'Para desativar sem excluir, envie ativo=false. Confirme a alteração com o usuário antes de chamar.',
    inputSchema: {
      empresa_id: z.number().int().positive().optional(),
      razao_social: z.string().min(1).max(255).optional(),
      cnpj: z.string().optional().describe('14 dígitos, com ou sem máscara (validado pelos dígitos verificadores).'),
      inscricao_estadual: z.string().max(30).nullable().optional(),
      uf: uf.optional(),
      perfil_id: z.number().int().positive().optional().describe('Perfil de regras que a empresa segue.'),
      optante_simples_nacional: z.boolean().optional(),
      atividade: z.enum(['comercio', 'industria']).optional()
        .describe('Indústria não recolhe Antecipação Parcial nem Tributária, só DIFAL de uso/consumo e ativo.'),
      a_ori_fixa_parcial_percentual: percent('A.ORI fixa usada na Antecipação Parcial desta empresa (null remove).').nullable().optional(),
      fornecedores_uso_consumo: z.array(fornecedor).max(500).optional(),
      ativo: z.boolean().optional(),
    },
    annotations: WRITE,
  }, safe(async (args) => {
    const body = cleanUndefined({
      razao_social: args.razao_social,
      cnpj: args.cnpj,
      inscricao_estadual: args.inscricao_estadual,
      uf: args.uf?.toUpperCase(),
      perfil_regras_id: args.perfil_id,
      optante_simples_nacional: args.optante_simples_nacional,
      atividade: args.atividade,
      a_ori_fixa_parcial: args.a_ori_fixa_parcial_percentual === undefined
        ? undefined
        : args.a_ori_fixa_parcial_percentual === null ? null : percentToDecimalString(args.a_ori_fixa_parcial_percentual),
      fornecedores_uso_consumo: args.fornecedores_uso_consumo,
      ativo: args.ativo,
    });
    if (args.empresa_id) {
      if (Object.keys(body).length === 0) throw new Error('Nenhum campo para alterar foi informado.');
      const empresa = await api.put<Empresa>(`/empresas/${args.empresa_id}`, body);
      return { acao: 'alterada', empresa: formatEmpresa(empresa) };
    }
    const missing = ['razao_social', 'cnpj', 'uf', 'perfil_regras_id'].filter((key) => body[key] === undefined || body[key] === null);
    if (missing.length) {
      throw new Error(`Para cadastrar, informe: ${missing.map((key) => (key === 'perfil_regras_id' ? 'perfil_id' : key)).join(', ')}.`);
    }
    const empresa = await api.post<Empresa>('/empresas', body);
    return { acao: 'cadastrada', empresa: formatEmpresa(empresa) };
  }));

  server.registerTool('excluir_empresa', {
    title: 'Excluir empresa',
    description: 'Exclui definitivamente uma empresa (exige perfil administrador; recusado se ela tiver solicitações no histórico). '
      + 'Prefira salvar_empresa com ativo=false. Só chame após confirmação explícita do usuário.',
    inputSchema: { empresa_id: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  }, safe(async ({ empresa_id }) => {
    await api.delete(`/empresas/${empresa_id}`);
    return { acao: 'excluida', empresa_id };
  }));

  server.registerTool('definir_termo_acordo', {
    title: 'Definir termo de acordo',
    description: 'Cria ou substitui o termo de acordo da empresa (alíquota usada no lugar da A.DST). Cada empresa tem no máximo um termo.',
    inputSchema: {
      empresa_id: z.number().int().positive(),
      aliquota_percentual: percent('Alíquota do termo de acordo.'),
      descricao: z.string().max(255).optional().describe('Ex.: "Termo de Acordo nº 123/2025".'),
    },
    annotations: WRITE_IDEMPOTENT,
  }, safe(async ({ empresa_id, aliquota_percentual, descricao }) => {
    const termo = await api.put<Record<string, unknown>>(`/empresas/${empresa_id}/termo-acordo`, {
      aliquota: percentToDecimalString(aliquota_percentual),
      descricao: descricao ?? null,
    });
    return {
      acao: 'termo_definido',
      empresa_id,
      termo_acordo: { aliquota_percentual: decimalToPercent(termo.aliquota), descricao: termo.descricao ?? null },
    };
  }));

  server.registerTool('remover_termo_acordo', {
    title: 'Remover termo de acordo',
    description: 'Remove o termo de acordo da empresa (exige perfil administrador). Só chame após confirmação do usuário.',
    inputSchema: { empresa_id: z.number().int().positive() },
    annotations: DESTRUCTIVE,
  }, safe(async ({ empresa_id }) => {
    await api.delete(`/empresas/${empresa_id}/termo-acordo`);
    return { acao: 'termo_removido', empresa_id };
  }));
}
