export interface ExcecaoFcp {
  id: number;
  regra_fcp_id?: number;
  descricao_exata: string;
  enquadrado: boolean;
  observacao?: string | null;
  criado_em?: string;
  atualizado_em?: string;
}

export interface RegraFcp {
  id: number;
  perfil_regras_id: number;
  uf: string;
  ncm: string;
  termos_inclusao: string[];
  termos_exclusao: string[];
  aliquota: number;
  aplicar_com_termo_acordo: boolean;
  descricao?: string | null;
  excecoes: ExcecaoFcp[];
  criado_em?: string;
  atualizado_em?: string;
}

export interface RegraFcpCreate {
  perfil_regras_id: number;
  uf?: string;
  ncm: string;
  termos_inclusao?: string[];
  termos_exclusao?: string[];
  aliquota: number;
  aplicar_com_termo_acordo?: boolean;
  descricao?: string | null;
}

export interface RegraFcpUpdate {
  perfil_regras_id?: number;
  uf?: string;
  ncm?: string;
  termos_inclusao?: string[];
  termos_exclusao?: string[];
  aliquota?: number;
  aplicar_com_termo_acordo?: boolean;
  descricao?: string | null;
}

export interface ExcecaoFcpCreate {
  descricao_exata: string;
  enquadrado: boolean;
  observacao?: string | null;
}

export interface PresetBebidasBaResultado {
  fcp_criadas: number;
  fcp_ignoradas: number;
  aliquotas_criadas: number;
  aliquotas_ignoradas: number;
}
