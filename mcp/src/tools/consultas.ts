import { z } from 'zod';

import { PLANILHA_LABELS, STATUS_LABELS } from '../../../frontend/src/constants/domain.ts';
import { MCP_VERSION, isAdminUser } from '../api.ts';
import { toPercent } from '../generation.ts';
import { READ_ONLY, type ToolContext, safe } from './common.ts';

type JsonRecord = Record<string, unknown>;

const LIST_LIMIT = 40;

function round2(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function label(map: Record<string, string>, key: unknown): unknown {
  return map[String(key)] ?? key;
}

function previewList(items: unknown, map: (item: JsonRecord) => JsonRecord) {
  const list = Array.isArray(items) ? (items as JsonRecord[]) : [];
  return { total: list.length, itens: list.slice(0, LIST_LIMIT).map(map), omitidos: Math.max(0, list.length - LIST_LIMIT) };
}

export function registerConsultaTools({ server, api, policy }: ToolContext, pastaSaidaPadrao: string | null): void {
  server.registerTool('planaut_status', {
    title: 'Status da conexão com o Planaut',
    description: 'Confere a conexão: endereço do Planaut, usuário logado e papel (administrador ou operador), '
      + 'pastas do computador liberadas para ler arquivos fiscais e gravar planilhas, e pasta de saída padrão. Use primeiro se algo falhar.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, safe(async () => {
    const user = await api.currentUser();
    return {
      planaut: api.baseUrl,
      usuario: { nome: user.nome, email: user.email, cargo: user.cargo, papel: isAdminUser(user) ? 'administrador' : 'operador' },
      pastas_liberadas: policy.roots,
      pasta_saida_padrao: pastaSaidaPadrao ?? 'a mesma pasta dos XMLs informados',
      versao_mcp: MCP_VERSION,
    };
  }));

  server.registerTool('listar_solicitacoes', {
    title: 'Histórico de solicitações',
    description: 'Lista as solicitações de processamento do histórico (mais recentes primeiro), com empresa, período, status e quantidade de registros. '
      + 'Operadores veem só as próprias solicitações.',
    inputSchema: {
      empresa_id: z.number().int().positive().optional(),
      status: z.enum(['pendente', 'processando', 'concluido', 'erro']).optional(),
      limite: z.number().int().min(1).max(200).default(20),
    },
    annotations: READ_ONLY,
  }, safe(async ({ empresa_id, status, limite }) => {
    const [solicitacoes, empresas] = await Promise.all([
      api.get<JsonRecord[]>('/solicitacoes', { empresa_id, status_filter: status }),
      api.get<JsonRecord[]>('/empresas'),
    ]);
    const nomes = new Map(empresas.map((empresa) => [empresa.id, empresa.razao_social]));
    return {
      total: solicitacoes.length,
      solicitacoes: solicitacoes.slice(0, limite).map((item) => ({
        id: item.id,
        empresa_id: item.empresa_id,
        empresa: nomes.get(item.empresa_id) ?? null,
        periodo: `${item.periodo_inicio} a ${item.periodo_fim}`,
        status: label(STATUS_LABELS, item.status),
        registros: item.total_notas_processadas,
        usuario: item.usuario_nome ?? item.usuario_email ?? null,
        criado_em: item.criado_em,
        ...(item.mensagem_erro ? { mensagem: item.mensagem_erro } : {}),
      })),
    };
  }));

  server.registerTool('obter_solicitacao', {
    title: 'Ver solicitação do histórico',
    description: 'Mostra o resultado registrado de uma solicitação: planilhas geradas com totais, notas ignoradas, itens excluídos, avisos e CFOPs sem regra. '
      + 'Com incluir_registros=true, lista também os registros apurados. Os arquivos .xlsx não ficam no servidor: para obtê-los de novo, gere novamente.',
    inputSchema: {
      solicitacao_id: z.string().min(1),
      incluir_registros: z.boolean().default(false),
    },
    annotations: READ_ONLY,
  }, safe(async ({ solicitacao_id, incluir_registros }) => {
    const item = await api.get<JsonRecord>(`/solicitacoes/${encodeURIComponent(solicitacao_id)}`);
    const saidas = (Array.isArray(item.saidas) ? item.saidas as JsonRecord[] : []).map((saida) => ({
      tipo: saida.tipo,
      planilha: label(PLANILHA_LABELS, saida.tipo),
      linhas: saida.total_notas,
      valor_devido: round2(saida.total_valor_devido),
      ...(saida.aviso ? { aviso: saida.aviso } : {}),
    }));
    const registros = Array.isArray(item.notas_processadas) ? item.notas_processadas as JsonRecord[] : [];
    return {
      id: item.id,
      empresa_id: item.empresa_id,
      periodo: `${item.periodo_inicio} a ${item.periodo_fim}`,
      status: label(STATUS_LABELS, item.status),
      usuario: item.usuario_nome ?? item.usuario_email ?? null,
      criado_em: item.criado_em,
      mensagem: item.mensagem_erro ?? null,
      planilhas: saidas,
      total_registros: item.total_notas_processadas,
      cfops_sem_regra: item.cfops_sem_regra ?? {},
      notas_ignoradas: previewList(item.notas_ignoradas, (nota) => ({
        nota: nota.serie ? `${nota.numero_nota}/${nota.serie}` : nota.numero_nota,
        motivo: nota.motivo,
      })),
      itens_excluidos: previewList(item.itens_excluidos, (excluido) => ({
        nota: excluido.numero_nota,
        item: excluido.item_numero,
        ncm: excluido.ncm,
        descricao: excluido.descricao,
        tipo_exclusao: excluido.tipo_exclusao,
        motivo: excluido.motivo,
      })),
      avisos: previewList(item.avisos_avaliacao, (aviso) => ({ nota: aviso.numero_nota, item: aviso.item_numero, aviso: aviso.aviso })),
      ...(incluir_registros
        ? {
          registros: registros.slice(0, 300).map((registro) => ({
            nota: registro.numero_nota,
            item: registro.item_numero,
            ncm: registro.ncm,
            cfop: registro.cfop,
            planilha: registro.destino_planilha,
            data_emissao: String(registro.data_emissao ?? '').slice(0, 10),
            data_entrada: registro.data_entrada ?? null,
            v_total: round2(registro.v_total),
            base_calculo: round2(registro.base_calculo),
            a_ori_percentual: toPercent(Number(registro.a_ori)),
            a_dst_percentual: toPercent(Number(registro.a_dst_resolvida)),
            valor_devido: round2(registro.valor_devido),
          })),
          registros_omitidos: Math.max(0, registros.length - 300),
        }
        : {}),
    };
  }));
}
