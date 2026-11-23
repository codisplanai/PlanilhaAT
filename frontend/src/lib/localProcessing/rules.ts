import type { JsonObject } from '../../types/common';
import type { LocalProcessingContext, LocalMvaEntry } from '../../types/localProcessing';
import type { CfopResolution, ExtractedItem, ExtractedNote, TaxRateResolution } from './domain';
import type { TipoPlanilha } from '../../types/solicitacao';
import type { MvaAntecipacaoTributariaConfig } from '../../types/perfil';
import { PARTIAL_DESTINATIONS, normalizeDescription } from './domain.ts';
import { calculateTax } from './calculations.ts';
import { CONVENIO_52_91_RATE_ORIGIN } from './convenio5291.ts';

export { PARTIAL_DESTINATIONS, normalizeDescription };

export interface RevendaMvaClassification {
  grupo: 'especial' | 'demais';
  fonte: string;
  aviso?: string;
}

export function getRevendaAntecipacaoConfig(
  context: LocalProcessingContext,
): MvaAntecipacaoTributariaConfig | null {
  const config = context.perfil.configuracoes_extras.mva_revenda_antecipacao_tributaria;
  if (!config || config.enabled !== true) return null;
  const expectedCnpj = String(config.empresa_cnpj ?? '').replace(/\D/g, '');
  const actualCnpj = String(context.empresa.cnpj ?? '').replace(/\D/g, '');
  return expectedCnpj && expectedCnpj === actualCnpj ? config : null;
}

export function redirectRevendaToAntecipacaoTributaria(
  config: MvaAntecipacaoTributariaConfig | null,
  destination: TipoPlanilha,
): TipoPlanilha {
  return config && destination === 'antecipacao_parcial'
    ? 'antecipacao_tributaria'
    : destination;
}

export function routePaidEarlyDestination(
  destination: TipoPlanilha,
  paidEarly: boolean,
  isSimples = false,
): TipoPlanilha {
  if (!paidEarly) return destination;
  if (destination === 'antecipacao_parcial') return 'antecipacao_parcial_antecipado';
  if (destination === 'antecipacao_tributaria') return 'antecipacao_tributaria_antecipado';
  // Simples Nacional: DIFAL da mercadoria ainda sem entrada é paga antecipadamente.
  if (destination === 'difal' && isSimples) return 'difal_antecipado';
  return destination;
}

export const DIFAL_AWAITING_ENTRY_REASON =
  'Bonificação/amostra/outras entradas para uso/consumo sem entrada no período: '
  + 'no Regime Normal a DIFAL é apurada no mês da entrada (SPED).';

export function isDifalDestination(destination: TipoPlanilha): boolean {
  return destination === 'difal' || destination === 'difal_antecipado';
}

/**
 * Regime Normal: nota emitida antes do período, mas escriturada no SPED do
 * período, entra na DIFAL de uso/consumo e ativo (somente os itens de DIFAL).
 */
export function acceptsRetroactiveDifal(
  note: ExtractedNote,
  periodoInicio: string,
  isSimples: boolean,
): boolean {
  return !isSimples && note.origemExtracao === 'sped' && note.dataEmissao.slice(0, 10) < periodoInicio;
}

export function retroactiveDifalWarning(note: ExtractedNote): string {
  const [year, month, day] = note.dataEmissao.slice(0, 10).split('-');
  return `Nota emitida antes do período (${day}/${month}/${year}) com entrada no SPED do período: `
    + 'apenas itens de DIFAL (uso/consumo e ativo) foram considerados.';
}

export function classifyRevendaMva(
  config: MvaAntecipacaoTributariaConfig,
  item: ExtractedItem,
): RevendaMvaClassification {
  const cleanNcm = item.ncm.replace(/\D/g, '');
  const description = item.descricaoConfiavel ? normalizeDescription(item.descricao) : '';

  if (description && anyTerm(description, config.exclusion_keywords)) {
    return {
      grupo: 'demais',
      fonte: 'descricao_exclusao',
      aviso: `NCM ${cleanNcm || 'ausente'} mantido em 'demais produtos' porque a descrição identifica mercadoria fora do grupo bolsas/cintos/calçados/carteiras.`,
    };
  }

  const specialNcms = new Set(config.special_ncms.map((value) => value.replace(/\D/g, '')).filter(Boolean));
  if (specialNcms.has(cleanNcm)) return { grupo: 'especial', fonte: 'ncm_exato' };

  const fallbackNcms = new Set(
    config.description_fallback_ncms.map((value) => value.replace(/\D/g, '')).filter(Boolean),
  );
  if (fallbackNcms.has(cleanNcm)) {
    if (!item.descricaoConfiavel || !description) {
      return {
        grupo: 'demais',
        fonte: 'fallback_sem_descricao_confiavel',
        aviso: `NCM ${cleanNcm} exige confirmação por descrição para entrar no grupo especial; como a descrição não é confiável, foi usado o grupo 'demais produtos'.`,
      };
    }
    if (anyTerm(description, config.special_keywords)) {
      return {
        grupo: 'especial',
        fonte: 'ncm_fallback_descricao',
        aviso: `NCM ${cleanNcm} classificado como especial por confirmação da descrição do produto.`,
      };
    }
    return { grupo: 'demais', fonte: 'ncm_fallback_sem_match' };
  }

  return { grupo: 'demais', fonte: 'padrao' };
}

