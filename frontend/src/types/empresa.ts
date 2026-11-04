export interface TermoAcordo {
  id: number;
  empresa_id: number;
  aliquota: number;
  descricao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export type AtividadeEmpresa = 'comercio' | 'industria';

export interface Empresa {
  id: number;
  razao_social: string;
  cnpj: string;
  inscricao_estadual?: string | null;
  uf: string;
  perfil_regras_id: number;
  optante_simples_nacional?: boolean;
  /** Indústria gera apenas DIFAL (uso/consumo e ativo imobilizado). */
  atividade?: AtividadeEmpresa;
  /** A.ORI fixa da Antecipação Parcial (acordo com a SEFAZ); nula usa a do XML. */
  a_ori_fixa_parcial?: number | null;
  ativo: boolean;
  termo_acordo?: TermoAcordo | null;
  criado_em: string;
  atualizado_em: string;
}

export interface EmpresaCreate {
  razao_social: string;
  cnpj: string;
  inscricao_estadual?: string | null;
  uf: string;
  perfil_regras_id: number;
  optante_simples_nacional?: boolean;
  /** Indústria gera apenas DIFAL (uso/consumo e ativo imobilizado). */
  atividade?: AtividadeEmpresa;
  a_ori_fixa_parcial?: number | null;
  ativo?: boolean;
}

export interface EmpresaUpdate {
  razao_social?: string;
  cnpj?: string;
  inscricao_estadual?: string | null;
  uf?: string;
  perfil_regras_id?: number;
  optante_simples_nacional?: boolean;
  /** Indústria gera apenas DIFAL (uso/consumo e ativo imobilizado). */
  atividade?: AtividadeEmpresa;
  a_ori_fixa_parcial?: number | null;
  ativo?: boolean;
}
