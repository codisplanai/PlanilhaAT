export type DestinoCfop = 'antecipacao_parcial' | 'antecipacao_tributaria' | 'difal' | 'ignorar';

export interface RegraCfop {
  id: number;
  perfil_regras_id?: number | null;
  cfop_sufixo: string;
  destino: DestinoCfop;
  descricao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RegraCfopCreate {
  perfil_regras_id?: number | null;
  cfop_sufixo: string;
  destino: DestinoCfop;
  descricao?: string | null;
}

export interface RegraCfopUpdate {
  cfop_sufixo?: string;
  destino?: DestinoCfop;
  descricao?: string | null;
}

export interface RegraCfopEfetiva {
  cfop_sufixo: string;
  destino: DestinoCfop;
  descricao?: string | null;
  origem: 'global' | 'perfil';
  regra_id: number;
}
