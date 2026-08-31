import type { JsonObject } from './common';

export interface RegraAliquota {
  id: number;
  perfil_regras_id: number;
  uf: string;
  ncm?: string | null;
  aliquota: number;
  descricao?: string | null;
  parametros_extras: JsonObject;
  criado_em: string;
  atualizado_em: string;
}

export interface RegraAliquotaCreate {
  perfil_regras_id: number;
  uf: string;
  ncm?: string | null;
  aliquota: number;
  descricao?: string | null;
  parametros_extras?: JsonObject;
}

export interface RegraAliquotaUpdate {
  uf?: string;
  ncm?: string | null;
  aliquota?: number;
  descricao?: string | null;
  parametros_extras?: JsonObject;
}