export function resolveRevendaMva(
  config: MvaAntecipacaoTributariaConfig,
  grupo: RevendaMvaClassification['grupo'],
  aOri: number,
  fornecedorSimples: boolean,
): number {
  const key = fornecedorSimples
    ? 'original'
    : aOri <= 0
      ? '12'
      : aOri <= 0.05 || (aOri >= 3.5 && aOri <= 4.5)
        ? '4'
        : aOri <= 0.09 || (aOri >= 6.5 && aOri <= 7.5)
          ? '7'
          : aOri <= 0.15 || (aOri >= 11.5 && aOri <= 12.5)
            ? '12'
            : null;
  if (!key) throw new Error(`Alíquota de origem '${aOri}' não possui MVA parametrizada para este perfil.`);
  const value = Number(config.mvas[grupo][key]);
  if (!Number.isFinite(value)) {
    throw new Error(`MVA '${key}' não configurada para o grupo '${grupo}'.`);
  }
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
}

function tokenPattern(token: string, isLast: boolean, prefix: boolean): string {
  if (isLast && prefix) {
    if (token.startsWith('VERGALH')) {
      return `(?:${escapeRegex(token)}[A-Z0-9]*|VERG(?![A-Z0-9]))`;
    }
    return `${escapeRegex(token)}[A-Z0-9]*`;
  }
  if (token === 'VERGALHAO' || token === 'VERGALHOES') {
    return `(?:${escapeRegex(token)}|VERG)(?![A-Z0-9])`;
  }
  return `${escapeRegex(token)}(?![A-Z0-9])`;
}

export function termMatches(normalizedDescription: string, rawTerm: string): boolean {
  let term = String(rawTerm ?? '').trim();
  const prefix = term.endsWith('*');
  if (prefix) term = term.slice(0, -1);
  const normalized = normalizeDescription(term);
  if (!normalized || !normalizedDescription) return false;
  const tokens = normalized.split(/\s+/);
  const body = tokens
    .map((token, idx) => tokenPattern(token, idx === tokens.length - 1, prefix))
    .join('\\s+');
  return new RegExp(`(?<![A-Z0-9])${body}`).test(normalizedDescription);
}

function anyTerm(desc: string, terms?: string[] | null): boolean {
  return (terms ?? []).some((term) => termMatches(desc, term));
}

function allTerms(desc: string, terms?: string[] | null): boolean {
  return Boolean(terms?.length) && (terms ?? []).every((term) => termMatches(desc, term));
}

function cfopSuffix(cfop?: string | null): string | null {
  const clean = String(cfop ?? '').replace(/\D/g, '');
  if (clean.length !== 4 || ['3', '7'].includes(clean[0])) return null;
  return clean.slice(-3);
}

function routeBySuffix(context: LocalProcessingContext, suffix: string): string | null {
  const profileRule = context.regras_cfop.find(
    (rule) => rule.perfil_regras_id === context.perfil.id && rule.cfop_sufixo === suffix,
  );
  const globalRule = context.regras_cfop.find(
    (rule) => rule.perfil_regras_id == null && rule.cfop_sufixo === suffix,
  );
  const destination = (profileRule ?? globalRule)?.destino;
  return !destination || destination === 'ignorar' ? null : destination;
}

export function resolveCfop(
  context: LocalProcessingContext,
  item: ExtractedItem,
): CfopResolution {
  const original = item.cfop;
  const suffix = cfopSuffix(original);
  if (!suffix) {
    return { cfopEfetivo: original, sufixoEfetivo: null, destino: null, reclassificado: false };
  }

  const ncm = item.ncm.replace(/\D/g, '');
  if (ncm.length !== 8 || ncm === '00000000') {
    return {
      cfopEfetivo: original,
      sufixoEfetivo: suffix,
      destino: routeBySuffix(context, suffix),
      reclassificado: false,
    };
  }

  const candidates = context.regras_reclassificacao.filter(
    (rule) => rule.ncm === ncm && (!rule.cfop_origem_sufixo || rule.cfop_origem_sufixo === suffix),
  );
  if (candidates.length === 0) {
    return {
      cfopEfetivo: original,
      sufixoEfetivo: suffix,
      destino: routeBySuffix(context, suffix),
      reclassificado: false,
    };
  }

  const desc = item.descricaoConfiavel ? normalizeDescription(item.descricao) : '';
  const apply = (rule: (typeof candidates)[number], motivo: string): CfopResolution => {
    const effectiveSuffix = rule.cfop_destino_sufixo;
    const prefix = original.charAt(0) || '6';
    return {
      cfopEfetivo: `${prefix}${effectiveSuffix}`,
      sufixoEfetivo: effectiveSuffix,
      destino: routeBySuffix(context, effectiveSuffix),
      reclassificado: true,
      motivo,
    };
  };

  if (desc) {
    for (const rule of candidates) {
      const exception = rule.excecoes?.find((itemException) => itemException.descricao_exata === desc);
      if (exception?.aplicar) return apply(rule, `Exceção exata na regra NCM ${rule.ncm}`);
    }
  }

  for (const rule of candidates.filter((candidate) => (candidate.termos_inclusao ?? []).length > 0)) {
    if (!desc) continue;
    const blocked = rule.excecoes?.some((exception) => exception.descricao_exata === desc && !exception.aplicar);
    if (blocked || anyTerm(desc, rule.termos_exclusao)) continue;
    if (anyTerm(desc, rule.termos_inclusao)) {
      return apply(rule, rule.descricao || `Regra NCM ${rule.ncm} + Termos`);
    }
  }

  for (const rule of candidates.filter((candidate) => (candidate.termos_inclusao ?? []).length === 0)) {
    const blocked = desc && rule.excecoes?.some((exception) => exception.descricao_exata === desc && !exception.aplicar);
    if (blocked || (desc && anyTerm(desc, rule.termos_exclusao))) continue;
    return apply(rule, rule.descricao || `Regra genérica NCM ${rule.ncm}`);
  }

  return {
    cfopEfetivo: original,
    sufixoEfetivo: suffix,
    destino: routeBySuffix(context, suffix),
    reclassificado: false,
  };
}

