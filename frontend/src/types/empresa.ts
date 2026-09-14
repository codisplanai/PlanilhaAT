export interface TermoAcordo {
  id: number;
  empresa_id: number;
  aliquota: number;
  descricao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Empresa {
  id: number;
  razao_social: string;
  cnpj: string;
  inscricao_estadual?: string | null;
  uf: string;
  perfil_regras_id: number;
  optante_simples_nacional?: boolean;
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
  ativo?: boolean;
}

export interface EmpresaUpdate {
  razao_social?: string;
  cnpj?: string;
  inscricao_estadual?: string | null;
  uf?: string;
  perfil_regras_id?: number;
  optante_simples_nacional?: boolean;
  ativo?: boolean;
}
