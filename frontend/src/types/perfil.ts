import type { JsonObject } from './common';

export interface PerfilRegras {
  id: number;
  nome: string;
  descricao?: string | null;
  configuracoes_extras: JsonObject;
  criado_em: string;
  atualizado_em: string;
}

export interface PerfilRegrasCreate {
  nome: string;
  descricao?: string | null;
  configuracoes_extras?: JsonObject;
}

export interface PerfilRegrasUpdate {
  nome?: string;
  descricao?: string | null;
  configuracoes_extras?: JsonObject;
}
