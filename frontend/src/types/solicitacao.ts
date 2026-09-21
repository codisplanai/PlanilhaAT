import type { JsonObject } from './common';

export interface NotaFiscalProcessada {
  id: string;
  solicitacao_id: string;
  chave_acesso?: string | null;
  numero_nota: string;
  serie?: string | null;
  cnpj_emitente?: string | null;
  uf_emitente?: string | null;
  cnpj_destinatario: string;
  uf_destinatario?: string | null;
  data_emissao: string;
  data_entrada?: string | null;
  origem_data_entrada?: 'planilha_sistema_contabil' | 'sped_fiscal' | 'xml_nfe' | 'manual' | null;
  item_numero: number;
  ncm: string;
  cfop?: string | null;
  destino_planilha?: TipoPlanilha | null;
  v_total: number;
  base_calculo: number;
  ipi_despesas: number;
  a_ori: number;
  a_dst_resolvida: number;
  debito: number;
  credito: number;
  valor_devido: number;
  metadados_extras: JsonObject;
  criado_em: string;
}

export interface NotaIgnorada {
  numero_nota: string;
  serie?: string | null;
  chave_acesso?: string | null;
  data_emissao?: string | null;
  motivo: string;
  arquivo?: string | null;
}

export interface ItemExcluido {
  chave_acesso?: string | null;
  numero_nota: string;
  serie?: string | null;
  item_numero: number;
  arquivo?: string | null;
  destino: string;
  ncm: string;
  descricao: string;
  descricao_confiavel: boolean;
  motivo: string;
  tipo_exclusao: 'mercadoria' | 'aliquotas_iguais';
  regras_aplicadas?: JsonObject[];
  v_total?: number | null;
  base_calculo?: number | null;
  ipi_despesas?: number | null;
  a_ori?: number | null;
  a_dst?: number | null;
  debito?: number | null;
  credito?: number | null;
  valor_devido?: number | null;
}

export interface AvisoAvaliacao {
  numero_nota: string;
  serie?: string | null;
  item_numero: number;
  arquivo?: string | null;
  aviso: string;
}

export type TipoPlanilha =
  | 'antecipacao_parcial'
  | 'antecipacao_parcial_antecipado'
  | 'antecipacao_parcial_simples'
  | 'antecipacao_parcial_antecipado_simples'
  | 'antecipacao_tributaria'
  | 'antecipacao_tributaria_antecipado'
  | 'difal';
export type StatusSolicitacao = 'pendente' | 'processando' | 'concluido' | 'erro';

export interface SolicitacaoSaida {
  id: string;
  solicitacao_id: string;
  tipo: TipoPlanilha;
  template_id?: number | null;
  arquivo_path?: string | null;
  total_notas: number;
  total_valor_devido: number;
  aviso?: string | null;
  criado_em: string;
}

export interface Solicitacao {
  id: string;
  empresa_id: number;
  periodo_inicio: string;
  periodo_fim: string;
  tipo_planilha: TipoPlanilha | 'multi';
  template_id?: number | null;
  status: StatusSolicitacao;
  mensagem_erro?: string | null;
  arquivo_saida_path?: string | null;
  total_notas_processadas: number;
  notas_ignoradas?: NotaIgnorada[];
  itens_excluidos?: ItemExcluido[];
  avisos_avaliacao?: AvisoAvaliacao[];
  cfops_sem_regra?: Record<string, number>;
  criado_em: string;
  atualizado_em: string;
  notas_processadas?: NotaFiscalProcessada[];
  saidas?: SolicitacaoSaida[];
}

export interface SolicitacaoCreate {
  empresa_id: number;
  periodo_inicio: string;
  periodo_fim: string;
  tipo_planilha?: TipoPlanilha;
  template_id?: number;
}

export interface NotaBonificacaoPendencia {
  chave_acesso: string;
  numero_nota: string;
  serie?: string;
  cnpj_emitente?: string;
  nome_emitente?: string;
  cfops: string[];
  valor_total: number;
  tem_credito: boolean;
  sugestao_revenda: boolean;
  motivo_sugestao: string;
}

export interface PreAnaliseSolicitacao {
  requer_decisao: boolean;
  notas_bonificacao: NotaBonificacaoPendencia[];
}

export interface SolicitacoesBatchDeleteRequest {
  ids: string[];
}

export interface SolicitacoesBatchDeleteResponse {
  deleted_count: number;
  ids: string[];
}
