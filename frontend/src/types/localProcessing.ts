import type {
  AvisoAvaliacao,
  ItemExcluido,
  NotaBonificacaoPendencia,
  NotaFiscalProcessada,
  NotaIgnorada,
  Solicitacao,
  TipoPlanilha,
} from './solicitacao';
import type { Empresa } from './empresa';
import type { RegraAliquota } from './regra';
import type { RegraCfop } from './regraCfop';
import type { RegraExclusaoParcial } from './regraExclusaoParcial';
import type { RegraReclassificacaoCfop } from './regraReclassificacaoCfop';
import type { RegraReducao } from './regraReducao';
import type { DiagnosticRecorder } from '../lib/processingDiagnostics';

export interface LocalTemplateDescriptor {
  id: number;
  tipo: TipoPlanilha;
  versao: number;
  capacidade_linhas?: number | null;
  arquivo_hash: string;
  mapeamento_campos: {
    start_row: number;
    columns: Record<string, string>;
    sheet_name?: string | null;
    header_cell?: string | null;
    aliquota_format?: 'decimal' | 'percent_number' | null;
    extra_options?: Record<string, unknown>;
  };
  observacoes?: string | null;
}

export interface LocalProcessingProfile {
  id: number;
  nome: string;
  descricao?: string | null;
  configuracoes_extras: Record<string, unknown>;
}

export interface LocalProcessingContext {
  empresa: Pick<
    Empresa,
    | 'id'
    | 'razao_social'
    | 'cnpj'
    | 'inscricao_estadual'
    | 'uf'
    | 'perfil_regras_id'
    | 'optante_simples_nacional'
  > & {
    termo_acordo?: {
      id: number;
      aliquota: number;
      descricao?: string | null;
    } | null;
  };
  perfil: LocalProcessingProfile;
  regras_aliquotas: RegraAliquota[];
  regras_cfop: RegraCfop[];
  regras_reducao: RegraReducao[];
  regras_reclassificacao: RegraReclassificacaoCfop[];
  regras_exclusao_parcial: RegraExclusaoParcial[];
  templates_ativos: LocalTemplateDescriptor[];
  mva_anexo: LocalMvaEntry[];
}

export interface LocalMvaEntry {
  ncm: string;
  mva?: number | string | null;
  mva_ajustada?: Array<{ aliquotas?: Record<string, number | string | null> }> | null;
  mva_original?: Array<{ valor?: number | string | null }> | null;
  cest?: string | null;
  descricao?: string | null;
}

export interface LocalFiscalInput {
  xmlFiles: File[];
  spedFile?: File | null;
  entrySheet?: File | null;
}

export interface LocalProcessingRequest {
  solicitacaoId: string;
  periodoInicio: string;
  periodoFim: string;
  context: LocalProcessingContext;
  input: LocalFiscalInput;
  bonusDecisions?: Record<string, boolean>;
  diagnostic?: DiagnosticRecorder;
}

export interface LocalOutputRow {
  numero_nota: string;
  serie?: string | null;
  chave_acesso?: string | null;
  cnpj_emitente?: string | null;
  uf_emitente?: string | null;
  cnpj_destinatario: string;
  uf_destinatario?: string | null;
  data_emissao: string;
  data_entrada?: string | null;
  item_numero: number;
  descricao?: string | null;
  ncm: string;
  cfop?: string | null;
  v_total: number;
  base_calculo: number;
  ipi_despesas: number;
  mva: number;
  reducao?: number | null;
  red?: string;
  aliq_simples: string;
  a_ori: number;
  a_dst: number;
  debito: number;
  credito: number;
  valor_devido: number;
}

export interface LocalGeneratedArtifact {
  tipo: TipoPlanilha;
  templateId: number;
  filename: string;
  bytes: ArrayBuffer;
  totalNotas: number;
  totalValorDevido: number;
}

export interface LocalProcessingResult {
  preAnalysis: {
    requer_decisao: boolean;
    notas_bonificacao: NotaBonificacaoPendencia[];
  };
  solicitacao?: Solicitacao;
  notasProcessadas: Omit<NotaFiscalProcessada, 'id' | 'solicitacao_id' | 'criado_em'>[];
  notasIgnoradas: NotaIgnorada[];
  itensExcluidos: ItemExcluido[];
  avisosAvaliacao: AvisoAvaliacao[];
  cfopsSemRegra: Record<string, number>;
  rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  artifacts: LocalGeneratedArtifact[];
  mensagem?: string | null;
}

export interface LocalProcessingPersistPayload {
  notas_processadas: Array<{
    chave_acesso?: string | null;
    numero_nota: string;
    serie?: string | null;
    cnpj_emitente?: string | null;
    uf_emitente?: string | null;
    cnpj_destinatario: string;
    uf_destinatario?: string | null;
    data_emissao: string;
    data_entrada?: string | null;
    origem_data_entrada?: string | null;
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
    metadados_extras: Record<string, unknown>;
  }>;
  saidas: Array<{
    tipo: TipoPlanilha;
    template_id?: number | null;
    total_notas: number;
    total_valor_devido: number;
    aviso?: string | null;
  }>;
  notas_ignoradas: NotaIgnorada[];
  itens_excluidos: ItemExcluido[];
  avisos_avaliacao: AvisoAvaliacao[];
  cfops_sem_regra: Record<string, number>;
  mensagem?: string | null;
}
