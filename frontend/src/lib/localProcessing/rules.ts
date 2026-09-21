import type { LocalProcessingContext, LocalMvaEntry } from '../../types/localProcessing';
import type { CfopResolution, ExtractedItem, TaxRateResolution } from './domain';
import type { TipoPlanilha } from '../../types/solicitacao';
import type { MvaAntecipacaoTributariaConfig } from '../../types/perfil';
import { calculateTax } from './calculations.ts';

const PARTIAL_DESTINATIONS = new Set<TipoPlanilha>([
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
]);

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

export function normalizeDescription(value?: string | null): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
}

export function termMatches(normalizedDescription: string, rawTerm: string): boolean {
  let term = String(rawTerm ?? '').trim();
  const prefix = term.endsWith('*');
  if (prefix) term = term.slice(0, -1);
  const normalized = normalizeDescription(term);
  if (!normalized || !normalizedDescription) return false;
  const body = normalized.split(/\s+/).map(escapeRegex).join('\\s+');
  const end = prefix ? '' : '(?![A-Z0-9])';
  return new RegExp(`(?<![A-Z0-9])${body}${end}`).test(normalizedDescription);
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

export function resolveDestinationRate(
  context: LocalProcessingContext,
  item: ExtractedItem,
): TaxRateResolution {
  const ncm = item.ncm.trim();
  const desc = item.descricaoConfiavel ? normalizeDescription(item.descricao) : '';

  if (ncm && desc) {
    const reductionRules = context.regras_reducao.filter((rule) => rule.ncm === ncm);
    const exact = reductionRules.flatMap((rule) =>
      (rule.excecoes ?? [])
        .filter((exception) => exception.descricao_exata === desc)
        .map((exception) => ({ rule, exception })),
    );
    if (exact.length > 1) {
      throw new Error(`Conflito de exceções de redução no item "${item.descricao}" (NCM ${ncm}).`);
    }
    if (exact.length === 1 && exact[0].exception.enquadrado) {
      return {
        aliquota: Number(exact[0].rule.aliquota),
        origem: `excecao:${exact[0].exception.id}`,
        detalhe: `Exceção cadastrada na regra #${exact[0].rule.id}`,
      };
    }

    if (exact.length === 0) {
      const matched = reductionRules.filter(
        (rule) => anyTerm(desc, rule.termos_inclusao) && !anyTerm(desc, rule.termos_exclusao),
      );
      if (matched.length > 1) {
        throw new Error(`Conflito de regras de redução no item "${item.descricao}" (NCM ${ncm}).`);
      }
      if (matched.length === 1) {
        return {
          aliquota: Number(matched[0].aliquota),
          origem: `reducao_produto:${matched[0].id}`,
          detalhe: `Redução por produto: ${matched[0].descricao || `regra #${matched[0].id}`}`,
        };
      }
    }
  }

  const agreement = context.empresa.termo_acordo;
  if (agreement) {
    return {
      aliquota: Number(agreement.aliquota),
      origem: `termo_acordo:${agreement.id}`,
      detalhe: `Termo de acordo da empresa: ${agreement.descricao || `regra #${agreement.id}`}`,
    };
  }

  const uf = context.empresa.uf.trim().toUpperCase();
  const ncmRule = context.regras_aliquotas.find(
    (rule) => rule.uf === uf && rule.ncm === ncm,
  );
  if (ncmRule) {
    return {
      aliquota: Number(ncmRule.aliquota),
      origem: `regra_ncm:${ncmRule.id}`,
      detalhe: `Exceção por NCM ${ncm} na UF ${uf}`,
    };
  }

  const defaultRule = context.regras_aliquotas.find(
    (rule) => rule.uf === uf && !rule.ncm,
  );
  if (defaultRule) {
    return {
      aliquota: Number(defaultRule.aliquota),
      origem: `padrao_uf:${defaultRule.id}`,
      detalhe: `Alíquota padrão da UF ${uf}`,
    };
  }

  throw new Error(`Nenhuma regra de alíquota de destino encontrada para UF ${uf} e NCM ${ncm}.`);
}

export function evaluatePartialMerchandiseExclusion(
  context: LocalProcessingContext,
  destination: TipoPlanilha,
  item: ExtractedItem,
): { excluded: boolean; motivo?: string; regras?: Array<Record<string, unknown>> } {
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
  if (Math.abs(aOri - aDst) > 1e-10 || item.vTotal <= 0) return { excluded: false };

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

function mvaValue(entry: LocalMvaEntry, key: string): number | null {
  for (const adjusted of entry.mva_ajustada ?? []) {
    const raw = adjusted.aliquotas?.[key] ?? adjusted.aliquotas?.['12'];
    if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  }
  if (entry.mva != null && Number.isFinite(Number(entry.mva))) return Number(entry.mva);
  const original = entry.mva_original?.[0]?.valor;
  if (original != null && Number.isFinite(Number(original))) return Number(original);
  return null;
}

export function resolveMva(context: LocalProcessingContext, ncm: string, aOri: number, cest?: string): number {
  const cleanNcm = ncm.replace(/\D/g, '');
  if (!cleanNcm) return 0;
  const key = aOri <= 0 ? '12' : aOri <= 0.05 || (aOri >= 3.5 && aOri <= 4.5)
    ? '4'
    : aOri <= 0.09 || (aOri >= 6.5 && aOri <= 7.5)
      ? '7'
      : '12';

  let best = 0;
  let matches: LocalMvaEntry[] = [];
  for (const entry of context.mva_anexo) {
    const candidate = String(entry.ncm ?? '').replace(/\D/g, '');
    let length = 0;
    if (cleanNcm.startsWith(candidate)) length = candidate.length;
    else if (candidate.startsWith(cleanNcm) && cleanNcm.length >= 4) length = cleanNcm.length;
    if (!length) continue;
    if (length > best) {
      best = length;
      matches = [entry];
    } else if (length === best) matches.push(entry);
  }
  if (matches.length === 0) return 0;

  const cleanCest = String(cest ?? '').replace(/\D/g, '');
  if (cleanCest) {
    const cestMatches = matches.filter((entry) => String(entry.cest ?? '').replace(/\D/g, '') === cleanCest);
    if (cestMatches.length > 0) matches = cestMatches;
  }

  const values = [...new Set(matches.map((entry) => mvaValue(entry, key)).filter((value): value is number => value != null))];
  if (values.length > 1) {
    throw new Error(`O NCM ${cleanNcm} possui mais de uma MVA aplicável. Informe um CEST válido no documento fiscal.`);
  }
  return values[0] ?? 0;
}
