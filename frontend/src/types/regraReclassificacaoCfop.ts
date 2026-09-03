export interface ExcecaoReclassificacaoCfop {
  id: number;
  regra_reclassificacao_id: number;
  descricao_exata: string;
  aplicar: boolean;
  observacao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RegraReclassificacaoCfop {
  id: number;
  perfil_regras_id: number;
  ncm: string;
  cfop_origem_sufixo?: string | null;
  cfop_destino_sufixo: string;
  termos_inclusao: string[];
  termos_exclusao: string[];
  descricao?: string | null;
  excecoes: ExcecaoReclassificacaoCfop[];
  criado_em: string;
  atualizado_em: string;
}

export interface RegraReclassificacaoCfopCreate {
  perfil_regras_id: number;
  ncm: string;
  cfop_origem_sufixo?: string | null;
  cfop_destino_sufixo: string;
  termos_inclusao?: string[];
  termos_exclusao?: string[];
  descricao?: string | null;
}

export interface RegraReclassificacaoCfopUpdate {
  ncm?: string;
  cfop_origem_sufixo?: string | null;
  cfop_destino_sufixo?: string;
  termos_inclusao?: string[];
  termos_exclusao?: string[];
  descricao?: string | null;
}

export interface ExcecaoReclassificacaoCfopCreate {
  descricao_exata: string;
  aplicar: boolean;
  observacao?: string | null;
}