type ReductionScope = 'antecipacao_parcial' | 'antecipacao_tributaria';

interface ProductRuleExceptionLike {
  id: number;
  descricao_exata: string;
  enquadrado: boolean;
}

interface ProductRuleLike {
  id: number;
  ncm: string;
  termos_inclusao?: string[] | null;
  termos_exclusao?: string[] | null;
  aliquota: number;
  descricao?: string | null;
  excecoes?: ProductRuleExceptionLike[] | null;
}

/** Regra de produto ou FCP que casou um item, e por quê. */
interface ProductRuleMatch {
  rule: ProductRuleLike;
  /** Exceção de descrição exata (enquadrada) pela qual a regra casou. */
  exceptionId?: number;
  /** Termos de inclusão que casaram com a descrição; vazio em regra sem termos. */
  terms: string[];
}

interface ProductRuleResolutionContext {
  ruleOriginPrefix: string;
  exceptionOriginPrefix: string;
  ruleDetailLabel: string;
  exceptionDetailLabel: string;
  scopeLabel: string;
  valueNoun: 'alíquota' | 'redução';
  conflictNoun: string;
  warningRulesLabel: string;
  warningExceptionsLabel: string;
}

const REDUCTION_SCOPE_LABELS: Record<ReductionScope, string> = {
  antecipacao_parcial: 'Antecipação Parcial',
  antecipacao_tributaria: 'Antecipação Tributária',
};

const FCP_RESOLUTION_CONTEXT: ProductRuleResolutionContext = {
  ruleOriginPrefix: 'fcp_produto',
  exceptionOriginPrefix: 'excecao_fcp',
  ruleDetailLabel: 'FCP por produto',
  exceptionDetailLabel: 'Exceção de FCP cadastrada na regra',
  scopeLabel: 'FCP',
  valueNoun: 'alíquota',
  conflictNoun: 'de FCP',
  warningRulesLabel: 'as regras de FCP',
  warningExceptionsLabel: 'as exceções de FCP',
};

function reductionResolutionContext(escopo: ReductionScope): ProductRuleResolutionContext {
  return {
    ruleOriginPrefix: 'reducao_produto',
    exceptionOriginPrefix: 'excecao',
    ruleDetailLabel: 'Redução por produto',
    exceptionDetailLabel: 'Exceção cadastrada na regra',
    scopeLabel: REDUCTION_SCOPE_LABELS[escopo],
    valueNoun: escopo === 'antecipacao_tributaria' ? 'redução' : 'alíquota',
    conflictNoun: 'de redução',
    warningRulesLabel: 'as reduções por produto',
    warningExceptionsLabel: 'as exceções das reduções',
  };
}

function normalizeNcm(ncm?: string | null): string {
  const clean = String(ncm ?? '').replace(/\D/g, '');
  if (clean.length < 4 || /^0+$/.test(clean)) return '';
  return clean;
}

/** Compara na precisão gravada no cadastro (Numeric 8,5). */
function sameReductionValue(a: number, b: number): boolean {
  return Math.round(a * 100000) === Math.round(b * 100000);
}

function formatReductionValue(value: number): string {
  const pct = Math.round((value * 100 + Number.EPSILON) * 1000) / 1000;
  const decimals = Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-4 ? 3 : 2;
  return `${pct.toFixed(decimals).replace('.', ',')}%`;
}

function quotedList(values: string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} e ${values[values.length - 1]}`;
}

function describeProductRuleMatch(match: ProductRuleMatch): string {
  const { rule } = match;
  const label = rule.descricao?.trim() ? `"${rule.descricao.trim()}"` : 'sem descrição';
  const reason = match.exceptionId != null
    ? `casou pela exceção de descrição exata #${match.exceptionId}`
    : match.terms.length > 0
      ? `casou com ${match.terms.length > 1 ? 'os termos' : 'o termo'} ${quotedList(match.terms)}`
      : 'sem termos de inclusão (vale para todo o NCM)';
  return `#${rule.id} ${label} — NCM ${rule.ncm}, ${formatReductionValue(Number(rule.aliquota))}, ${reason}`;
}

function shortProductRuleMatch(match: ProductRuleMatch): string {
  const reason = match.exceptionId != null
    ? `exceção #${match.exceptionId}`
    : match.terms.length > 0
      ? `${match.terms.length > 1 ? 'termos' : 'termo'} ${quotedList(match.terms)}`
      : 'sem termos';
  return `#${match.rule.id} (${reason})`;
}

/**
 * Mais de uma regra (ou exceção) de mesma especificidade casou o item.
 *
 * Com o mesmo valor em todas, o resultado não é ambíguo: o valor é aplicado e
 * a redundância vira aviso, para o cadastro ser unificado. Com valores
 * diferentes, escolher uma regra seria adivinhar: o processamento para com as
 * regras que colidiram e o que fazer a respeito.
 */
