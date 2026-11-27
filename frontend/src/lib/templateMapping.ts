import type { TemplateMapping } from '../types/template';
import type { TipoPlanilha } from '../types/solicitacao';

/**
 * Layout padrão dos modelos de planilha e montagem do mapeamento enviado ao
 * backend. Fica fora da tela de modelos para que o servidor MCP use exatamente
 * as mesmas regras ao enviar um modelo pela IA.
 */

export type AliquotaFormat = 'percent_number' | 'decimal';

export interface TemplateLayout {
  capacidade_linhas: number;
  start_row: number;
  col_numero_nota: string;
  col_data_entrada?: string;
  col_data_emissao: string;
  col_v_total: string;
  col_base_calculo?: string;
  col_ipi_despesas?: string;
  col_mva?: string;
  col_reducao?: string;
  col_a_dst: string;
  col_a_ori: string;
  header_cell?: string;
  aliquota_format: AliquotaFormat;
}

export function isTemplateTributaria(tipo: TipoPlanilha): boolean {
  return tipo === 'antecipacao_tributaria' || tipo === 'antecipacao_tributaria_antecipado';
}

/** Colunas sem as quais o modelo não recebe a apuração do tipo. */
export function requiredTemplateColumns(tipo: TipoPlanilha): string[] {
  const base = ['numero_nota', 'data_emissao', 'v_total', 'a_dst', 'a_ori'];
  return isTemplateTributaria(tipo) ? [...base, 'mva', 'reducao'] : base;
}

export function getDefaultTemplateLayout(tipo: TipoPlanilha): TemplateLayout {
  const isAntecipado =
    tipo === 'antecipacao_parcial_antecipado' ||
    tipo === 'antecipacao_parcial_antecipado_simples' ||
    tipo === 'controle_imposto_pago_entrada';
  const isParcial =
    tipo === 'antecipacao_parcial' ||
    tipo === 'antecipacao_parcial_simples';
  const isTributaria = isTemplateTributaria(tipo);
  const isDifal = tipo === 'difal' || tipo === 'difal_antecipado';
  return {
    capacidade_linhas: tipo === 'antecipacao_tributaria_antecipado' ? 35 : 100,
    start_row: 4,
    col_numero_nota: 'D',
    col_data_entrada: 'B',
    col_data_emissao: 'C',
    col_v_total: 'E',
    col_base_calculo: isAntecipado || isTributaria || isParcial ? 'F' : '',
    col_ipi_despesas: isDifal ? 'F' : 'G',
    col_mva: isTributaria ? 'H' : '',
    col_reducao: isTributaria ? 'I' : '',
    col_a_dst: isTributaria ? 'J' : isDifal ? 'I' : 'H',
    col_a_ori: isTributaria ? 'K' : isDifal ? 'J' : 'I',
    header_cell: 'A2',
    aliquota_format: 'percent_number',
  };
}

export function buildTemplateMapping(tipo: TipoPlanilha, layout: TemplateLayout): TemplateMapping {
  const columns: Record<string, string> = {
    numero_nota: layout.col_numero_nota.toUpperCase(),
    data_emissao: layout.col_data_emissao.toUpperCase(),
    v_total: layout.col_v_total.toUpperCase(),
    a_dst: layout.col_a_dst.toUpperCase(),
    a_ori: layout.col_a_ori.toUpperCase(),
  };
  if (layout.col_data_entrada) columns.data_entrada = layout.col_data_entrada.toUpperCase();
  if (layout.col_base_calculo) columns.base_calculo = layout.col_base_calculo.toUpperCase();
  if (layout.col_ipi_despesas) columns.ipi_despesas = layout.col_ipi_despesas.toUpperCase();
  if (layout.col_mva) columns.mva = layout.col_mva.toUpperCase();
  if (layout.col_reducao) columns.reducao = layout.col_reducao.toUpperCase();
  if (isTemplateTributaria(tipo)) {
    if (!columns.reducao) columns.reducao = 'I';
    columns.valor_pago = 'S';
  }

  const headerCell = layout.header_cell || 'A2';
  return {
    start_row: layout.start_row,
    columns,
    header_cell: headerCell,
    extra_options: {
      header_cell: headerCell,
      aliquota_format: layout.aliquota_format,
    },
  };
}
