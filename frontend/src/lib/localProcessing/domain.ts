import type { TipoPlanilha } from '../../types/solicitacao';

export const PARTIAL_DESTINATIONS: ReadonlySet<TipoPlanilha> = new Set<TipoPlanilha>([
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
]);

export const EARLY_DESTINATIONS: ReadonlySet<TipoPlanilha> = new Set<TipoPlanilha>([
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_antecipado_simples',
  'antecipacao_tributaria_antecipado',
  'difal_antecipado',
]);

export const TAX_SUBSTITUTION_DESTINATIONS: ReadonlySet<TipoPlanilha> = new Set<TipoPlanilha>([
  'antecipacao_tributaria',
  'antecipacao_tributaria_antecipado',
]);

export const BONUS_SUFFIXES: ReadonlySet<string> = new Set(['910', '911', '949']);

export const SUL_SUDESTE_EXCETO_ES: ReadonlySet<string> = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);

export const IBGE_UF_MAP: Readonly<Record<string, string>> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
  '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export function decodeUtf8OrWindows1252(bytes: ArrayBuffer | Uint8Array): string {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder('windows-1252').decode(raw);
  }
}

export function normalizeDescription(value?: string | null): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export interface ExtractedItem {
  itemNumero: number;
  ncm: string;
  cest: string;
  cfop: string;
  descricao: string;
  descricaoConfiavel: boolean;
  vItem: number;
  vTotal: number;
  /** Base de ICMS lida da fonte fiscal; pode já conter benefício/redução. */
  baseCalculo: number;
  /** vBC original do XML/SPED, preservada para diagnóstico. */
  baseCalculoXml?: number;
  /** Base econômica da operação sem IPI: vProd + frete + seguro + outras - desconto. */
  baseSemIpi?: number;
  /** Campo legado usado nas planilhas: IPI + frete + seguro + outras despesas. */
  ipiDespesas: number;
  /** IPI isolado, necessário para não confundir redução de BC com despesa. */
  vIpi?: number;
  aOri: number;
  vIcms: number;
  /** Percentual de crédito do Simples (pCredSN); não equivale ao pICMS. */
  pCredSN?: number;
  /** CSOSN extraído do XML ou registro C170 do SPED. */
  csosn?: string;
  origemMercadoria?: string;
  /** CST (2 dígitos) ou CSOSN (3 dígitos), sem o dígito de origem. */
  cstIcms?: string;
  pRedBC?: number;
  /** Desconto comercial destacado no item (tag vDesc). */
  vDesc?: number;
  /** ICMS ST retido na origem / destacado no item (tag vICMSST). */
  vIcmsSt?: number;
  /** MVA comprovada em ST sobre mercadoria sem frete FOB, exclusivamente para CT-e. */
  freteFobStMva?: number;
  /** Redução de BC-ST comprovada no XML, em fração. */
  freteFobStReducao?: number;
  /** Evidência declarada por item no XML; não constitui MVA fiscal automaticamente. */
  stXml?: { cfop: string; modalidade: string; mva: number; aliquota: number; base: number; valor: number };
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
  /** Desconto comercial total destacado na nota (tag vDesc no total da NF-e). */
  vDescNota?: number;
  /** Total de ICMS ST destacado na nota (tag vST em total/ICMSTot). */
  vStNota?: number;
  /** Alíquota de crédito de ICMS autorizada em Informações Complementares (ex: 0.0359); null se ausente. */
  aliqCreditoIcmsInfCompl?: number | null;
  /** Situação no protocolo de autorização (protNFe/infProt): cStat 100/150 = autorizada. */
  cStatProtocolo?: string | null;
  protocoloAutorizacao?: string | null;
  origemExtracao: 'xml' | 'sped';
  rawMetadata: Record<string, string | number | boolean | null>;
  itens: ExtractedItem[];
}

export interface ExtractedCTe {
  filename: string;
  chaveAcesso: string;
  numeroCte: string;
  serie: string;
  cfop: string;
  cnpjEmitente: string;
  nomeEmitente: string;
  ufEmitente: string;
  ufInicio: string;
  ufFim: string;
  cnpjTomador: string;
  tomaCodigo: string;
  dataEmissao: string;
  dataEntrada?: string | null;
  vTotalCte: number;
  vBcCte: number;
  aOri: number;
  aOriHighlighted: boolean;
  vIcmsCte: number;
  fornecedorSimplesNacional: boolean;
  chavesNfe: string[];
  rawMetadata: Record<string, string | number | boolean | null>;
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
  ctes?: ExtractedCTe[];
  entryRecords: EntrySheetRecord[];
  spedCteRecords?: EntrySheetRecord[];
  spedCompanyInfo: {
    cnpj?: string;
    uf?: string;
    ie?: string;
    nome?: string;
  };
  spedCompanyInfos?: Array<{
    cnpj?: string;
    uf?: string;
    ie?: string;
    nome?: string;
  }>;
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
  /**
   * Aviso de cadastro para o resultado, sem o prefixo do item: hoje, regras de
   * redução redundantes (mais de uma casou o item, todas com o mesmo valor).
   */
  aviso?: string;
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