function resolveProductRuleCollision(
  item: ExtractedItem,
  ncm: string,
  ctx: ProductRuleResolutionContext,
  matches: ProductRuleMatch[],
  kind: 'regras' | 'excecoes',
): TaxRateResolution {
  const ordered = [...matches].sort((a, b) => a.rule.id - b.rule.id);
  const value = Number(ordered[0].rule.aliquota);
  const itemLabel = item.descricao?.trim() || ncm;
  const subject = kind === 'excecoes' ? 'exceções' : 'regras';

  if (!ordered.every((match) => sameReductionValue(Number(match.rule.aliquota), value))) {
    const lines = ordered.map((match) => `  ${describeProductRuleMatch(match)}`).join('\n');
    const instruction = kind === 'excecoes'
      ? 'Mantenha a exceção com esta descrição só na regra que deve prevalecer, para que o sistema saiba qual aplicar.'
      : 'Cadastre uma exceção com a descrição exata deste item na regra que deve prevalecer, para que o sistema saiba qual aplicar.';
    throw new Error(
      `Conflito de ${subject} ${ctx.conflictNoun} no item "${itemLabel}" (NCM ${ncm}).\n\n`
      + `Estas ${subject} da aba ${ctx.scopeLabel} casaram o mesmo item com valores diferentes:\n${lines}\n\n`
      + instruction,
    );
  }

  const first = ordered[0];
  const ids = joinWithAnd(ordered.map((match) => `#${match.rule.id}`));
  const valueLabel = formatReductionValue(value);
  return {
    aliquota: value,
    origem: first.exceptionId != null
      ? `${ctx.exceptionOriginPrefix}:${first.exceptionId}`
      : `${ctx.ruleOriginPrefix}:${first.rule.id}`,
    detalhe: kind === 'excecoes'
      ? `Exceções cadastradas nas regras ${ids} (mesma ${ctx.valueNoun} de ${valueLabel})`
      : `${ctx.ruleDetailLabel}: regras ${ids} (mesma ${ctx.valueNoun} de ${valueLabel})`,
    aviso: `${kind === 'excecoes' ? ctx.warningExceptionsLabel : ctx.warningRulesLabel} `
      + `${joinWithAnd(ordered.map(shortProductRuleMatch))} da aba ${ctx.scopeLabel} casaram com `
      + `"${itemLabel}" (NCM ${ncm}), todas com ${valueLabel}; a ${ctx.valueNoun} foi aplicada. `
      + 'Unifique essas regras no perfil: se os valores passarem a divergir, o processamento '
      + 'será interrompido por conflito.',
  };
}

function matchedTerms(desc: string, terms?: string[] | null): string[] {
  return (terms ?? []).filter((term) => termMatches(desc, term));
}

function selectMostSpecificProductRule(
  candidates: ProductRuleLike[],
  item: ExtractedItem,
  ncm: string,
  ctx: ProductRuleResolutionContext,
  desc = '',
): TaxRateResolution {
  const maxLen = Math.max(...candidates.map((rule) => rule.ncm.trim().length));
  const mostSpecific = candidates.filter((rule) => rule.ncm.trim().length === maxLen);
  if (mostSpecific.length > 1) {
    return resolveProductRuleCollision(
      item,
      ncm,
      ctx,
      mostSpecific.map((rule) => ({
        rule,
        terms: desc ? matchedTerms(desc, rule.termos_inclusao) : [],
      })),
      'regras',
    );
  }
  const rule = mostSpecific[0];
  return {
    aliquota: Number(rule.aliquota),
    origem: `${ctx.ruleOriginPrefix}:${rule.id}`,
    detalhe: `${ctx.ruleDetailLabel}: ${rule.descricao || `regra #${rule.id}`}`,
  };
}

function resolveProductRules(
  rules: ProductRuleLike[],
  item: ExtractedItem,
  ncm: string,
  ctx: ProductRuleResolutionContext,
): TaxRateResolution | null {
  const desc = item.descricaoConfiavel ? normalizeDescription(item.descricao) : '';
  let activeRules = rules;

  if (desc) {
    const exact = activeRules.flatMap((rule) =>
      (rule.excecoes ?? [])
        .filter((exception) => exception.descricao_exata === desc)
        .map((exception) => ({ rule, exception })),
    );
    const positiveExact = exact.filter((entry) => entry.exception.enquadrado);
    if (positiveExact.length > 1) {
      return resolveProductRuleCollision(
        item,
        ncm,
        ctx,
        positiveExact.map((entry) => ({ rule: entry.rule, exceptionId: entry.exception.id, terms: [] })),
        'excecoes',
      );
    }
    if (positiveExact.length === 1) {
      return {
        aliquota: Number(positiveExact[0].rule.aliquota),
        origem: `${ctx.exceptionOriginPrefix}:${positiveExact[0].exception.id}`,
        detalhe: `${ctx.exceptionDetailLabel} #${positiveExact[0].rule.id}`,
      };
    }
    const blockedRuleIds = new Set(
      exact.filter((entry) => !entry.exception.enquadrado).map((entry) => entry.rule.id),
    );
    if (blockedRuleIds.size > 0) {
      activeRules = activeRules.filter((rule) => !blockedRuleIds.has(rule.id));
      if (activeRules.length === 0) {
        return null;
      }
    }
  }

  const rulesWithTerms = activeRules.filter((rule) => (rule.termos_inclusao ?? []).length > 0);
  if (desc && rulesWithTerms.length > 0) {
    const matched = rulesWithTerms.filter(
      (rule) => anyTerm(desc, rule.termos_inclusao) && !anyTerm(desc, rule.termos_exclusao),
    );
    if (matched.length > 0) {
      return selectMostSpecificProductRule(matched, item, ncm, ctx, desc);
    }
  }

  const genericRules = activeRules.filter((rule) => (rule.termos_inclusao ?? []).length === 0);
  if (genericRules.length > 0) {
    const matchedGeneric = genericRules.filter(
      (rule) => !(desc && anyTerm(desc, rule.termos_exclusao)),
    );
    if (matchedGeneric.length > 0) {
      return selectMostSpecificProductRule(matchedGeneric, item, ncm, ctx);
    }
  }

  return null;
}

