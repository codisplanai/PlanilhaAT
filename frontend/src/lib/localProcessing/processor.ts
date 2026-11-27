import type { JsonObject } from '../../types/common';
import type {
  LocalGeneratedArtifact,
  LocalOutputRow,
  LocalProcessingRequest,
  LocalProcessingResult,
  LocalTemplateDescriptor,
  MvaPending,
} from '../../types/localProcessing';
import type {
  AvisoAvaliacao,
  ItemExcluido,
  NotaFiscalProcessada,
  NotaIgnorada,
  TipoPlanilha,
} from '../../types/solicitacao';
import type { DiagnosticRecorder } from '../processingDiagnostics';
import type { CfopResolution, ExtractedItem, ExtractedNote, TaxRateResolution } from './domain.ts';
import {
  BONUS_SUFFIXES,
  EARLY_DESTINATIONS,
  PARTIAL_DESTINATIONS,
  TAX_SUBSTITUTION_DESTINATIONS,
  normalizeDescription,
} from './domain.ts';
import { supplierUsageMode } from './supplierUsage.ts';
import { calculateTax, roundCurrency } from './calculations.ts';
import {
  buildFcpMetadata,
  buildFcpOutputRow,
  calculateSeparateFcp,
  computeFcpApplication,
  roundRate,
  withNoteContext,
} from './fcp.ts';
import { isSimplesSupplier, resolveSimpleOriginReference } from './interstateRate.ts';
import { consolidateControlRows } from './controlRows.ts';
import { sortRowsByEntryAndNumber } from './rowSorting.ts';
import { resolveAnexoIIApplication } from './convenio5291Agricola.ts';
import { effectiveConvenio5291PartialConfig } from './convenio5291Global.ts';
import {
  CONVENIO_52_91_RATE_ORIGIN,
  convenioDecisionKey,
  fullIcmsCode,
  resolveConvenio5291Application,
} from './convenio5291.ts';
import {
  bonusPreAnalysis,
  usoConsumoPreAnalysis,
  cleanDigits,
  convenio5291PreAnalysis,
  cteMissingNfePreAnalysis,
  eligibleCteNfeKeys,
  isNfeAvailableForCte,
  isOwnEmissionNote,
  isSameUfNote,
  withinPeriod,
} from './preAnalysis.ts';
import {
  evaluateNfeForCte,
  processCtesLocally,
} from './cteProcessing.ts';
import type { NfeCteContext } from './cteProcessing.ts';
import { autopecasMvaSuggestions, resolveAutopecasMvaXml } from './autopecasMva.ts';
import { manualMvaEngineValue, mvaReviewKey, validMvaDecision } from './mvaReview.ts';
import { stIntegralmenteCobertoPorItem, totalSemStXml } from './stXmlCalculation.ts';
import {
  acceptsRetroactiveDifal,
  classifyRevendaMva,
  DIFAL_AWAITING_ENTRY_REASON,
  evaluatePartialMerchandiseExclusion,
  getRevendaAntecipacaoConfig,
  INDUSTRY_EXCLUSION_REASON,
  industryBonusRejectedReason,
  isDifalDestination,
  isIndustria,
  mvaColumnForNote,
  noOutputMessage,
  redirectRevendaToAntecipacaoTributaria,
  routePaidEarlyDestination,
  resolveCfop,
  resolveDestinationRate,
  resolveFcp,
  resolveMvaForItem,
  resolveOriginRate,
  resolveRevendaMva,
  resolveTributariaReduction,
  retroactiveDifalWarning,
  shouldExcludeEqualRates,
} from './rules.ts';
import {
  assertSpedBelongsToCompany,
  isUsoConsumoAtivo,
  loadLocalFiscalSources,
  matchEntryCfop,
  matchEntryDate,
  resolveSpedFiles,
} from './sources.ts';
import { selectTemplateForRows } from './templateSelection.ts';
import { fillTemplateLocally } from './xlsx.ts';
import { buildSpreadsheetFilename } from './filename.ts';
import { shouldExcludeStItemFromTributaria, ST_TRIBUTARIA_EXCLUSION_REASON } from './stTributariaExclusion.ts';

// Planilha de controle (sem apuração) das mercadorias excluídas por imposto pago na entrada.
const CONTROLE_DESTINATION: TipoPlanilha = 'controle_imposto_pago_entrada';

const CONVENIO_52_91_DESTINATIONS: ReadonlySet<TipoPlanilha> = new Set<TipoPlanilha>([
  ...PARTIAL_DESTINATIONS,
  'difal',
  'difal_antecipado',
]);

