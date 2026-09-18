export interface ExtractedItem {
  itemNumero: number;
  ncm: string;
  cest: string;
  cfop: string;
  descricao: string;
  descricaoConfiavel: boolean;
  vItem: number;
  vTotal: number;
  baseCalculo: number;
  ipiDespesas: number;
  aOri: number;
  vIcms: number;
}

export interface ExtractedNote {
  filename: string;
  chaveAcesso: string;
  numeroNota: string;
  serie: string;
  cnpjEmitente: string;
  ufEmitente: string;
  cnpjDestinatario: string;
  ufDestinatario: string;
  dataEmissao: string;
  dataEntrada?: string | null;
  vTotalNota: number;
  vBcNota: number;
  vIcmsNota: number;
  origemExtracao: 'xml' | 'sped';
  rawMetadata: Record<string, string | number | boolean | null>;
  itens: ExtractedItem[];
}

export interface EntrySheetRecord {
  numeroNormalizado: string;
  serieNormalizada: string;
  cnpjEmitenteNormalizado: string;
  chaveAcessoNormalizada: string;
  dataEntrada?: string | null;
  cfopNormalizado: string;
}

export interface ParsedFiscalSources {
  notes: ExtractedNote[];
  entryRecords: EntrySheetRecord[];
  spedCompanyInfo: {
    cnpj?: string;
    uf?: string;
    ie?: string;
    nome?: string;
  };
}

export interface CfopResolution {
  cfopEfetivo: string;
  sufixoEfetivo?: string | null;
  destino?: string | null;
  reclassificado: boolean;
  motivo?: string | null;
}

export interface TaxRateResolution {
  aliquota: number;
  origem: string;
  detalhe: string;
}

export interface CalculationResult {
  debito: number;
  credito: number;
  valorDevido: number;
  detalhes: Record<string, string | number | boolean | null>;
}

export interface LocalTemplateBytes {
  templateId: number;
  bytes: ArrayBuffer;
}