function matchProductReductionRule(
  context: LocalProcessingContext,
  item: ExtractedItem,
  escopo: ReductionScope,
): TaxRateResolution | null {
  const ncm = item.ncm.trim();
  const cleanNcm = normalizeNcm(ncm);
  if (!cleanNcm) {
    return null;
  }

  const reductionRules = context.regras_reducao.filter(
    (rule) =>
      (rule.escopo ?? 'antecipacao_parcial') === escopo &&
      Boolean(rule.ncm) &&
      cleanNcm.startsWith(rule.ncm.trim()),
  );
  if (reductionRules.length === 0) {
    return null;
  }

  return resolveProductRules(reductionRules, item, ncm, reductionResolutionContext(escopo));
}

export function resolveTributariaReduction(
  context: LocalProcessingContext,
  item: ExtractedItem,
): TaxRateResolution | null {
  return matchProductReductionRule(context, item, 'antecipacao_tributaria');
}

export function resolveFcp(
  context: LocalProcessingContext,
  item: ExtractedItem,
): TaxRateResolution | null {
  const uf = context.empresa.uf.trim().toUpperCase();
  const ncm = item.ncm.trim();
  const cleanNcm = normalizeNcm(ncm);
  if (!uf || !cleanNcm) {
    return null;
  }

  const hasAgreement = Boolean(context.empresa.termo_acordo);
  const fcpRules = (context.regras_fcp ?? []).filter(
    (rule) =>
      rule.perfil_regras_id === context.perfil.id &&
      rule.uf.trim().toUpperCase() === uf &&
      Boolean(rule.ncm) &&
      cleanNcm.startsWith(rule.ncm.trim()) &&
      !(hasAgreement && rule.aplicar_com_termo_acordo === false),
  );
  if (fcpRules.length === 0) {
    return null;
  }

  return resolveProductRules(fcpRules, item, ncm || cleanNcm, FCP_RESOLUTION_CONTEXT);
}

function findDefaultUfRule(context: LocalProcessingContext, uf: string) {
  return context.regras_aliquotas.find(
    (rule) =>
      (rule.perfil_regras_id == null || rule.perfil_regras_id === context.perfil.id) &&
      rule.uf.trim().toUpperCase() === uf &&
      !rule.ncm,
  );
}

export function resolveDestinationRate(
  context: LocalProcessingContext,
  item: ExtractedItem,
  destination?: TipoPlanilha,
): TaxRateResolution {
  const uf = context.empresa.uf.trim().toUpperCase();

  // DIFAL: ignora reduções por produto, termos de acordo e exceções por NCM.
  // Prevalece estritamente a Alíquota Padrão da UF.
  if (destination === 'difal' || destination === 'difal_antecipado') {
    const defaultRule = findDefaultUfRule(context, uf);
    if (defaultRule) {
      return {
        aliquota: Number(defaultRule.aliquota),
        origem: `padrao_uf:${defaultRule.id}`,
        detalhe: `Alíquota padrão da UF ${uf}`,
      };
    }
    throw new Error(`Nenhuma regra de alíquota padrão da UF encontrada para UF ${uf}.`);
  }

  const isTributaria =
    destination === 'antecipacao_tributaria' ||
    destination === 'antecipacao_tributaria_antecipado';

  if (!isTributaria) {
    const matchedParcial = matchProductReductionRule(context, item, 'antecipacao_parcial');
    if (matchedParcial) {
      return matchedParcial;
    }
  }

  const agreement = context.empresa.termo_acordo;
  if (agreement && !isTributaria) {
    return {
      aliquota: Number(agreement.aliquota),
      origem: `termo_acordo:${agreement.id}`,
      detalhe: `Termo de acordo da empresa: ${agreement.descricao || `regra #${agreement.id}`}`,
    };
  }

  return resolveStandardDestinationRate(context, item);
}

export function resolveStandardDestinationRate(
  context: LocalProcessingContext,
  item: ExtractedItem,
): TaxRateResolution {
  const uf = context.empresa.uf.trim().toUpperCase();
  const cleanNcm = normalizeNcm(item.ncm);
  if (cleanNcm) {
    const candidates = context.regras_aliquotas.filter(
      (rule) =>
        (rule.perfil_regras_id == null || rule.perfil_regras_id === context.perfil.id) &&
        rule.uf.trim().toUpperCase() === uf &&
        Boolean(rule.ncm) &&
        cleanNcm.startsWith(rule.ncm!.trim()),
    );
    if (candidates.length > 0) {
      const ncmRule = candidates.reduce((best, current) =>
        current.ncm!.trim().length > best.ncm!.trim().length ? current : best,
      );
      const matchedPrefix = ncmRule.ncm!.trim();
      return {
        aliquota: Number(ncmRule.aliquota),
        origem: `regra_ncm:${ncmRule.id}`,
        detalhe: `Exceção por NCM ${matchedPrefix} na UF ${uf}`,
      };
    }
  }

  const defaultRule = findDefaultUfRule(context, uf);
  if (defaultRule) {
    return {
      aliquota: Number(defaultRule.aliquota),
      origem: `padrao_uf:${defaultRule.id}`,
      detalhe: `Alíquota padrão da UF ${uf}`,
    };
  }

  throw new Error(`Nenhuma regra de alíquota de destino encontrada para UF ${uf} e NCM ${item.ncm.trim()}.`);
}

