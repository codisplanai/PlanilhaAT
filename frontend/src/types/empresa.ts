export interface Empresa {
  id: number;
  razao_social: string;
  cnpj: string;
  inscricao_estadual?: string | null;
  uf: string;
  perfil_regras_id: number;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface EmpresaCreate {
  razao_social: string;
  cnpj: string;
  inscricao_estadual?: string | null;
  uf: string;
  perfil_regras_id: number;
  ativo?: boolean;
}

export interface EmpresaUpdate {
  razao_social?: string;
  cnpj?: string;
  inscricao_estadual?: string | null;
  uf?: string;
  perfil_regras_id?: number;
  ativo?: boolean;
}
