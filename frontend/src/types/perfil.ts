import type { JsonObject } from './common';

export interface PerfilConfiguracoesExtras extends JsonObject {
  limitar_a_ori_reducoes?: boolean;
  politica_aliquotas_iguais_parcial?: Record<string, boolean> | boolean;
  politica_aliquotas_iguais_ufs?: string[];
}

export interface PerfilRegras {
  id: number;
  nome: string;
  descricao?: string | null;
  configuracoes_extras: PerfilConfiguracoesExtras;
  criado_em: string;
  atualizado_em: string;
}

export interface PerfilRegrasCreate {
  nome: string;
  descricao?: string | null;
  configuracoes_extras?: PerfilConfiguracoesExtras;
}

export interface PerfilRegrasUpdate {
  nome?: string;
  descricao?: string | null;
  configuracoes_extras?: PerfilConfiguracoesExtras;
}