export function calculateTributariaBaseReduction(
  effectiveRate: number,
  standardRate: number,
): number | null {
  if (!(standardRate > 0) || !(effectiveRate > 0) || effectiveRate >= standardRate) {
    return null;
  }
  return Math.round(((1 - effectiveRate / standardRate) + Number.EPSILON) * 100000) / 100000;
}

export interface OriginRateResolution {
  aOri: number;
  limited: boolean;
  fixed: boolean;
  limitWaived: boolean;
}

const REDUCED_RATE_ORIGINS = ['reducao_produto:', 'excecao:', 'termo_acordo:'];

// Mesma tolerância para dispensar o limite de 10% e para excluir itens com
// alíquotas iguais: as duas regras precisam concordar sobre o que é "igual".
function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-10;
}

export function resolveOriginRate(
  context: LocalProcessingContext,
  destination: TipoPlanilha,
  aOri: number,
  aDst: number,
  rateOrigin: string,
): OriginRateResolution {
  // Acordo com a SEFAZ: a empresa credita sempre a alíquota fixa na Parcial,
  // qualquer que seja a do XML. O Convênio 52/91 troca A.ORI, A.DST e base em
  // conjunto, então continua valendo quando se aplica.
  const fixedRate = context.empresa.a_ori_fixa_parcial;
  if (
    fixedRate != null
    && PARTIAL_DESTINATIONS.has(destination)
    && rateOrigin !== CONVENIO_52_91_RATE_ORIGIN
  ) {
    return { aOri: Number(fixedRate), limited: false, fixed: true, limitWaived: false };
  }

  const limitOrigin = context.perfil.configuracoes_extras.limitar_a_ori_reducoes === true;
  const reducedOrAgreement = REDUCED_RATE_ORIGINS.some((prefix) => rateOrigin.startsWith(prefix));
  if (PARTIAL_DESTINATIONS.has(destination) && limitOrigin && reducedOrAgreement && aOri > 0.10) {
    // Na Parcial prevalece o tratamento mais benéfico: com a A.ORI do XML igual
    // à A.DST o imposto zera, e a regra de alíquotas iguais pode excluir o item.
    if (sameRate(aOri, aDst)) {
      return { aOri, limited: false, fixed: false, limitWaived: true };
    }
    return { aOri: 0.10, limited: true, fixed: false, limitWaived: false };
  }
  return { aOri, limited: false, fixed: false, limitWaived: false };
}

export function evaluatePartialMerchandiseExclusion(
  context: LocalProcessingContext,
  destination: TipoPlanilha,
  item: ExtractedItem,
): { excluded: boolean; motivo?: string; regras?: JsonObject[] } {
  if (!PARTIAL_DESTINATIONS.has(destination) || !item.descricaoConfiavel) return { excluded: false };
  const desc = normalizeDescription(item.descricao);
  const ncm = item.ncm.trim();
  if (!desc || !ncm || ncm === '00000000') return { excluded: false };

  const matches = context.regras_exclusao_parcial.filter(
    (rule) =>
      rule.ativo
      && rule.perfil_regras_id === context.perfil.id
      && rule.uf.toUpperCase() === context.empresa.uf.toUpperCase()
      && rule.ncm === ncm
      && allTerms(desc, rule.termos_obrigatorios),
  );
  if (matches.length === 0) return { excluded: false };
  const labels: Record<string, string> = {
    isencao: 'Isenção',
    imposto_pago_entrada: 'Imposto pago na entrada',
  };
  return {
    excluded: true,
    motivo: labels[matches[0].motivo] || matches[0].motivo,
    regras: matches.map((rule) => ({
      id: rule.id,
      ncm: rule.ncm,
      descricao_regra: rule.descricao,
      termos_obrigatorios: rule.termos_obrigatorios,
      motivo: rule.motivo,
    })),
  };
}

export function equalRatesPolicyEnabled(context: LocalProcessingContext): boolean {
  const raw = context.perfil.configuracoes_extras.politica_aliquotas_iguais_parcial;
  if (!raw || typeof raw !== 'object') return false;
  return (raw as Record<string, unknown>)[context.empresa.uf.toUpperCase()] === true;
}

export function shouldExcludeEqualRates(
  context: LocalProcessingContext,
  destination: TipoPlanilha,
  item: ExtractedItem,
  aOri: number,
  aDst: number,
): { excluded: boolean; debito?: number; credito?: number; valorDevido?: number } {
  if (!PARTIAL_DESTINATIONS.has(destination) || !equalRatesPolicyEnabled(context)) return { excluded: false };
  if (!sameRate(aOri, aDst) || item.vTotal <= 0) return { excluded: false };

  const base = item.baseCalculo <= 0 ? item.vTotal - item.ipiDespesas : item.baseCalculo;
  const result = calculateTax(destination, {
    vTotal: item.vTotal,
    baseCalculo: base,
    ipiDespesas: item.ipiDespesas,
    aOri,
    aDst,
    isSimples: Boolean(context.empresa.optante_simples_nacional),
  });
  return result.valorDevido <= 0
    ? { excluded: true, debito: result.debito, credito: result.credito, valorDevido: result.valorDevido }
    : { excluded: false };
}

/** Coluna do Anexo 1 usada no fluxo geral da Antecipação Tributária. */
export type MvaColumn = 'original' | 'ajustada';

/**
 * Coluna da MVA conforme o regime do fornecedor.
 * CRT 1 (Simples Nacional) e 4 (MEI) usam a MVA original; CRT 2 (Simples com
 * excesso de sublimite) e 3 (regime normal) usam a MVA ajustada. Sem CRT (nota
 * vinda só do SPED), vale o código de tributação: CSOSN é exclusivo de CRT 1 e 4,
 * e CST é usado por CRT 2 e 3. CRT com valor desconhecido retorna null.
 * Não substitui isSimplesSupplier, que segue valendo para A.ORI, DIFAL e para a
 * política especial do passo a passo.
 */
