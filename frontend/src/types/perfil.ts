import type { JsonObject } from './common';

export interface MvaGrupoConfig extends JsonObject {
  '4': string;
  '7': string;
  '12': string;
  original: string;
}

export interface MvaAntecipacaoTributariaConfig extends JsonObject {
  enabled: boolean;
  empresa_cnpj: string;
  special_ncms: string[];
  description_fallback_ncms: string[];
  special_keywords: string[];
  exclusion_keywords: string[];
  mvas: {
    especial: MvaGrupoConfig;
    demais: MvaGrupoConfig;
  };
}

export interface PerfilConfiguracoesExtras extends JsonObject {
  limitar_a_ori_reducoes?: boolean;
  politica_aliquotas_iguais_parcial?: Record<string, boolean> | boolean;
  politica_aliquotas_iguais_ufs?: string[];
  mva_revenda_antecipacao_tributaria?: MvaAntecipacaoTributariaConfig;
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
