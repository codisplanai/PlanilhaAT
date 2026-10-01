import type { TipoPlanilha } from '../../types/solicitacao';

export const MODELO_OFICIAL_POR_TIPO: Record<string, string> = {
  antecipacao_parcial: 'RP-153',
  antecipacao_parcial_antecipado: 'RP-155',
  antecipacao_parcial_simples: 'RP-154',
  antecipacao_parcial_antecipado_simples: 'RP-156',
  antecipacao_tributaria: 'RP-151',
  antecipacao_tributaria_antecipado: 'RP-151',
  difal: 'RP-158',
};

export const TIPO_PLANILHA_CURTO: Record<string, string> = {
  antecipacao_parcial: 'Parcial',
  antecipacao_parcial_antecipado: 'Parcial-Antecipado',
  antecipacao_parcial_simples: 'Parcial-Simples',
  antecipacao_parcial_antecipado_simples: 'Parcial-Ant-Simples',
  antecipacao_tributaria: 'AT',
  antecipacao_tributaria_antecipado: 'AT-Antecipado',
  difal: 'DIFAL',
};

const CORPORATE_SUFFIXES = new Set([
  'LTDA',
  'ME',
  'EPP',
  'EIRELI',
  'SA',
  'CIA',
  'COMPANHIA',
  'MEI',
  'UNIPESSOAL',
  'SOCIEDADE',
  'INDIVIDUAL',
  'EIRELI-ME',
  'LTDA-ME',
  'LTDA-EPP',
]);

const STOP_WORDS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'PARA', 'COM', 'EM']);

/**
 * Higieniza a razão social para um nome curto, legível e seguro para sistemas de arquivos.
 * Remove acentos, pontuação, sufixos societários e limita o tamanho total.
 */
export function sanitizeCompanyName(rawName: string, maxLength = 18): string {
  if (!rawName || typeof rawName !== 'string') return 'Empresa';

  // 1. Remove acentuação
  const normalized = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // 2. Remove termos societários com barras/pontos como S/A e S.A.
  const withoutCorporateSlashes = normalized
    .replace(/\bS\s*[/.]\s*A\b\.?/gi, ' ')
    .replace(/[^\w\s]/g, ' ');

  // 3. Quebra em palavras
  const words = withoutCorporateSlashes
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) return 'Empresa';

  // 4. Remove sufixos societários comuns
  const filteredWords = words.filter((w) => !CORPORATE_SUFFIXES.has(w.toUpperCase()));
  const candidateWords = filteredWords.length > 0 ? filteredWords : words;

  // 5. Monta em PascalCase respeitando o limite máximo
  let result = '';
  for (const word of candidateWords) {
    const upper = word.toUpperCase();
    if (result.length > 0 && STOP_WORDS.has(upper)) {
      continue;
    }
    const formatted = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (result.length + formatted.length <= maxLength) {
      result += formatted;
    } else {
      if (result.length === 0) {
        result = formatted.slice(0, maxLength);
      }
      break;
    }
  }

  return result || 'Empresa';
}

/**
 * Resolve o modelo oficial SEFAZ (ex: RP-153, RP-158, RP-151)
 * a partir das observações do template ou pelo tipo da planilha.
 */
export function resolveModeloPlanilha(
  tipo: TipoPlanilha | string,
  observacoes?: string | null,
): string {
  if (observacoes) {
    const match = observacoes.match(/\bRP[- ]?(\d+)\b/i);
    if (match) {
      return `RP-${match[1]}`;
    }
  }
  return MODELO_OFICIAL_POR_TIPO[tipo] ?? 'RP';
}

/**
 * Converte o identificador interno da planilha em uma sigla/nome conciso.
 */
export function resolveTipoCurto(tipo: TipoPlanilha | string): string {
  return TIPO_PLANILHA_CURTO[tipo] ?? tipo.replace(/^antecipacao_/, '').toUpperCase();
}

/**
 * Formata a competência no padrão MM-AAAA.
 */
export function formatCompetenciaNome(month: number | string, year: number | string): string {
  const m = String(month).replace(/\D/g, '').padStart(2, '0');
  const y = String(year).replace(/\D/g, '');
  return `${m}-${y}`;
}

export interface BuildSpreadsheetFilenameParams {
  razaoSocial: string;
  tipo: TipoPlanilha | string;
  month: number | string;
  year: number | string;
  observacoes?: string | null;
}

/**
 * Monta o nome amigável da planilha gerada:
 * [Modelo]_[Empresa]_[Tipo]_[MM-AAAA].xlsx
 * Exemplo: RP-153_PassoAPasso_Parcial_09-2026.xlsx
 */
export function buildSpreadsheetFilename(params: BuildSpreadsheetFilenameParams): string {
  const empresa = sanitizeCompanyName(params.razaoSocial);
  const modelo = resolveModeloPlanilha(params.tipo, params.observacoes);
  const tipoCurto = resolveTipoCurto(params.tipo);
  const competencia = formatCompetenciaNome(params.month, params.year);
  return `${modelo}_${empresa}_${tipoCurto}_${competencia}.xlsx`;
}

/**
 * Monta o nome amigável do arquivo compactado (.zip) quando há múltiplas planilhas:
 * [Empresa]_Planilhas_[MM-AAAA].zip
 */
export function buildZipFilenameFromArtifacts(
  artifacts: Array<{ filename: string }>,
  fallbackId: string,
): string {
  if (artifacts.length > 0 && artifacts[0].filename) {
    const base = artifacts[0].filename.replace(/\.xlsx$/i, '');
    const parts = base.split('_');
    if (parts.length >= 4) {
      const empresa = parts[0].startsWith('RP-') ? parts[1] : parts[0];
      const competencia = parts[parts.length - 1];
      return `${empresa}_Planilhas_${competencia}.zip`;
    }
  }
  return `planilhas_${fallbackId.slice(0, 8)}.zip`;
}