export function mvaColumnForNote(note: ExtractedNote): MvaColumn | null {
  const crt = String(note.rawMetadata.crt ?? '').trim();
  if (crt === '1' || crt === '4') return 'original';
  if (crt === '2' || crt === '3') return 'ajustada';
  if (crt) return null;
  const csosnEvidence = note.rawMetadata.fornecedor_simples_nacional === true
    || note.itens.some((item) => Boolean(item.csosn));
  return csosnEvidence ? 'original' : 'ajustada';
}

/** Faixa da MVA ajustada (4, 7 ou 12) para a A.ORI do documento, sem aproximar nem presumir 12%. */
export function interstateRateKey(aOri: number | null | undefined): '4' | '7' | '12' | null {
  if (aOri == null || !Number.isFinite(aOri) || aOri <= 0) return null;
  const percent = aOri <= 1 ? aOri * 100 : aOri;
  for (const key of ['4', '7', '12'] as const) {
    if (Math.abs(percent - Number(key)) < 0.005) return key;
  }
  return null;
}

export type MvaResolution =
  | { status: 'ok'; mva: number; column: MvaColumn; anexoItems: string[] }
  | { status: 'pendente'; motivo: string; column: MvaColumn | null; anexoItems: string[] };

function toFiniteNumber(raw: unknown): number | null {
  if (raw == null || raw === '' || typeof raw === 'boolean') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Todos os itens do Anexo cujo código casa com o NCM do documento. Não descarta
 * itens de código mais curto: itens com o mesmo NCM são separados pelo CEST, não
 * pelo tamanho do código no Anexo.
 */
function findNcmCandidates(entries: LocalMvaEntry[], cleanNcm: string): LocalMvaEntry[] {
  return entries.filter((entry) => {
    const code = String(entry.ncm ?? '').replace(/\D/g, '');
    if (!code) return false;
    return cleanNcm.startsWith(code) || (cleanNcm.length >= 4 && code.startsWith(cleanNcm));
  });
}

const CEST_PATTERN = /\d{2}\.?\d{3}\.?\d{2}/g;

/** CESTs de um item do Anexo, só com dígitos (um item pode ter mais de um). */
function entryCests(entry: LocalMvaEntry): Set<string> {
  const raw: unknown = entry.cest;
  const values = Array.isArray(raw) ? raw : [raw];
  const cests = new Set<string>();
  for (const value of values) {
    if (value == null) continue;
    for (const match of String(value).match(CEST_PATTERN) ?? []) cests.add(match.replace(/\D/g, ''));
  }
  return cests;
}

function formatCest(cest: string): string {
  return cest.length === 7 ? `${cest.slice(0, 2)}.${cest.slice(2, 5)}.${cest.slice(5)}` : cest;
}

function columnValue(
  entry: LocalMvaEntry,
  column: MvaColumn,
  key: string | null,
): { value: number | null; conditional: boolean } {
  const cases = (column === 'original' ? entry.mva_original : entry.mva_ajustada) ?? [];
  if (cases.length > 1) return { value: null, conditional: true };
  if (cases.length === 0) return { value: null, conditional: false };
  if (column === 'original') {
    return { value: toFiniteNumber((cases[0] as { valor?: unknown }).valor), conditional: false };
  }
  const rates = (cases[0] as { aliquotas?: Record<string, unknown> }).aliquotas ?? {};
  return { value: key ? toFiniteNumber(rates[key]) : null, conditional: false };
}

function anexoItemsLabel(items: string[], limit = 5): string {
  if (items.length === 0) return '';
  if (items.length === 1) return `, item ${items[0]} do Anexo 1`;
  const rest = items.length - limit;
  return `, itens ${items.slice(0, limit).join(', ')}${rest > 0 ? ` e mais ${rest}` : ''} do Anexo 1`;
}

function formatPercent(value: number): string {
  const text = value.toFixed(2);
  return `${(text.endsWith('.00') ? text.slice(0, -3) : text).replace('.', ',')}%`;
}

/**
 * MVA de um item de Antecipação Tributária no fluxo geral, sem valores de fallback.
 * A MVA ajustada usa a faixa da A.ORI destacada no documento.
 *
 * Itens possíveis: todos os itens do Anexo cujo código casa com o NCM. Com CEST no
 * documento, fica só o item desse CEST; se nenhum item possível tem esse CEST, há
 * divergência entre NCM e CEST e o item fica pendente. Sem CEST, a MVA só é usada
 * se for a mesma em todos os itens possíveis.
 *
 * Quando a MVA não pode ser determinada, retorna o motivo da pendência em vez de
 * MVA zero ou de um erro que interromperia todo o processamento.
 */
export function resolveMvaForItem(
  context: LocalProcessingContext,
  ncm: string,
  cest: string | undefined,
  aOri: number | null | undefined,
  column: MvaColumn | null,
): MvaResolution {
  if (!column) {
    return {
      status: 'pendente',
      column: null,
      anexoItems: [],
      motivo: 'MVA pendente: regime do fornecedor não identificado (CRT ausente ou inválido), sem como escolher entre MVA original e ajustada.',
    };
  }

  const cleanNcm = String(ncm ?? '').replace(/\D/g, '');
  if (!cleanNcm) {
    return { status: 'pendente', column, anexoItems: [], motivo: 'MVA pendente: item sem NCM no documento fiscal.' };
  }

  let key: '4' | '7' | '12' | null = null;
  if (column === 'ajustada') {
    key = interstateRateKey(aOri);
    if (!key) {
      const rate = toFiniteNumber(aOri);
      const description = rate == null || rate <= 0
        ? 'ausente no documento'
        : `de ${formatPercent(rate <= 1 ? rate * 100 : rate)}`;
      return {
        status: 'pendente',
        column,
        anexoItems: [],
        motivo: `MVA pendente: fornecedor em regime normal (MVA ajustada) e A.ORI ${description}; a MVA ajustada só existe para 4%, 7% e 12%.`,
      };
    }
  }

  if (context.mva_anexo.length === 0) {
    return {
      status: 'pendente',
      column,
      anexoItems: [],
      motivo: 'MVA pendente: a tabela do Anexo 1 não está disponível no sistema.',
    };
  }

  const itemsOf = (entries: LocalMvaEntry[]) => [
    ...new Set(entries.map((entry) => entry.item).filter((item): item is string => Boolean(item))),
  ];

  const documentCest = String(cest ?? '').replace(/\D/g, '');
  let candidates = findNcmCandidates(context.mva_anexo.filter((entry) =>
    !entry.autopecas || (documentCest && entryCests(entry).has(documentCest))
  ), cleanNcm);
  if (candidates.length === 0) {
    return {
      status: 'pendente',
      column,
      anexoItems: [],
      motivo: `MVA pendente: NCM ${cleanNcm} não encontrado no Anexo 1 carregado no sistema.`,
    };
  }

  const cleanCest = String(cest ?? '').replace(/\D/g, '');
  if (cleanCest) {
    const withCest = candidates.filter((entry) => entryCests(entry).has(cleanCest));
    if (withCest.length === 0) {
      const ncmItems = itemsOf(candidates);
      return {
        status: 'pendente',
        column,
        anexoItems: ncmItems,
        motivo: `MVA pendente: divergência entre NCM e CEST. O CEST ${formatCest(cleanCest)} do documento não corresponde a nenhum item do Anexo 1 para o NCM ${cleanNcm}${anexoItemsLabel(ncmItems)}.`,
      };
    }
    candidates = withCest;
  }

  const anexoItems = itemsOf(candidates);
  const label = anexoItemsLabel(anexoItems);

  const columnName = column === 'original' ? 'original' : `ajustada (${key}%)`;
  const values = new Set<number>();
  for (const entry of candidates) {
    const { value, conditional } = columnValue(entry, column, key);
    if (conditional) {
      return {
        status: 'pendente',
        column,
        anexoItems,
        motivo: `MVA pendente: o Anexo 1 traz mais de um caso de MVA para o NCM ${cleanNcm}${label}, e a escolha depende de informação que não está no documento.`,
      };
    }
    if (value == null) {
      return {
        status: 'pendente',
        column,
        anexoItems,
        motivo: `MVA pendente: o Anexo 1 não traz MVA ${columnName} numérica para o NCM ${cleanNcm}${label} (o item usa outra base, como PMPF ou preço sugerido, ou está sem valor na tabela).`,
      };
    }
    values.add(value);
  }

  if (values.size > 1) {
    const list = [...values].sort((a, b) => a - b).map(formatPercent).join(' / ');
    const missing = cleanCest
      ? 'e o CEST do documento não identificou um único item.'
      : 'e o documento não traz CEST para identificar o item.';
    return {
      status: 'pendente',
      column,
      anexoItems,
      motivo: `MVA pendente: o NCM ${cleanNcm} tem mais de uma MVA ${columnName} possível (${list})${label}, ${missing}`,
    };
  }

  return { status: 'ok', mva: [...values][0], column, anexoItems };
}

/** Mensagem de um processamento concluído sem planilha, só com itens excluídos. */
export const INDUSTRY_EXCLUSION_REASON =
  'Empresa industrial: não recolhe Antecipação Parcial nem Tributária '
  + '(apenas DIFAL de uso/consumo e ativo imobilizado).';

/** Indústria não recolhe Parcial nem Tributária: gera apenas DIFAL. */
export function isIndustria(context: LocalProcessingContext): boolean {
  return context.empresa.atividade === 'industria';
}

export function industryBonusRejectedReason(cfop: string): string {
  return `Bonificação/amostra/outras entradas (CFOP ${cfop}) não confirmada como uso/consumo pelo usuário (empresa industrial).`;
}

export function noOutputMessage(excluded: Array<{ tipo_exclusao: string; destino?: string; motivo?: string }>): string {
  if (excluded.length > 0 && excluded.every((item) => item.tipo_exclusao === 'industria_sem_antecipacao')) {
    return 'Nenhuma planilha gerada: empresa industrial sem itens de uso/consumo ou ativo imobilizado (DIFAL)';
  }
  const pending = excluded.filter((item) => item.tipo_exclusao === 'mva_pendente').length;
  if (pending === 0 && excluded.some(item => item.destino?.startsWith('antecipacao_tributaria')
      && item.motivo?.includes('sem imposto a recolher'))) {
    return 'Nenhuma planilha gerada: ICMS-ST destacado cobre integralmente a Antecipação Tributária apurada; não há outros itens a recolher. Confira os itens excluídos.';
  }
  if (pending === 0) return 'Nenhum item a recolher na Parcial';
  if (pending === excluded.length) {
    return 'Nenhuma planilha gerada: itens da Antecipação Tributária com MVA pendente precisam de tratamento manual (ver itens excluídos)';
  }
  return 'Nenhum item a recolher na Parcial, e há itens da Antecipação Tributária com MVA pendente que precisam de tratamento manual (ver itens excluídos)';
}