function validateCnpj(cnpj: string): boolean {
  const clean = cleanDigits(cnpj);
  if (clean.length !== 14 || new Set(clean).size === 1) return false;
  const digit = (weights: number[]): number => {
    const sum = weights.reduce((total, weight, index) => total + Number(clean[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (Number(clean[12]) !== first) return false;
  const second = digit([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(clean[13]) === second;
}

function ignoredNote(note: ExtractedNote, reason: string): NotaIgnorada {
  return {
    numero_nota: note.numeroNota,
    serie: note.serie || null,
    chave_acesso: note.chaveAcesso || null,
    data_emissao: note.dataEmissao.slice(0, 10),
    motivo: reason,
    arquivo: note.filename,
  };
}

function itemBaseOrTotal(item: ExtractedItem): number {
  return item.baseCalculo <= 0 ? item.vTotal - item.ipiDespesas : item.baseCalculo;
}

function buildExcludedItem(
  note: ExtractedNote,
  item: ExtractedItem,
  destino: string,
  motivo: string,
  tipo_exclusao: ItemExcluido['tipo_exclusao'],
  extra: Partial<ItemExcluido> = {},
): ItemExcluido {
  return {
    chave_acesso: note.chaveAcesso,
    numero_nota: note.numeroNota,
    serie: note.serie,
    item_numero: item.itemNumero,
    arquivo: note.filename,
    destino,
    ncm: item.ncm,
    descricao: item.descricao,
    descricao_confiavel: item.descricaoConfiavel,
    motivo,
    tipo_exclusao,
    regras_aplicadas: [],
    v_total: item.vTotal,
    base_calculo: itemBaseOrTotal(item),
    ipi_despesas: item.ipiDespesas,
    a_ori: item.aOri,
    ...extra,
  };
}

function pushPartialMetadataWarnings(
  note: ExtractedNote,
  item: ExtractedItem,
  warnings: AvisoAvaliacao[],
): void {
  let aviso: string | null = null;
  if (!item.descricaoConfiavel) {
    aviso = 'Descrição sintética/não confiável: regra de exclusão por mercadoria não avaliada.';
  } else if (!normalizeDescription(item.descricao)) {
    aviso = 'Descrição do produto ausente: regra de exclusão por mercadoria não avaliada.';
  } else if (!item.ncm || item.ncm === '00000000' || item.ncm.length < 8) {
    aviso = `NCM ausente ou genérico ("${item.ncm}"): regra de exclusão por mercadoria não avaliada.`;
  }
  if (aviso) {
    warnings.push({
      numero_nota: note.numeroNota,
      serie: note.serie,
      item_numero: item.itemNumero,
      arquivo: note.filename,
      aviso,
    });
  }
}

interface Group {
  destination: TipoPlanilha;
  aOri: number;
  aDst: number;
  mva: number;
  reducao: number | null;
  fcpSeparado: number | null;
  items: ExtractedItem[];
  rateResolutions: TaxRateResolution[];
  baseADsts: number[];
  fcpResolutions: Array<TaxRateResolution | null>;
  cfopResolutions: CfopResolution[];
  aOriLimited: boolean;
  aOriFixed: boolean;
  aOriLimitWaived: boolean;
  aOriOriginal: number;
  aOriInferredSimples: boolean;
  aOriHighlighted: boolean;
  aOriInfCompl: boolean;
  pCredSN: number[];
  mvaPolicyGroup: 'especial' | 'demais' | '';
  mvaPolicySource: string;
  convenio5291Applied: boolean;
  convenio5291Manual: boolean;
  convenio5291OrigemAliquota: string;
  convenio5291Motivos: string[];
  convenio5291Anexo: 'I' | 'II' | '';
}

export function groupKey(
  destination: TipoPlanilha,
  aOri: number,
  aDst: number,
  mva: number,
  convenio5291Applied: boolean,
  reducao: number | null = null,
  fcpSeparado: number | null = null,
): string {
  return [
    destination,
    roundRate(aOri, 4),
    roundRate(aDst, 4),
    roundRate(mva, 4),
    convenio5291Applied ? '1' : '0',
    reducao == null ? 'none' : roundRate(reducao, 5),
    fcpSeparado == null ? 'none' : roundRate(fcpSeparado, 4),
  ].join('|');
}

/** Aviso de cadastro devolvido pelo motor de reduções/FCP, já com nota e item. */
function pushReductionWarning(
  resolution: TaxRateResolution | null,
  note: ExtractedNote,
  item: ExtractedItem,
  warnings: AvisoAvaliacao[],
  diagnostic?: DiagnosticRecorder,
  ruleKind = 'redução',
): void {
  if (!resolution?.aviso) return;
  warnings.push({
    numero_nota: note.numeroNota,
    serie: note.serie,
    item_numero: item.itemNumero,
    arquivo: note.filename,
    aviso: `Item ${item.itemNumero}: ${resolution.aviso.charAt(0).toUpperCase()}${resolution.aviso.slice(1)}`,
  });
  diagnostic?.event('warning', 'calculo', `Regras de ${ruleKind} redundantes casaram o mesmo item.`, {
    numeroNota: note.numeroNota,
    itemNumero: item.itemNumero,
    ncm: item.ncm,
    origem: resolution.origem,
    detalhe: resolution.detalhe,
  });
}

function resolveConvenioAndRatesForItem(params: {
  request: LocalProcessingRequest;
  note: ExtractedNote;
  item: ExtractedItem;
  destination: TipoPlanilha;
  convenio5291SavedIndustrialConfig: LocalProcessingRequest['context']['perfil']['configuracoes_extras']['convenio_icms_52_91_anexo_i'];
  convenio5291Config: ReturnType<typeof effectiveConvenio5291PartialConfig>;
  convenio5291AgricolaConfig: ReturnType<typeof effectiveConvenio5291PartialConfig>;
  industrialDecisions: Record<string, boolean> | undefined;
  warnings: AvisoAvaliacao[];
  diagnostic?: DiagnosticRecorder;
}) {
  const {
    request, note, item, destination,
    convenio5291SavedIndustrialConfig, convenio5291Config, convenio5291AgricolaConfig,
    industrialDecisions, warnings, diagnostic,
  } = params;
  const { context } = request;
  const rate = withNoteContext(note, () => resolveDestinationRate(context, item, destination));
  // Nenhuma mudança de regra para DIFAL ou Tributária/ST.
  const possivelAgricola = PARTIAL_DESTINATIONS.has(destination)
    ? resolveAnexoIIApplication(
      convenio5291AgricolaConfig, note, item, context.empresa.uf, request.convenio5291Decisions,
    ) : null;
  const escolherIndustrial = request.convenio5291Decisions?.[convenioDecisionKey(note, item)] === 'anexo_i';
  const usarAgricola = Boolean(possivelAgricola)
    && possivelAgricola?.classification.status !== 'fora_catalogo'
    && !escolherIndustrial;
  const convenio = usarAgricola
    ? { ...possivelAgricola!, anexo: 'II' as const }
    : CONVENIO_52_91_DESTINATIONS.has(destination)
      ? { ...resolveConvenio5291Application(
        PARTIAL_DESTINATIONS.has(destination) ? convenio5291Config : convenio5291SavedIndustrialConfig,
        note, item, context.empresa.uf, industrialDecisions,
      ), anexo: 'I' as const }
      : null;
  const tributariaReduction = TAX_SUBSTITUTION_DESTINATIONS.has(destination)
    ? withNoteContext(note, () => resolveTributariaReduction(context, item))
    : null;
  const fcpResolution = withNoteContext(note, () => resolveFcp(context, item));
  // Com o Convênio 52/91 aplicado, a A.DST da redução por produto não é usada.
  if (!convenio?.applied) pushReductionWarning(rate, note, item, warnings, diagnostic);
  pushReductionWarning(tributariaReduction, note, item, warnings, diagnostic);
  pushReductionWarning(fcpResolution, note, item, warnings, diagnostic, 'FCP');
  const itemReducao: number | null = tributariaReduction ? tributariaReduction.aliquota : null;
  const baseADst = convenio?.applied ? Number(convenio.aDst) : rate.aliquota;
  const { fcpSeparado, effectiveADst } = computeFcpApplication(
    destination,
    Boolean(context.empresa.optante_simples_nacional),
    baseADst,
    fcpResolution,
  );
  const originalAOri = item.aOri;
  const effectiveRate = convenio?.applied
    ? {
      aliquota: baseADst,
      origem: CONVENIO_52_91_RATE_ORIGIN,
      detalhe: `Convênio ICMS 52/91 — ${convenio.classification.motivo}`,
    }
    : rate;
  // Somente fornecedor Simples sem pICMS em operação interestadual.
  // A taxa é referência de origem, e não um crédito destacado no XML.
  // Não se aplica à planilha de DIFAL.
  const isDifal = isDifalDestination(destination);
  // Sem pICMS destacado, a alíquota de crédito autorizada nas Informações
  // Complementares (fornecedor do Simples) vale como A.ORI em todas as planilhas
  // e tem prioridade sobre a alíquota interestadual de referência.
  const infComplRate = !(originalAOri && originalAOri > 0) && !convenio?.applied
    ? (note.aliqCreditoIcmsInfCompl ?? 0)
    : 0;
  const aOriInfCompl = infComplRate > 0;
  const documentAOri = aOriInfCompl ? infComplRate : originalAOri;
  const aOriHighlighted = Boolean(documentAOri && documentAOri > 0);
  if (aOriInfCompl) {
    const ratePct = (infComplRate * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    warnings.push({
      numero_nota: note.numeroNota,
      serie: note.serie,
      item_numero: item.itemNumero,
      arquivo: note.filename,
      aviso: `Item ${item.itemNumero}: A.ORI de ${ratePct}% obtida das Informações Complementares da NF-e (crédito de ICMS autorizado pelo fornecedor), sem pICMS destacado no item.`,
    });
  }
  const reference = isDifal || aOriInfCompl
    ? { rate: 0, inferred: false }
    : resolveSimpleOriginReference(note, item, context.empresa.uf, Boolean(convenio?.applied));
  const referenceRate = isDifal ? 0 : reference.rate;
  const resolvedAOri = isDifal
    ? (aOriHighlighted ? documentAOri : 0)
    : (convenio?.applied ? Number(convenio.aOri) : (aOriInfCompl ? infComplRate : referenceRate));
  const originRate = resolveOriginRate(
    context, destination, resolvedAOri, effectiveADst, effectiveRate.origem,
  );
  const aOri = isDifal ? (aOriHighlighted ? originRate.aOri : 0) : originRate.aOri;
  const aOriInferredSimples = !isDifal && reference.inferred && !originRate.fixed;
  if (aOriInferredSimples) {
    const ratePct = (referenceRate * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    warnings.push({
      numero_nota: note.numeroNota,
      serie: note.serie,
      item_numero: item.itemNumero,
      arquivo: note.filename,
      aviso: `Item ${item.itemNumero}: Alíquota interestadual de ${ratePct}% aplicada automaticamente (fornecedor optante pelo Simples Nacional sem pICMS: ${note.ufEmitente} -> ${context.empresa.uf}). Alíquota de referência, não crédito destacado.`,
    });
    diagnostic?.event('info', 'calculo', 'A.ORI de referência interestadual aplicada ao fornecedor Simples Nacional.', {
      numeroNota: note.numeroNota,
      itemNumero: item.itemNumero,
      ufOrigem: note.ufEmitente,
      ufDestino: context.empresa.uf,
      origemMercadoria: item.origemMercadoria || 'não identificada',
      pCredSN: item.pCredSN ?? null,
      aliquotaReferencia: referenceRate,
    });
    if (!item.origemMercadoria) {
      warnings.push({
        numero_nota: note.numeroNota,
        serie: note.serie,
        item_numero: item.itemNumero,
        arquivo: note.filename,
        aviso: 'Origem da mercadoria não identificada: aplicada referência geográfica (7% ou 12%). Verifique eventual enquadramento na alíquota de 4%.',
      });
    }
  }

  return {
    convenio,
    itemReducao,
    baseADst,
    effectiveADst,
    effectiveRate,
    fcpResolution,
    fcpSeparado,
    originalAOri,
    originRate,
    aOri,
    aOriInferredSimples,
    aOriHighlighted,
    aOriInfCompl,
  };
}

function consolidateNoteGroups(params: {
  note: ExtractedNote;
  groups: Map<string, Group>;
  classifiedItems: number;
  context: LocalProcessingRequest['context'];
  entryDate: string | null;
  entryOrigin: NotaFiscalProcessada['origem_data_entrada'];
  supplierIsSimples: boolean;
  processed: LocalProcessingResult['notasProcessadas'];
  rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  fcpRowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  ignored: NotaIgnorada[];
  excluded: ItemExcluido[];
  diagnostic?: DiagnosticRecorder;
}): void {
  const {
    note, groups, classifiedItems, context, entryDate, entryOrigin, supplierIsSimples,
    processed, rowsByDestination, fcpRowsByDestination, ignored, excluded, diagnostic,
  } = params;
  const splitByDestination = new Map<TipoPlanilha, number>();
  for (const group of groups.values()) {
    const splitIndex = splitByDestination.get(group.destination) ?? 1;
    const useNoteTotal = groups.size === 1 && classifiedItems === note.itens.length && note.vTotalNota > 0;

    const vTotal = useNoteTotal
      ? (TAX_SUBSTITUTION_DESTINATIONS.has(group.destination) ? totalSemStXml(note) : note.vTotalNota)
      : group.items.reduce((sum, item) => sum + item.vTotal, 0);
    const originalBaseXml = useNoteTotal && note.vBcNota > 0
      ? note.vBcNota
      : group.items.reduce((sum, item) => sum + Number(item.baseCalculoXml ?? item.baseCalculo), 0);
    const ipi = group.items.reduce((sum, item) => sum + item.ipiDespesas, 0);
    const maxBaseLiquida = Math.max(0, vTotal - ipi);
    let base = group.convenio5291Applied
      ? group.items.reduce((sum, item) => sum + Number(item.baseSemIpi ?? (item.vTotal - Number(item.vIpi ?? 0))), 0)
      : (useNoteTotal && note.vBcNota > 0
        ? ((note.vDescNota ?? 0) > 0 && note.vBcNota > maxBaseLiquida
            ? Math.max(0, Math.min(note.vBcNota - (note.vDescNota ?? 0), maxBaseLiquida))
            : note.vBcNota)
        : group.items.reduce((sum, item) => sum + item.baseCalculo, 0));
    const reducedBaseEvidence = group.items.some(
      (item) => fullIcmsCode(item).endsWith('20') || Number(item.pRedBC ?? 0) > 0,
    );

    // V.Total já contém o desconto comercial; não o reincorporar à base.
    // Preservar a separação do IPI e o valor líquido de cada grupo.
    const descTotal = useNoteTotal
      ? (note.vDescNota ?? 0)
      : group.items.reduce((sum, item) => sum + Number(item.vDesc ?? 0), 0);
    if (descTotal > 0) base = maxBaseLiquida;

    if (base <= 0) base = vTotal - ipi;

    if (vTotal <= 0) {
      ignored.push(ignoredNote(note, `Valor total zerado ou sem valor comercial (R$ ${vTotal.toFixed(2)}).`));
      continue;
    }
    if (
      base < 0
      || group.aOri < 0 || group.aOri > 1
      || group.aDst < 0 || group.aDst > 1
      || (group.fcpSeparado != null && (group.fcpSeparado < 0 || group.fcpSeparado > 1))
    ) {
      throw new Error(`NF-e ${note.numeroNota}: valores fiscais fora da faixa válida.`);
    }

    const first = group.items[0];
    const ncm = first?.ncm ?? '';
    const cfop = first?.cfop ?? '';
    const description = group.items.length === 1
      ? first?.descricao ?? ''
      : `NF-e ${note.numeroNota} (${group.items.length} itens)`;
    const mva = TAX_SUBSTITUTION_DESTINATIONS.has(group.destination) ? group.mva : 0;
    const aliqSimples = isDifalDestination(group.destination) && supplierIsSimples ? 'S' : 'N';

    let valorPago = 0;
    if (TAX_SUBSTITUTION_DESTINATIONS.has(group.destination)) {
      const itemStSum = group.items.reduce((sum, item) => sum + Number(item.vIcmsSt ?? 0), 0);
      if (itemStSum > 0) {
        valorPago = roundCurrency(itemStSum);
      } else if (
        (note.vStNota ?? 0) > 0
        && !Object.prototype.hasOwnProperty.call(note.rawMetadata, 'icms_st_xml')
      ) {
        // Fallback legado para SPED sem XML: em NF-e mista com XML,
        // nunca redistribuir vST total a produtos que não tiveram retenção.
        const allStGroupsTotal = Array.from(groups.values())
          .filter((g) => TAX_SUBSTITUTION_DESTINATIONS.has(g.destination))
          .reduce((sum, g) => sum + g.items.reduce((s, it) => s + it.vTotal, 0), 0);
        const groupTotal = group.items.reduce((s, it) => s + it.vTotal, 0);
        valorPago = allStGroupsTotal > 0
          ? roundCurrency((note.vStNota! * groupTotal) / allStGroupsTotal)
          : (useNoteTotal ? roundCurrency(note.vStNota!) : 0);
      }
    }

    const calculation = calculateTax(group.destination, {
      vTotal,
      baseCalculo: base,
      ipiDespesas: ipi,
      aOri: group.aOri,
      aDst: group.aDst,
      mva,
      reducao: group.reducao,
      aliqSimples,
      isSimples: Boolean(context.empresa.optante_simples_nacional),
      valorPago,
    });

    const stPorItem = TAX_SUBSTITUTION_DESTINATIONS.has(group.destination)
      ? stIntegralmenteCobertoPorItem(group.items, mva, group.aOri, group.aDst,
        group.reducao, group.fcpSeparado, vTotal, base, valorPago)
      : null;
    if (stPorItem) {
      calculation.debito = stPorItem.debito;
      calculation.credito = stPorItem.credito;
      calculation.valorDevido = 0;
      diagnostic?.event('info','calculo','ICMS-ST integralmente coberto: conferência independente item a item.',{
        numeroNota:note.numeroNota, itens:group.items.length, valorPago,
      });
    }

    // Em Antecipação Tributária, se o ICMS ST destacado na nota cobrir o imposto ou resultar em <= 0,
    // remover da planilha final e registrar em itens excluídos.
    if (TAX_SUBSTITUTION_DESTINATIONS.has(group.destination) && calculation.valorDevido <= 0) {
      const diffDevido = roundCurrency(calculation.debito - calculation.credito);
      const reason = valorPago > 0
        ? `Antecipação Tributária: sem imposto a recolher pois o ICMS ST destacado na nota (R$ ${valorPago.toFixed(2)}) cobre integralmente o imposto apurado (R$ ${diffDevido.toFixed(2)}).`
        : 'Antecipação Tributária: sem diferença positiva de imposto a recolher após confrontar débito com crédito.';
      for (const fiscalItem of group.items) {
        excluded.push(buildExcludedItem(note, fiscalItem, group.destination, reason, 'mercadoria', {
          base_calculo: fiscalItem.baseSemIpi ?? fiscalItem.baseCalculo,
          a_dst: group.aDst,
        }));
      }
      diagnostic?.event('info', 'calculo', reason, {
        numeroNota: note.numeroNota,
        destino: group.destination,
        itens: group.items.length,
        debito: calculation.debito,
        credito: calculation.credito,
        valorPago,
        valorDevido: calculation.valorDevido,
      });
      continue;
    }

    // Na Parcial agrícola não se gera planilha de imposto negativo ou zerado:
    // quando a carga interestadual supera a interna pode não existir
    // diferença a antecipar (RICMS/BA, art. 266). Registrar todos os itens.
    if (group.convenio5291Anexo === 'II' && calculation.valorDevido <= 0) {
      const reason = 'Convênio ICMS 52/91, Anexo II: sem diferença positiva de antecipação parcial após confrontar débito interno de 5,60% com crédito de origem.';
      for (const fiscalItem of group.items) {
        excluded.push(buildExcludedItem(note, fiscalItem, group.destination, reason, 'mercadoria', {
          base_calculo: fiscalItem.baseSemIpi ?? fiscalItem.baseCalculo,
          a_dst: group.aDst,
        }));
      }
      diagnostic?.event('info', 'calculo', reason, {
        numeroNota: note.numeroNota,
        anexo: 'II',
        itens: group.items.length,
        cargaOrigem: group.aOri,
        cargaDestino: group.aDst,
      });
      continue;
    }

    const fcpCalc = group.fcpSeparado != null && group.fcpSeparado > 0
      ? calculateSeparateFcp({
        destination: group.destination,
        vTotal,
        baseCalculo: base,
        ipiDespesas: ipi,
        mva,
        reducao: group.reducao,
        fcpAliquota: group.fcpSeparado,
      })
      : null;
    const validFcpResolutions = group.fcpResolutions.filter(
      (res): res is TaxRateResolution => res !== null && res.aliquota > 0,
    );
    let aDstBaseGroup = group.baseADsts[0] ?? group.aDst;
    let fcpAliqGroup: number | null = null;
    if (fcpCalc && group.fcpSeparado != null) {
      fcpAliqGroup = group.fcpSeparado;
    } else if (validFcpResolutions.length > 0) {
      const idxWithFcp = group.fcpResolutions.findIndex((res) => res !== null && res.aliquota > 0);
      if (idxWithFcp >= 0 && idxWithFcp < group.baseADsts.length) {
        aDstBaseGroup = group.baseADsts[idxWithFcp];
      }
      fcpAliqGroup = Number(validFcpResolutions[0].aliquota);
    }
    const fcpMeta = buildFcpMetadata({
      aDstBase: aDstBaseGroup,
      fcpAliquota: fcpAliqGroup,
      fcpOrigem: [...new Set(validFcpResolutions.map((res) => res.origem))].sort().join('; ') || null,
      fcpDetalhe: [...new Set(validFcpResolutions.map((res) => res.detalhe))].sort().join('; ') || null,
      fcpSeparado: fcpCalc !== null,
      fcpCalc,
    });

    const effectiveEntryDate = EARLY_DESTINATIONS.has(group.destination) ? null : entryDate;
    const effectiveEntryOrigin = EARLY_DESTINATIONS.has(group.destination) ? null : entryOrigin;
    const rateOrigins = [...new Set(group.rateResolutions.map((item) => item.origem))].sort();
    const rateDetails = [...new Set(group.rateResolutions.map((item) => item.detalhe))].sort();
    const cfopDetails = [...new Set(group.cfopResolutions.map((item) => item.motivo).filter(Boolean))].sort();

    const metadadosExtras: JsonObject = {
      ...(note.rawMetadata.fornecedor_uso_consumo ? { fornecedor_uso_consumo: note.rawMetadata.fornecedor_uso_consumo } : {}),
      desdobramento: groups.size > 1,
      subitem_index: splitIndex,
      total_subitens_destino: group.items.length,
      mva: String(mva),
      reducao: group.reducao != null ? String(group.reducao) : null,
      mva_grupo: group.mvaPolicyGroup || null,
      mva_fonte: group.mvaPolicySource || null,
      fornecedor_simples_nacional: supplierIsSimples,
      aliq_simples: aliqSimples,
      origem_a_dst: rateOrigins,
      detalhe_a_dst: rateDetails.join('; '),
      cfop_reclassificado: group.cfopResolutions.some((item) => item.reclassificado),
      detalhe_cfop: cfopDetails.join('; '),
      a_ori_limitada: group.aOriLimited,
      a_ori_fixa_parcial: group.aOriFixed,
      a_ori_limite_dispensado: group.aOriLimitWaived,
      a_ori_original: String(group.aOriOriginal),
      a_ori_inferida_simples: group.aOriInferredSimples,
      a_ori_destacada: group.aOriHighlighted,
      a_ori_inf_compl: group.aOriInfCompl,
      p_cred_sn: group.pCredSN.length ? group.pCredSN : null,
      convenio_52_91_aplicado: group.convenio5291Applied,
      convenio_52_91_anexo: group.convenio5291Anexo || null,
      convenio_52_91_decisao_manual: group.convenio5291Manual,
      convenio_52_91_motivo: group.convenio5291Motivos.join('; ') || null,
      convenio_52_91_origem_aliquota: group.convenio5291OrigemAliquota || null,
      convenio_52_91_base_xml_original: originalBaseXml,
      convenio_52_91_base_planilha: group.convenio5291Applied ? base : null,
      convenio_52_91_cst_reducao_detectada: reducedBaseEvidence,
      ...calculation.detalhes,
      ...fcpMeta,
    };

    processed.push({
      chave_acesso: note.chaveAcesso,
      numero_nota: note.numeroNota,
      serie: note.serie,
      cnpj_emitente: note.cnpjEmitente,
      uf_emitente: note.ufEmitente,
      cnpj_destinatario: note.cnpjDestinatario,
      uf_destinatario: context.empresa.uf,
      data_emissao: note.dataEmissao,
      data_entrada: effectiveEntryDate,
      origem_data_entrada: effectiveEntryOrigin,
      item_numero: splitIndex,
      ncm,
      cfop,
      destino_planilha: group.destination,
      v_total: vTotal,
      base_calculo: base,
      ipi_despesas: ipi,
      a_ori: group.aOri,
      a_dst_resolvida: group.aDst,
      debito: calculation.debito,
      credito: calculation.credito,
      valor_devido: calculation.valorDevido,
      metadados_extras: metadadosExtras,
    });

    const row: LocalOutputRow = {
      numero_nota: splitIndex > 1 ? `${note.numeroNota}*` : note.numeroNota,
      serie: note.serie,
      chave_acesso: note.chaveAcesso,
      cnpj_emitente: note.cnpjEmitente,
      uf_emitente: note.ufEmitente,
      cnpj_destinatario: note.cnpjDestinatario,
      uf_destinatario: context.empresa.uf,
      data_emissao: note.dataEmissao,
      data_entrada: effectiveEntryDate,
      item_numero: splitIndex,
      descricao: description,
      ncm,
      cfop,
      v_total: vTotal,
      base_calculo: base,
      ipi_despesas: ipi,
      mva,
      reducao: group.reducao,
      red: '',
      aliq_simples: aliqSimples,
      a_ori: isDifalDestination(group.destination) && !group.aOriHighlighted ? null : group.aOri,
      a_dst: group.aDst,
      debito: calculation.debito,
      credito: calculation.credito,
      valor_devido: calculation.valorDevido,
      valor_pago: valorPago,
    };
    (rowsByDestination[group.destination] ??= []).push(row);
    if (fcpCalc && group.fcpSeparado != null) {
      (fcpRowsByDestination[group.destination] ??= []).push(
        buildFcpOutputRow(row, group.fcpSeparado, fcpCalc),
      );
    }
    splitByDestination.set(group.destination, splitIndex + 1);
  }
}

async function generateOutputArtifacts(params: {
  context: LocalProcessingRequest['context'];
  periodoInicio: string;
  spedIe: string | undefined;
  rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  fcpRowsByDestination?: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  templateBytes: Map<number, ArrayBuffer>;
  loadTemplate?: (template: LocalTemplateDescriptor) => Promise<ArrayBuffer>;
  diagnostic?: DiagnosticRecorder;
}): Promise<LocalGeneratedArtifact[]> {
  const {
    context, periodoInicio, spedIe, rowsByDestination, fcpRowsByDestination,
    templateBytes, loadTemplate, diagnostic,
  } = params;
  const artifacts: LocalGeneratedArtifact[] = [];
  const month = Number(periodoInicio.slice(5, 7));
  const year = Number(periodoInicio.slice(0, 4));
  const competencia = `${String(month).padStart(2, '0')}/${year}`;
  const ie = context.empresa.inscricao_estadual || spedIe || '';

  for (const [destination, rows] of Object.entries(rowsByDestination) as Array<[TipoPlanilha, LocalOutputRow[]]>) {
    if (!rows?.length) continue;
    const rawFcpRows = TAX_SUBSTITUTION_DESTINATIONS.has(destination)
      ? (fcpRowsByDestination?.[destination] ?? [])
      : [];
    const fcpRows = [...rawFcpRows];
    if (fcpRows.length > 0) sortRowsByEntryAndNumber(fcpRows);
    const requiredRows = Math.max(rows.length, fcpRows.length);
    const template = selectTemplateForRows(
      context.templates_ativos,
      destination,
      requiredRows,
      context.margens_seguranca_templates[destination] ?? 0,
      context.empresa.id,
    );
    if (!template) continue;
    let bytes = templateBytes.get(template.id);
    if (!bytes && loadTemplate) {
      bytes = await loadTemplate(template);
      templateBytes.set(template.id, bytes);
    }
    if (!bytes) {
      throw new Error(
        `O modelo oficial necessário para ${destination} não pôde ser carregado (template ${template.id}, v${template.versao}).`,
      );
    }

    const output = await fillTemplateLocally(
      bytes,
      template,
      rows,
      {
        razaoSocial: context.empresa.razao_social,
        ie,
        competencia,
        month,
        year,
      },
      fcpRows.length > 0 ? fcpRows : undefined,
    );
    const filename = buildSpreadsheetFilename({
      razaoSocial: context.empresa.razao_social,
      tipo: destination,
      month,
      year,
      observacoes: template.observacoes,
    });
    artifacts.push({
      tipo: destination,
      templateId: template.id,
      filename,
      bytes: output,
      totalNotas: rows.length,
      totalValorDevido: roundCurrency(rows.reduce((sum, row) => sum + row.valor_devido, 0)),
    });
    diagnostic?.event('info', 'geracao_planilha', 'Planilha montada e validada em memória.', {
      tipo: destination,
      linhas: rows.length,
      linhasFcp: fcpRows.length,
      tamanhoBytes: output.byteLength,
      templateId: template.id,
      capacidadeLinhas: template.capacidade_linhas ?? null,
      margemSegurancaLinhas: context.margens_seguranca_templates[destination] ?? 0,
    });
  }

  const destinationsWithoutTemplate = Object.entries(rowsByDestination)
    .filter(([destination, rows]) => (
      rows?.length
      && destination !== CONTROLE_DESTINATION // auxiliar: sem template, apenas não é gerado
      && !context.templates_ativos.some((item) => item.tipo === destination)
    ))
    .map(([destination]) => destination);
  if (artifacts.length === 0 && destinationsWithoutTemplate.length > 0) {
    throw new Error(
      `Nenhuma planilha pôde ser gerada porque não há template ativo para: ${destinationsWithoutTemplate.join(', ')}.`,
    );
  }
  return artifacts;
}

export async function processFiscalLocally(
  request: LocalProcessingRequest,
  templateBytes: Map<number, ArrayBuffer>,
  loadTemplate?: (template: LocalTemplateDescriptor) => Promise<ArrayBuffer>,
): Promise<LocalProcessingResult> {
  const { context, periodoInicio, periodoFim } = request;
  const diagnostic = request.diagnostic;
  const sourceStartedAt = performance.now();
  diagnostic?.stage('leitura', 'Leitura e interpretação das fontes fiscais iniciada.');
  if (!validateCnpj(context.empresa.cnpj)) {
    throw new Error(`CNPJ da empresa selecionada "${context.empresa.cnpj}" é inválido.`);
  }

  const spedFiles = resolveSpedFiles(request.input);
  const hasSped = spedFiles.length > 0;
  const sources = await loadLocalFiscalSources(request.input, periodoInicio, periodoFim);
  if (hasSped) {
    const companyInfos = sources.spedCompanyInfos?.length
      ? sources.spedCompanyInfos
      : [sources.spedCompanyInfo];
    for (const info of companyInfos) {
      assertSpedBelongsToCompany(info, context.empresa.cnpj);
    }
  }
  diagnostic?.event('info', 'leitura', 'Fontes fiscais interpretadas.', {
    notasLidas: sources.notes.length,
    registrosEntrada: sources.entryRecords.length,
    registrosPlanilhaEntrada: sources.entryRecords.length,
    notasEntradaSped: sources.notes.filter((note) => note.origemExtracao === 'sped').length,
    notasInvalidas: sources.ignoredNotes.length,
    possuiSped: hasSped,
    possuiPlanilhaEntrada: Boolean(request.input.entrySheet),
  }, Math.round(performance.now() - sourceStartedAt));
  diagnostic?.setSummary({
    read: sources.notes.length + sources.ignoredNotes.length,
    rejected: sources.ignoredNotes.length,
  });
  for (const ignoredEntry of sources.ignoredNotes) {
    diagnostic?.event('warning', 'leitura', ignoredEntry.motivo, {
      numeroNota: ignoredEntry.numero_nota,
      referenciaArquivo: ignoredEntry.arquivo ? 'disponível na interface' : 'não disponível',
    });
  }
  const ctes = sources.ctes ?? [];
  const pendingCtes = cteMissingNfePreAnalysis(
    ctes,
    sources.notes,
    periodoInicio,
    periodoFim,
    context.empresa.cnpj,
    context.empresa.uf,
  );
  if (pendingCtes.length > 0 && !request.ignoreMissingCteNotes) {
    if (diagnostic) diagnostic.attempt.status = 'aguardando_decisao';
    diagnostic?.stage('validacao', 'Processamento pausado para envio de NF-e(s) originária(s) de CT-e.', {
      pendencias: pendingCtes.length,
    });
    return {
      preAnalysis: {
        requer_decisao: true,
        notas_bonificacao: [],
        itens_convenio_52_91: [],
        ctes_sem_nfe: pendingCtes,
      },
      notasProcessadas: [],
      notasIgnoradas: sources.ignoredNotes,
      itensExcluidos: [],
      avisosAvaliacao: [],
      cfopsSemRegra: {},
      rowsByDestination: {},
      artifacts: [],
    };
  }

  const isSimplesCompany = Boolean(context.empresa.optante_simples_nacional);
  const isIndustryCompany = isIndustria(context);
  const referencedNfeKeys = eligibleCteNfeKeys(
    ctes,
    periodoInicio,
    periodoFim,
    context.empresa.cnpj,
    context.empresa.uf,
  );
  const usagePending = usoConsumoPreAnalysis(sources.notes, periodoInicio, periodoFim, context, referencedNfeKeys, request.usoConsumoDecisions);
  if (usagePending.length > 0) {
    if (diagnostic) diagnostic.attempt.status = 'aguardando_decisao';
    diagnostic?.stage('validacao', 'Processamento pausado para confirmação de fornecedores de uso e consumo.', { pendencias: usagePending.length });
    return {
      preAnalysis: { requer_decisao: true, notas_bonificacao: [], itens_convenio_52_91: [], notas_uso_consumo: usagePending },
      notasProcessadas: [], notasIgnoradas: sources.ignoredNotes, itensExcluidos: [], avisosAvaliacao: [],
      cfopsSemRegra: {}, rowsByDestination: {}, artifacts: [],
    };
  }
  const pending = bonusPreAnalysis(
    sources.notes.filter(note => !supplierUsageMode(note, context.empresa, request.usoConsumoDecisions)), periodoInicio, periodoFim, context.empresa.uf, context.empresa.cnpj, isSimplesCompany, referencedNfeKeys,
  );
  if (pending.length > 0 && !request.bonusDecisions) {
    if (diagnostic) diagnostic.attempt.status = 'aguardando_decisao';
    diagnostic?.stage('validacao', 'Processamento pausado para confirmação de bonificações.', {
      pendencias: pending.length,
    });
    return {
      preAnalysis: { requer_decisao: true, notas_bonificacao: pending, itens_convenio_52_91: [] },
      notasProcessadas: [],
      notasIgnoradas: sources.ignoredNotes,
      itensExcluidos: [],
      avisosAvaliacao: [],
      cfopsSemRegra: {},
      rowsByDestination: {},
      artifacts: [],
    };
  }

  const ignored: NotaIgnorada[] = [...sources.ignoredNotes as NotaIgnorada[]];
  const excluded: ItemExcluido[] = [];
  const pendingMvas: MvaPending[] = [];
  const warnings: AvisoAvaliacao[] = [];
  const missingCfops: Record<string, number> = {};
  const rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>> = {};
  const fcpRowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>> = {};
  const processed: LocalProcessingResult['notasProcessadas'] = [];
  const transformationStartedAt = performance.now();
  diagnostic?.stage('transformacao', 'Validação fiscal, aplicação de regras e cálculos iniciados.');

  const hasEntrySource = hasSped || Boolean(request.input.entrySheet) || sources.entryRecords.length > 0;
  const nfeContextByKey = new Map<string, NfeCteContext>();
  const revendaAntecipacaoConfig = getRevendaAntecipacaoConfig(context);
  const convenio5291SavedIndustrialConfig = context.perfil.configuracoes_extras.convenio_icms_52_91_anexo_i;
  const convenio5291Config = effectiveConvenio5291PartialConfig(convenio5291SavedIndustrialConfig);
  const convenio5291AgricolaConfig = effectiveConvenio5291PartialConfig(
    context.perfil.configuracoes_extras.convenio_icms_52_91_anexo_ii,
  );
  const industrialDecisions = request.convenio5291Decisions && Object.fromEntries(
    Object.entries(request.convenio5291Decisions).map(([key, choice]) => [key, choice === true || choice === 'anexo_i']),
  );
  const convenioPending = convenio5291PreAnalysis(
    sources.notes,
    periodoInicio,
    periodoFim,
    context.empresa.uf,
    context,
    sources.entryRecords,
    request.bonusDecisions,
    request.convenio5291Decisions,
    request.usoConsumoDecisions,
  );
  if (convenioPending.length > 0) {
    if (diagnostic) diagnostic.attempt.status = 'aguardando_decisao';
    diagnostic?.stage('validacao', 'Processamento pausado para confirmação do Convênio ICMS 52/91.', {
      pendencias: convenioPending.length,
    });
    return {
      preAnalysis: { requer_decisao: true, notas_bonificacao: [], itens_convenio_52_91: convenioPending },
      notasProcessadas: [],
      notasIgnoradas: sources.ignoredNotes,
      itensExcluidos: [],
      avisosAvaliacao: [],
      cfopsSemRegra: {},
      rowsByDestination: {},
      artifacts: [],
    };
  }

  for (const note of sources.notes) {
    const usageMode = supplierUsageMode(note, context.empresa, request.usoConsumoDecisions);
    const cleanChave = cleanDigits(note.chaveAcesso);
    const isReferencedByCte = Boolean(cleanChave && referencedNfeKeys.has(cleanChave));
    if (isReferencedByCte && isNfeAvailableForCte(note)) {
      nfeContextByKey.set(
        cleanChave,
        evaluateNfeForCte({
          note,
          context,
          entryRecords: sources.entryRecords,
          hasEntrySource,
          bonusDecisions: request.bonusDecisions,
          forceUsoConsumo: Boolean(usageMode),
        }),
      );
    }

    if (isOwnEmissionNote(note, context.empresa.cnpj)) {
      ignored.push(
        ignoredNote(note, 'Nota fiscal de emissão própria desconsiderada: emitente é a própria empresa.'),
      );
      continue;
    }

    const periodReason = `Data de emissão fora do período informado (${periodoInicio} a ${periodoFim}).`;
    const inPeriod = withinPeriod(note, periodoInicio, periodoFim);
    if (!(isReferencedByCte && !inPeriod) && cleanDigits(note.cnpjDestinatario) !== cleanDigits(context.empresa.cnpj)) {
      throw new Error(
        `NF-e ${note.numeroNota} possui CNPJ destinatário ${note.cnpjDestinatario}, diferente da empresa selecionada.`,
      );
    }

    if (isSameUfNote(note, context.empresa.uf)) {
      if (!(isReferencedByCte && !inPeriod)) {
        ignored.push(ignoredNote(
          note,
          `Operação interna estadual desconsiderada: UF do fornecedor (${note.ufEmitente}) é igual à UF da empresa (${context.empresa.uf}).`,
        ));
      }
      continue;
    }

    const retroactive = !inPeriod && acceptsRetroactiveDifal(note, periodoInicio, isSimplesCompany);
    if (!inPeriod && !retroactive) {
      if (!isReferencedByCte) ignored.push(ignoredNote(note, periodReason));
      continue;
    }
    let retroactiveSkipped = 0;
    let firstRetroactiveSkippedItem: number | null = null;
    const awaitingEntryItems: number[] = [];
    const skipRetroactiveItem = (itemNumero: number) => {
      retroactiveSkipped += 1;
      firstRetroactiveSkippedItem ??= itemNumero;
    };

    let entryDate = matchEntryDate(note, sources.entryRecords);
    let entryOrigin: NotaFiscalProcessada['origem_data_entrada'] = entryDate ? 'planilha_sistema_contabil' : null;
    if (!entryDate && note.origemExtracao === 'sped' && note.dataEntrada) {
      entryDate = note.dataEntrada;
      entryOrigin = 'sped_fiscal';
    }

    const confirmedEntry = note.origemExtracao === 'sped' || Boolean(entryDate);
    const paidEarly = hasEntrySource && !confirmedEntry;
    const auxiliaryCfop = note.origemExtracao !== 'sped' ? matchEntryCfop(note, sources.entryRecords) : null;

    const supplierIsSimples = isSimplesSupplier(note);
    // Coluna da MVA no fluxo geral da Tributária: decidida pelo CRT, e não por
    // supplierIsSimples (o CRT 2 conta como Simples para A.ORI e DIFAL, mas usa a
    // MVA ajustada). A política especial do passo a passo segue com supplierIsSimples.
    const mvaColumn = mvaColumnForNote(note);
    if (usageMode) {
      note.rawMetadata.fornecedor_uso_consumo = usageMode;
      diagnostic?.event('info', 'validacao', 'Fornecedor de uso e consumo: nota direcionada para DIFAL.', { numeroNota: note.numeroNota, modo: usageMode });
    }
    const groups = new Map<string, Group>();
    let classifiedItems = 0;

    for (const originalItem of note.itens) {
      const item = { ...originalItem };
      let mvaPolicyGroup: Group['mvaPolicyGroup'] = '';
      let mvaPolicySource = '';
      let bonusUsoConsumo = false;
      if (auxiliaryCfop && isUsoConsumoAtivo(auxiliaryCfop)) item.cfop = auxiliaryCfop;

      const cfopResolution = resolveCfop(context, item);
      let destination = cfopResolution.destino as TipoPlanilha | null;

      if (usageMode || isUsoConsumoAtivo(item.cfop)) destination = 'difal';

      const suffix = cleanDigits(item.cfop).slice(-3);
      if (!usageMode && BONUS_SUFFIXES.has(suffix) && request.bonusDecisions) {
        const decision = request.bonusDecisions[note.chaveAcesso]
          ?? request.bonusDecisions[String(note.numeroNota)];
        if (decision === true && isIndustryCompany) {
          excluded.push(buildExcludedItem(
            note, item, 'antecipacao_parcial', industryBonusRejectedReason(item.cfop), 'industria_sem_antecipacao',
          ));
          continue;
        }
        if (typeof decision === 'boolean') destination = decision ? 'antecipacao_parcial' : 'difal';
        bonusUsoConsumo = decision === false;
      }

      if (!destination && retroactive) {
        skipRetroactiveItem(item.itemNumero);
        continue;
      }
      if (!destination) {
        missingCfops[suffix || '????'] = (missingCfops[suffix || '????'] ?? 0) + 1;
        continue;
      }

      if (cfopResolution.reclassificado) item.cfop = cfopResolution.cfopEfetivo;
      destination = redirectRevendaToAntecipacaoTributaria(revendaAntecipacaoConfig, destination);
      if (revendaAntecipacaoConfig && destination === 'antecipacao_tributaria') {
        const classification = classifyRevendaMva(revendaAntecipacaoConfig, item);
        mvaPolicyGroup = classification.grupo;
        mvaPolicySource = classification.fonte;
        if (classification.aviso) {
          warnings.push({
            numero_nota: note.numeroNota,
            serie: note.serie,
            item_numero: item.itemNumero,
            arquivo: note.filename,
            aviso: classification.aviso,
          });
        }
      }
      destination = routePaidEarlyDestination(destination, paidEarly, isSimplesCompany);
      // Regime Normal: a DIFAL é apurada no mês da entrada. Bonificação de uso/consumo
      // ainda sem entrada fica para a apuração retroativa (evita pagar duas vezes).
      if (destination === 'difal' && paidEarly && bonusUsoConsumo) {
        awaitingEntryItems.push(item.itemNumero);
        continue;
      }
      if (context.empresa.optante_simples_nacional) {
        if (destination === 'antecipacao_parcial') destination = 'antecipacao_parcial_simples';
        if (destination === 'antecipacao_parcial_antecipado') destination = 'antecipacao_parcial_antecipado_simples';
      }

      // Indústria: só DIFAL (uso/consumo e ativo). Parcial e Tributária vão para os
      // itens excluídos, inclusive as redirecionadas pela política do perfil.
      if (isIndustryCompany && !isDifalDestination(destination) && !retroactive) {
        excluded.push(buildExcludedItem(
          note, item, destination, INDUSTRY_EXCLUSION_REASON, 'industria_sem_antecipacao',
        ));
        continue;
      }

      // Nota retroativa (Regime Normal): só a DIFAL é apurada na entrada.
      if (retroactive && destination !== 'difal') {
        skipRetroactiveItem(item.itemNumero);
        continue;
      }

      // Só o item efetivamente retido no XML sai da Tributária.
      // CFOP 6.102 -> 6.403 sem vICMSST é tributável, com sua parcela de frete.
      if (
        TAX_SUBSTITUTION_DESTINATIONS.has(destination)
        && shouldExcludeStItemFromTributaria(context.empresa.razao_social, note, originalItem)
      ) {
        excluded.push(buildExcludedItem(
          note, item, destination, ST_TRIBUTARIA_EXCLUSION_REASON, 'mercadoria',
          { base_calculo: item.baseCalculo },
        ));
        diagnostic?.event('info', 'calculo', ST_TRIBUTARIA_EXCLUSION_REASON, {
          numeroNota: note.numeroNota,
          itemNumero: item.itemNumero,
          chaveAcesso: note.chaveAcesso,
        });
        continue;
      }

      if (PARTIAL_DESTINATIONS.has(destination)) {
        pushPartialMetadataWarnings(note, item, warnings);

        const merchandise = evaluatePartialMerchandiseExclusion(context, destination, item);
        if (merchandise.excluded) {
          const base = itemBaseOrTotal(item);
          excluded.push(buildExcludedItem(
            note, item, destination, merchandise.motivo || 'Mercadoria excluída', 'mercadoria',
            { regras_aplicadas: merchandise.regras ?? [], base_calculo: base },
          ));
          // Controle: o item sai da apuração, mas consta na planilha separada de
          // imposto pago na entrada (Valor pago e Data de pagamento são manuais).
          if (merchandise.regras?.[0]?.motivo === 'imposto_pago_entrada') {
            let controlADst: number | undefined;
            let controlAOri = item.aOri;
            try {
              const controlRate = resolveDestinationRate(context, item, destination);
              controlADst = controlRate.aliquota;
              // O controle não é apuração, mas deve respeitar o limite de crédito do perfil.
              const origin = resolveOriginRate(context, destination, item.aOri, controlADst, controlRate.origem);
              if (origin.limited) controlAOri = origin.aOri;
            } catch {
              controlADst = undefined; // sem regra de alíquota: A.DST em branco, sem bloquear o controle
            }
            (rowsByDestination[CONTROLE_DESTINATION] ??= []).push({
              numero_nota: note.numeroNota,
              serie: note.serie,
              chave_acesso: note.chaveAcesso,
              cnpj_emitente: note.cnpjEmitente,
              uf_emitente: note.ufEmitente,
              cnpj_destinatario: note.cnpjDestinatario,
              uf_destinatario: context.empresa.uf,
              data_emissao: note.dataEmissao,
              data_entrada: EARLY_DESTINATIONS.has(destination) ? null : entryDate,
              item_numero: item.itemNumero,
              descricao: item.descricao,
              ncm: item.ncm,
              cfop: item.cfop,
              v_total: item.vTotal,
              base_calculo: base,
              ipi_despesas: item.ipiDespesas,
              mva: 0,
              reducao: null,
              red: '',
              aliq_simples: 'N',
              a_ori: controlAOri,
              a_dst: controlADst,
              debito: 0,
              credito: 0,
              valor_devido: 0,
            });
          }
          continue;
        }
      }

      const resolved = resolveConvenioAndRatesForItem({
        request,
        note,
        item,
        destination,
        convenio5291SavedIndustrialConfig,
        convenio5291Config,
        convenio5291AgricolaConfig,
        industrialDecisions,
        warnings,
        diagnostic,
      });
      const {
        convenio, itemReducao, baseADst, effectiveADst, effectiveRate, fcpResolution, fcpSeparado,
        originalAOri, originRate, aOri, aOriInferredSimples, aOriHighlighted, aOriInfCompl,
      } = resolved;

      if (PARTIAL_DESTINATIONS.has(destination)) {
        const numeric = shouldExcludeEqualRates(context, destination, item, aOri, effectiveADst);
        if (numeric.excluded) {
          excluded.push(buildExcludedItem(
            note, item, destination, 'Alíquotas iguais com valor devido zero ou negativo', 'aliquotas_iguais',
            {
              a_ori: aOri,
              a_dst: effectiveADst,
              debito: numeric.debito,
              credito: numeric.credito,
              valor_devido: numeric.valorDevido,
            },
          ));
          continue;
        }
      }

      let itemMva = 0;
      if (TAX_SUBSTITUTION_DESTINATIONS.has(destination)) {
        if (revendaAntecipacaoConfig) {
          itemMva = resolveRevendaMva(
            revendaAntecipacaoConfig, mvaPolicyGroup || 'demais', aOri, supplierIsSimples,
          );
        } else {
          // A faixa da MVA ajustada vem da A.ORI destacada no documento, antes de
          // inferência (Simples), alíquota fixa ou limite por redução.
          const mvaResolution = resolveMvaForItem(context, item.ncm, item.cest, originalAOri, mvaColumn);
          const mvaAutopecas = mvaResolution.status === 'pendente'
            ? resolveAutopecasMvaXml(context, note, item, mvaColumn, originalAOri, aOri, effectiveADst)
            : null;
          const reviewKey = mvaReviewKey(note,item);
          const candidateDecision = request.mvaDecisions?.[reviewKey];
          const decision = validMvaDecision(candidateDecision) ? candidateDecision : undefined;
          if (mvaResolution.status === 'pendente' && mvaAutopecas === null && (!decision || decision.mva === null)) {
            if (request.reviewPendingMva && !decision) {
              pendingMvas.push({
                key: reviewKey, numeroNota: note.numeroNota, chaveAcesso: note.chaveAcesso,
                itemNumero: item.itemNumero, descricao: item.descricao, ncm: item.ncm, cest: item.cest,
                cfop: item.cfop, aOri: originalAOri, aDst: effectiveADst, column: mvaColumn,
                mvaXml: item.stXml?.mva ?? null, motivo: mvaResolution.motivo,
                suggestions: autopecasMvaSuggestions(context,note,item,mvaColumn,originalAOri),
              });
              continue;
            }
            excluded.push(buildExcludedItem(
              note, item, destination, mvaResolution.motivo + (decision ? ' Decisão do analista: manter pendente. ' + decision.justificativa : ''), 'mva_pendente',
              { a_ori: originalAOri, a_dst: effectiveADst },
            ));
            diagnostic?.event('warning', 'calculo', 'Item da Antecipação Tributária sem MVA determinável: ficou fora da planilha.', {
              numeroNota: note.numeroNota,
              itemNumero: item.itemNumero,
              ncm: item.ncm,
              colunaMva: mvaResolution.column ?? 'indefinida',
              motivo: mvaResolution.motivo,
              mvaXml: item.stXml?.mva ?? null,
            });
            continue;
          }
          if (mvaResolution.status === 'ok') {
            itemMva = mvaResolution.mva;
          } else if (mvaAutopecas !== null) {
            itemMva = mvaAutopecas;
            mvaPolicySource = 'anexo1_item1.1_autopecas_xml_validado';
            diagnostic?.event('info', 'calculo', 'MVA de autopeças validada pelo item 1.1 do Anexo 1 (caso geral).', {
              numeroNota: note.numeroNota, itemNumero: item.itemNumero, ncm: item.ncm,
              mva: itemMva, mvaXml: item.stXml?.mva ?? null,
            });
          } else if (decision && decision.mva !== null) {
            itemMva = manualMvaEngineValue(decision.mva);
            mvaPolicySource = 'manual: ' + decision.justificativa.trim();
            diagnostic?.event('info','validacao','MVA confirmada pelo analista.',{
              numeroNota: note.numeroNota, itemNumero: item.itemNumero, mva: decision.mva,
              justificativa: decision.justificativa.trim(),
            });
          }
        }
      }

      const key = groupKey(
        destination,
        aOri,
        effectiveADst,
        itemMva,
        Boolean(convenio?.applied),
        itemReducao,
        fcpSeparado,
      ) + (mvaPolicySource.startsWith('manual: ') ? '|manual|' + item.itemNumero : '');
      const group: Group = groups.get(key) ?? {
        destination,
        aOri,
        aDst: effectiveADst,
        mva: itemMva,
        reducao: itemReducao,
        fcpSeparado,
        items: [],
        rateResolutions: [],
        baseADsts: [],
        fcpResolutions: [],
        cfopResolutions: [],
        aOriLimited: false,
        aOriFixed: false,
        aOriLimitWaived: false,
        aOriOriginal: originalAOri,
        aOriInferredSimples: false,
        aOriHighlighted: false,
        aOriInfCompl: false,
        pCredSN: [],
        mvaPolicyGroup,
        mvaPolicySource,
        convenio5291Applied: Boolean(convenio?.applied),
        convenio5291Manual: Boolean(
          convenio?.applied && convenio.classification.status === 'revisar'
        ),
        convenio5291OrigemAliquota: convenio?.origemAliquota ?? '',
        convenio5291Motivos: convenio?.applied ? [convenio.classification.motivo] : [],
        convenio5291Anexo: convenio?.applied ? convenio.anexo : '',
      };
      group.items.push(item);
      group.rateResolutions.push(effectiveRate);
      group.baseADsts.push(baseADst);
      group.fcpResolutions.push(fcpResolution);
      group.cfopResolutions.push(cfopResolution);
      group.aOriLimited ||= originRate.limited;
      group.aOriFixed ||= originRate.fixed;
      group.aOriLimitWaived ||= originRate.limitWaived;
      group.aOriInferredSimples ||= aOriInferredSimples;
      group.aOriHighlighted ||= aOriHighlighted;
      group.aOriInfCompl ||= aOriInfCompl;
      if (!group.mvaPolicyGroup && mvaPolicyGroup) {
        group.mvaPolicyGroup = mvaPolicyGroup;
        group.mvaPolicySource = mvaPolicySource;
      }
      if (item.pCredSN && !group.pCredSN.includes(item.pCredSN)) group.pCredSN.push(item.pCredSN);
      group.convenio5291Manual ||= Boolean(
        convenio?.applied && convenio.classification.status === 'revisar',
      );
      if (convenio?.applied && !group.convenio5291Motivos.includes(convenio.classification.motivo)) {
        group.convenio5291Motivos.push(convenio.classification.motivo);
      }
      if (convenio?.classification.status === 'revisar' && request.convenio5291Decisions?.[convenio.decisionKey] !== undefined) {
        diagnostic?.event('info', 'validacao', 'Decisão do usuário para o Convênio ICMS 52/91 aplicada.', {
          chaveAcesso: note.chaveAcesso,
          numeroNota: note.numeroNota,
          itemNumero: item.itemNumero,
          ncm: item.ncm,
          aplicar: request.convenio5291Decisions[convenio.decisionKey],
          motivo: convenio.classification.motivo,
        });
      }
      groups.set(key, group);
      classifiedItems += 1;
    }

    if (groups.size === 0) {
      if (retroactive) ignored.push(ignoredNote(note, periodReason));
      else if (awaitingEntryItems.length > 0) ignored.push(ignoredNote(note, DIFAL_AWAITING_ENTRY_REASON));
      continue;
    }
    if (awaitingEntryItems.length > 0) {
      warnings.push({
        numero_nota: note.numeroNota,
        serie: note.serie,
        item_numero: awaitingEntryItems[0],
        arquivo: note.filename,
        aviso: DIFAL_AWAITING_ENTRY_REASON,
      });
    }
    if (retroactive && retroactiveSkipped > 0) {
      warnings.push({
        numero_nota: note.numeroNota,
        serie: note.serie,
        item_numero: firstRetroactiveSkippedItem ?? 1,
        arquivo: note.filename,
        aviso: retroactiveDifalWarning(note),
      });
    }

    consolidateNoteGroups({
      note,
      groups,
      classifiedItems,
      context,
      entryDate,
      entryOrigin,
      supplierIsSimples,
      processed,
      rowsByDestination,
      fcpRowsByDestination,
      ignored,
      excluded,
      diagnostic,
    });
  }

  if (pendingMvas.length > 0) {
    if (diagnostic) diagnostic.attempt.status = 'aguardando_decisao';
    diagnostic?.stage('validacao','Processamento pausado para confirmação de MVA.',{pendencias:pendingMvas.length});
    return {
      preAnalysis: { requer_decisao: true, notas_bonificacao: [], itens_convenio_52_91: [], itens_mva: pendingMvas },
      notasProcessadas: [], notasIgnoradas: ignored, itensExcluidos: [], avisosAvaliacao: [],
      cfopsSemRegra: {}, rowsByDestination: {}, artifacts: [],
    };
  }
  if (ctes.length > 0) {
    processCtesLocally({
      ctes,
      nfeContextByKey,
      context,
      periodoInicio,
      periodoFim,
      entryRecords: sources.entryRecords,
      spedCteRecords: sources.spedCteRecords ?? [],
      hasEntrySource,
      processed,
      rowsByDestination,
      fcpRowsByDestination,
      ignored,
      warnings,
      diagnostic,
    });
  }

  if (rowsByDestination[CONTROLE_DESTINATION]?.length) {
    rowsByDestination[CONTROLE_DESTINATION] = consolidateControlRows(rowsByDestination[CONTROLE_DESTINATION]);
  }
  for (const rows of Object.values(rowsByDestination)) if (rows) sortRowsByEntryAndNumber(rows);
  for (const rows of Object.values(fcpRowsByDestination)) if (rows) sortRowsByEntryAndNumber(rows);

  // O controle não é apuração: não conta como "há o que recolher".
  const controlRows = rowsByDestination[CONTROLE_DESTINATION]?.length ?? 0;
  const totalRows = Object.values(rowsByDestination).reduce((sum, rows) => sum + (rows?.length ?? 0), 0) - controlRows;
  let message: string | null = null;
  if (totalRows === 0) {
    if (Object.keys(missingCfops).length > 0) {
      throw new Error(
        `Nenhum item correspondeu a um CFOP com regra de roteamento cadastrada (${Object.keys(missingCfops).sort().join(', ')}).`,
      );
    }
    const cteFaltante = ignored.find((item) => item.motivo.includes('NF-e(s) originária(s) não localizada(s)'));
    if (cteFaltante) {
      throw new Error(`Nenhum documento gerou apuração. ${cteFaltante.motivo}`);
    }
    if (excluded.length > 0) message = noOutputMessage(excluded);
    else if (ignored.length > 0) {
      throw new Error('Nenhuma NF-e válida para apuração interestadual foi encontrada no período informado.');
    } else {
      throw new Error('Nenhuma nota fiscal pôde ser processada.');
    }
  }

  const artifacts = totalRows > 0 || controlRows > 0
    ? await generateOutputArtifacts({
      context,
      periodoInicio,
      spedIe: sources.spedCompanyInfo.ie,
      rowsByDestination,
      fcpRowsByDestination,
      templateBytes,
      loadTemplate,
      diagnostic,
    })
    : [];

  diagnostic?.event('info', 'transformacao', 'Regras fiscais e cálculos concluídos.', {
    registrosProcessados: processed.length,
    registrosIgnorados: ignored.length,
    itensExcluidos: excluded.length,
    destinosGerados: artifacts.length,
  }, Math.round(performance.now() - transformationStartedAt));
  diagnostic?.setSummary({
    processed: processed.length,
    ignored: ignored.length,
    rejected: sources.ignoredNotes.length,
    outputs: artifacts.length,
  });

  return {
    preAnalysis: { requer_decisao: false, notas_bonificacao: pending, itens_convenio_52_91: [] },
    notasProcessadas: processed,
    notasIgnoradas: ignored,
    itensExcluidos: excluded,
    avisosAvaliacao: warnings,
    cfopsSemRegra: missingCfops,
    rowsByDestination,
    fcpRowsByDestination,
    artifacts,
    mensagem: message,
  };
}
