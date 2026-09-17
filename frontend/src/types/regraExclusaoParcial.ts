export type MotivoExclusaoParcial = 'isencao' | 'imposto_pago_entrada';

export interface RegraExclusaoParcial {
  id: number;
  perfil_regras_id: number;
  uf: string;
  ncm: string;
  descricao?: string | null;
  termos_obrigatorios: string[];
  motivo: MotivoExclusaoParcial;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export interface RegraExclusaoParcialCreate {
  perfil_regras_id: number;
  uf: string;
  ncm: string;
  descricao?: string | null;
  termos_obrigatorios: string[];
  motivo: MotivoExclusaoParcial;
  ativo?: boolean;
}

export interface RegraExclusaoParcialUpdate {
  uf?: string;
  ncm?: string;
  descricao?: string | null;
  termos_obrigatorios?: string[];
  motivo?: MotivoExclusaoParcial;
  ativo?: boolean;
}

export interface CargaPadraoBAResponse {
  inseridas: number;
  existentes: number;
  total: number;
  regras: RegraExclusaoParcial[];
}
