export interface ExcecaoReducao {
  id: number;
  regra_reducao_id: number;
  descricao_exata: string;
  enquadrado: boolean;
  observacao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RegraReducao {
  id: number;
  perfil_regras_id: number;
  ncm: string;
  termos_inclusao: string[];
  termos_exclusao: string[];
  aliquota: number;
  descricao?: string | null;
  excecoes: ExcecaoReducao[];
  criado_em: string;
  atualizado_em: string;
}

export interface RegraReducaoCreate {
  perfil_regras_id: number;
  ncm: string;
  termos_inclusao: string[];
  termos_exclusao?: string[];
  aliquota: number;
  descricao?: string | null;
}

export interface RegraReducaoUpdate {
  ncm?: string;
  termos_inclusao?: string[];
  termos_exclusao?: string[];
  aliquota?: number;
  descricao?: string | null;
}

export interface ExcecaoReducaoCreate {
  descricao_exata: string;
  enquadrado: boolean;
  observacao?: string | null;
}
