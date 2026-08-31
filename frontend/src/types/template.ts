import type { JsonObject } from './common';
import type { TipoPlanilha } from './solicitacao';

export interface TemplateMapping {
  start_row: number;
  columns: Record<string, string>;
  sheet_name?: string | null;
  header_cell?: string | null;
  extra_options?: JsonObject;
}

export interface TemplateXlsx {
  id: number;
  tipo: TipoPlanilha;
  versao: number;
  arquivo_path: string;
  arquivo_hash: string;
  mapeamento_campos: TemplateMapping;
  ativo: boolean;
  observacoes?: string | null;
  criado_em: string;
}
