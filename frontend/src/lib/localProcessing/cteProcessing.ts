import type { JsonObject } from '../../types/common';
import type {
  LocalOutputRow,
  LocalProcessingRequest,
  LocalProcessingResult,
} from '../../types/localProcessing';
import type {
  AvisoAvaliacao,
  NotaFiscalProcessada,
  NotaIgnorada,
  TipoPlanilha,
} from '../../types/solicitacao';
import type { DiagnosticRecorder } from '../processingDiagnostics';
import type { CalculationResult, EntrySheetRecord, ExtractedCTe, ExtractedNote } from './domain.ts';
import {
  BONUS_SUFFIXES,
  EARLY_DESTINATIONS,
  PARTIAL_DESTINATIONS,
  TAX_SUBSTITUTION_DESTINATIONS,
} from './domain.ts';
import { calculateTax, roundCurrency } from './calculations.ts';
import {
  buildFcpMetadata,
  buildFcpOutputRow,
  calculateSeparateFcp,
  computeFcpApplication,
  formatCurrencyString,
  formatRateString,
  roundRate,
  withNoteContext,
} from './fcp.ts';
import { isSimplesSupplier, resolveSimpleOriginReference } from './interstateRate.ts';
import { cleanDigits, isOwnEmissionNote, isSameUfNote } from './preAnalysis.ts';
import {
  classifyRevendaMva,
  getRevendaAntecipacaoConfig,
  isDifalDestination,
  isIndustria,
  mvaColumnForNote,
  redirectRevendaToAntecipacaoTributaria,
  resolveDestinationRate,
  resolveFcp,
  resolveMvaForItem,
  resolveRevendaMva,
  resolveStandardDestinationRate,
  resolveTributariaReduction,
  routePaidEarlyDestination,
  resolveCfop,
} from './rules.ts';
import { isUsoConsumoAtivo, matchEntryCfop, matchEntryDate } from './sources.ts';
import { extractNfeNumberAndSeriesFromKey } from './xml.ts';

export interface TribCandidateForCte {
  mva: number;
  reducao: number | null;
  aDst: number;
  vTotal: number;
  fcp: number;
  fcpOrigem: string | null;
  fcpDetalhe: string | null;
  mvaGrupo: 'especial' | 'demais' | '';
  mvaFonte: string;
}

export interface NfeCteContext {
  chaveAcesso: string;
  numeroNota: string;
  vTotalNota: number;
  entryDate: string | null;
  entryOrigin: NotaFiscalProcessada['origem_data_entrada'];
  confirmedEntry: boolean;
  paidEarly: boolean;
  somaTrib: number;
  somaDifal: number;
  tribCandidates: TribCandidateForCte[];
  allItemsTributaria: boolean;
  allItemsDifal: boolean;
}

export function evaluateNfeForCte(params: {
  note: ExtractedNote;
  context: LocalProcessingRequest['context'];
  entryRecords: EntrySheetRecord[];
  hasEntrySource: boolean;
  bonusDecisions?: Record<string, boolean>;
}): NfeCteContext {
  const { note, context, entryRecords, hasEntrySource, bonusDecisions } = params;
  const chaveAcesso = cleanDigits(note.chaveAcesso);

  let entryDate = matchEntryDate(note, entryRecords);
  let entryOrigin: NotaFiscalProcessada['origem_data_entrada'] = entryDate
    ? 'planilha_sistema_contabil'
    : null;
  if (!entryDate && note.origemExtracao === 'sped' && note.dataEntrada) {
    entryDate = note.dataEntrada;
    entryOrigin = 'sped_fiscal';
  }

  const confirmedEntry = note.origemExtracao === 'sped' || Boolean(entryDate);
  const paidEarly = hasEntrySource && !confirmedEntry;
  const vTotalNota = note.vTotalNota > 0
    ? note.vTotalNota
    : note.itens.reduce((sum, it) => sum + it.vTotal, 0);

  if (isOwnEmissionNote(note, context.empresa.cnpj) || isSameUfNote(note, context.empresa.uf)) {
    return {
      chaveAcesso,
      numeroNota: note.numeroNota,
      vTotalNota,
      entryDate,
      entryOrigin,
      confirmedEntry,
      paidEarly,
      somaTrib: 0,
      somaDifal: 0,
      tribCandidates: [],
      allItemsTributaria: false,
      allItemsDifal: false,
    };
  }

  const auxiliaryCfop = note.origemExtracao !== 'sped' ? matchEntryCfop(note, entryRecords) : null;
  const supplierIsSimples = isSimplesSupplier(note);
  const mvaColumn = mvaColumnForNote(note);
  const revendaConfig = getRevendaAntecipacaoConfig(context);
  const isIndustryCompany = isIndustria(context);
  const isSimplesCompany = Boolean(context.empresa.optante_simples_nacional);

  let somaTrib = 0;
  let somaDifal = 0;
  const tribCandidates: TribCandidateForCte[] = [];
  let countTrib = 0;
  let countDifal = 0;
  let hasOtherOrExcluded = false;

  for (const originalItem of note.itens) {
    const item = { ...originalItem };
    let mvaPolicyGroup: TribCandidateForCte['mvaGrupo'] = '';
    let mvaPolicySource = '';
    let bonusUsoConsumo = false;

    if (auxiliaryCfop && isUsoConsumoAtivo(auxiliaryCfop)) item.cfop = auxiliaryCfop;

    const cfopResolution = resolveCfop(context, item);
    let destination = cfopResolution.destino as TipoPlanilha | null;
    if (isUsoConsumoAtivo(item.cfop)) destination = 'difal';

    const suffix = cleanDigits(item.cfop).slice(-3);
    if (BONUS_SUFFIXES.has(suffix) && bonusDecisions) {
      const decision = bonusDecisions[note.chaveAcesso] ?? bonusDecisions[String(note.numeroNota)];
      if (decision === true && isIndustryCompany) {
        hasOtherOrExcluded = true;
        continue;
      }
      if (typeof decision === 'boolean') destination = decision ? 'antecipacao_parcial' : 'difal';
      bonusUsoConsumo = decision === false;
    }

    if (!destination) {
      hasOtherOrExcluded = true;
      continue;
    }

    if (cfopResolution.reclassificado) item.cfop = cfopResolution.cfopEfetivo;
    destination = redirectRevendaToAntecipacaoTributaria(revendaConfig, destination);
    if (revendaConfig && destination === 'antecipacao_tributaria') {
      const classification = classifyRevendaMva(revendaConfig, item);
      mvaPolicyGroup = classification.grupo;
      mvaPolicySource = classification.fonte;
    }

    destination = routePaidEarlyDestination(destination, paidEarly, isSimplesCompany);
    if (destination === 'difal' && paidEarly && bonusUsoConsumo) {
      hasOtherOrExcluded = true;
      continue;
    }
    if (isSimplesCompany) {
      if (destination === 'antecipacao_parcial') destination = 'antecipacao_parcial_simples';
      if (destination === 'antecipacao_parcial_antecipado') destination = 'antecipacao_parcial_antecipado_simples';
    }

    if (isIndustryCompany && !isDifalDestination(destination)) {
      hasOtherOrExcluded = true;
      continue;
    }

    if (PARTIAL_DESTINATIONS.has(destination)) {
      hasOtherOrExcluded = true;
      continue;
    }

    if (TAX_SUBSTITUTION_DESTINATIONS.has(destination)) {
      const rate = withNoteContext(note, () => resolveDestinationRate(context, item, destination));
      const itemReducao = withNoteContext(note, () => resolveTributariaReduction(context, item))?.aliquota ?? null;
      const fcpRes = withNoteContext(note, () => resolveFcp(context, item));
      const { fcpAliquota, effectiveADst } = computeFcpApplication(
        destination,
        isSimplesCompany,
        rate.aliquota,
        fcpRes,
      );
      const aOri = resolveSimpleOriginReference(note, item, context.empresa.uf, false).rate;
      let itemMva = 0;
      if (revendaConfig) {
        itemMva = resolveRevendaMva(revendaConfig, mvaPolicyGroup || 'demais', aOri, supplierIsSimples);
      } else {
        const mvaRes = resolveMvaForItem(context, item.ncm, item.cest, item.aOri, mvaColumn);
        if (mvaRes.status === 'pendente') {
          hasOtherOrExcluded = true;
          continue;
        }
        itemMva = mvaRes.mva;
      }
      const temFcp = fcpAliquota > 0;
      somaTrib += item.vTotal;
      countTrib += 1;
      tribCandidates.push({
        mva: itemMva,
        reducao: itemReducao,
        aDst: effectiveADst,
        vTotal: item.vTotal,
        fcp: fcpAliquota,
        fcpOrigem: temFcp && fcpRes ? fcpRes.origem : null,
        fcpDetalhe: temFcp && fcpRes ? fcpRes.detalhe : null,
        mvaGrupo: mvaPolicyGroup,
        mvaFonte: mvaPolicySource,
      });
    } else if (isDifalDestination(destination)) {
      somaDifal += item.vTotal;
      countDifal += 1;
    } else {
      hasOtherOrExcluded = true;
    }
  }

  const totalItens = note.itens.length;
  return {
    chaveAcesso,
    numeroNota: note.numeroNota,
    vTotalNota,
    entryDate,
    entryOrigin,
    confirmedEntry,
    paidEarly,
    somaTrib,
    somaDifal,
    tribCandidates,
    allItemsTributaria: totalItens > 0 && countTrib === totalItens && !hasOtherOrExcluded && countDifal === 0,
    allItemsDifal: totalItens > 0 && countDifal === totalItens && !hasOtherOrExcluded && countTrib === 0,
  };
}

function cteIgnoredRecord(cte: ExtractedCTe, motivo: string): NotaIgnorada {
  return {
    numero_nota: cte.numeroCte || 'Não identificado',
    serie: cte.serie || null,
    chave_acesso: cte.chaveAcesso || null,
    data_emissao: cte.dataEmissao ? cte.dataEmissao.slice(0, 10) : null,
    motivo,
    arquivo: cte.filename,
  };
}

interface FcpParcelaRowData {
  vTotal: number;
  baseCalculo: number;
  mva: number;
  reducao: number | null;
  fcpAliquota: number;
  fcpCalc: CalculationResult;
  percentualRateio: number;
  fcpOrigem: string | null;
  fcpDetalhe: string | null;
}

function ratearBaseCalculoCte(
  cte: ExtractedCTe,
  vTotalRateado: number,
  ratio: number,
  fullScope: boolean,
): number {
  if (cte.vBcCte > 0 && cte.vBcCte < cte.vTotalCte) {
    return fullScope ? cte.vBcCte : roundCurrency(cte.vBcCte * ratio);
  }
  return vTotalRateado;
}

function maxMvaAndReducao(candidates: TribCandidateForCte[]): {
  maxMva: number;
  maxCandidates: TribCandidateForCte[];
  reducao: number | null;
} {
  const maxMva = Math.max(...candidates.map((cand) => cand.mva));
  const maxCandidates = candidates.filter((cand) => cand.mva === maxMva);
  return { maxMva, maxCandidates, reducao: maxCandidates[0]?.reducao ?? null };
}

function joinFcpField(
  candidates: TribCandidateForCte[],
  field: 'fcpOrigem' | 'fcpDetalhe',
): string | null {
  const values = [...new Set(candidates.map((cand) => cand[field]).filter((v): v is string => Boolean(v)))].sort();
  return values.join('; ') || null;
}

function emitCteRow(params: {
  context: LocalProcessingRequest['context'];
  cte: ExtractedCTe;
  destination: TipoPlanilha;
  vTotal: number;
  baseCalculo: number;
  mva: number;
  reducao: number | null;
  aDst: number;
  aliqSimples: string;
  entryDate: string | null;
  entryOrigin: NotaFiscalProcessada['origem_data_entrada'];
  percentualRateio: number;
  numerosNfeOrigem: string[];
  mvaGrupo: string | null;
  mvaFonte: string | null;
  processed: LocalProcessingResult['notasProcessadas'];
  rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  itemNumero?: number;
  desdobramento?: boolean;
  fcpMetadados?: JsonObject;
  fcpRowsData?: FcpParcelaRowData[];
  fcpRowsByDestination?: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
}): void {
  const {
    context,
    cte,
    destination,
    vTotal,
    baseCalculo,
    mva,
    reducao,
    aDst,
    aliqSimples,
    entryDate,
    entryOrigin,
    percentualRateio,
    numerosNfeOrigem,
    mvaGrupo,
    mvaFonte,
    processed,
    rowsByDestination,
    itemNumero = 1,
    desdobramento = false,
    fcpMetadados,
    fcpRowsData,
    fcpRowsByDestination,
  } = params;

  const aOriCalc = cte.aOriHighlighted ? cte.aOri : 0;
  if (baseCalculo < 0 || aOriCalc < 0 || aOriCalc > 1 || aDst < 0 || aDst > 1) {
    throw new Error(`CT-e ${cte.numeroCte}: valores fiscais fora da faixa válida.`);
  }
  for (const fcpItem of fcpRowsData ?? []) {
    if (fcpItem.baseCalculo < 0 || fcpItem.fcpAliquota < 0 || fcpItem.fcpAliquota > 1) {
      throw new Error(`CT-e ${cte.numeroCte}: valores fiscais de FCP fora da faixa válida.`);
    }
  }

  const calculation = calculateTax(destination, {
    vTotal,
    baseCalculo,
    ipiDespesas: 0,
    aOri: aOriCalc,
    aDst,
    mva,
    reducao,
    aliqSimples,
    isSimples: Boolean(context.empresa.optante_simples_nacional),
  });

  const effectiveEntryDate = EARLY_DESTINATIONS.has(destination) ? null : entryDate;
  const effectiveEntryOrigin = EARLY_DESTINATIONS.has(destination) ? null : entryOrigin;
  const cnpjTomador = cleanDigits(cte.cnpjTomador) || cleanDigits(context.empresa.cnpj);
  const numeroNotaPlanilha = itemNumero > 1 ? `${cte.numeroCte}*` : cte.numeroCte;

  processed.push({
    chave_acesso: cte.chaveAcesso,
    numero_nota: cte.numeroCte,
    serie: cte.serie,
    cnpj_emitente: cte.cnpjEmitente,
    uf_emitente: cte.ufEmitente,
    cnpj_destinatario: cnpjTomador,
    uf_destinatario: context.empresa.uf,
    data_emissao: cte.dataEmissao,
    data_entrada: effectiveEntryDate,
    origem_data_entrada: effectiveEntryOrigin,
    item_numero: itemNumero,
    ncm: '',
    cfop: cte.cfop,
    destino_planilha: destination,
    v_total: vTotal,
    base_calculo: baseCalculo,
    ipi_despesas: 0,
    a_ori: aOriCalc,
    a_dst_resolvida: aDst,
    debito: calculation.debito,
    credito: calculation.credito,
    valor_devido: calculation.valorDevido,
    metadados_extras: {
      tipo_documento: 'cte',
      desdobramento,
      subitem_index: itemNumero,
      chaves_nfe_origem: [...cte.chavesNfe],
      numeros_nfe_origem: numerosNfeOrigem,
      percentual_rateio: String(percentualRateio),
      mva: String(mva),
      reducao: reducao != null ? String(reducao) : null,
      mva_grupo: mvaGrupo,
      mva_fonte: mvaFonte,
      fornecedor_simples_nacional: cte.fornecedorSimplesNacional,
      aliq_simples: aliqSimples,
      a_ori_destacada: cte.aOriHighlighted,
      ...calculation.detalhes,
      ...(fcpMetadados ?? {}),
    },
  });

  const row: LocalOutputRow = {
    numero_nota: numeroNotaPlanilha,
    serie: cte.serie,
    chave_acesso: cte.chaveAcesso,
    cnpj_emitente: cte.cnpjEmitente,
    uf_emitente: cte.ufEmitente,
    cnpj_destinatario: cnpjTomador,
    uf_destinatario: context.empresa.uf,
    data_emissao: cte.dataEmissao,
    data_entrada: effectiveEntryDate,
    item_numero: itemNumero,
    descricao: `CT-e ${cte.numeroCte} (${cte.nomeEmitente || 'Frete'})`,
    ncm: '',
    cfop: cte.cfop,
    v_total: vTotal,
    base_calculo: baseCalculo,
    ipi_despesas: 0,
    mva,
    reducao,
    red: '',
    aliq_simples: aliqSimples,
    a_ori: cte.aOriHighlighted ? cte.aOri : null,
    a_dst: aDst,
    debito: calculation.debito,
    credito: calculation.credito,
    valor_devido: calculation.valorDevido,
  };
  (rowsByDestination[destination] ??= []).push(row);

  if (fcpRowsData?.length && fcpRowsByDestination) {
    const totalParcelas = fcpRowsData.length;
    fcpRowsData.forEach((fcpItem, idx) => {
      (fcpRowsByDestination[destination] ??= []).push(
        buildFcpOutputRow(row, fcpItem.fcpAliquota, fcpItem.fcpCalc, {
          numero_nota: cte.numeroCte,
          item_numero: totalParcelas > 1 ? idx + 1 : 1,
          v_total: fcpItem.vTotal,
          base_calculo: fcpItem.baseCalculo,
          mva: fcpItem.mva,
          reducao: fcpItem.reducao,
        }),
      );
    });
  }
}

function processCteTributaria(params: {
  context: LocalProcessingRequest['context'];
  cte: ExtractedCTe;
  nfesCtx: NfeCteContext[];
  contributingTrib: NfeCteContext[];
  destinoTrib: TipoPlanilha;
  vTotalNfes: number;
  somaTrib: number;
  entryDate: string | null;
  entryOrigin: NotaFiscalProcessada['origem_data_entrada'];
  numerosOrigem: string[];
  processed: LocalProcessingResult['notasProcessadas'];
  rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  fcpRowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  diagnostic?: DiagnosticRecorder;
}): void {
  const {
    context,
    cte,
    nfesCtx,
    contributingTrib,
    destinoTrib,
    vTotalNfes,
    somaTrib,
    entryDate,
    entryOrigin,
    numerosOrigem,
    processed,
    rowsByDestination,
    fcpRowsByDestination,
    diagnostic,
  } = params;

  const allTrib = nfesCtx.every((ctx) => ctx.allItemsTributaria);
  const ratioTrib = allTrib ? 1 : Math.min(1, somaTrib / vTotalNfes);
  const vTotalCteTrib = allTrib ? cte.vTotalCte : roundCurrency(cte.vTotalCte * ratioTrib);
  if (vTotalCteTrib <= 0) return;

  const vBcCteTrib = ratearBaseCalculoCte(cte, vTotalCteTrib, ratioTrib, allTrib);
  const allCandidates = contributingTrib.flatMap((ctx) => ctx.tribCandidates);
  const aDstPadrao = resolveStandardDestinationRate(context, {
    itemNumero: 1,
    ncm: '',
    cest: '',
    cfop: cte.cfop,
    descricao: '',
    descricaoConfiavel: false,
    vItem: vTotalCteTrib,
    vTotal: vTotalCteTrib,
    baseCalculo: vBcCteTrib,
    ipiDespesas: 0,
    aOri: cte.aOri,
    vIcms: cte.vIcmsCte,
  }).aliquota;
  const percentualTrib = Math.round((ratioTrib * 100 + Number.EPSILON) * 10000) / 10000;

  if (context.empresa.optante_simples_nacional) {
    const snGroups = new Map<number, TribCandidateForCte[]>();
    for (const cand of allCandidates) {
      const fcpKey = roundRate(cand.fcp || 0);
      const bucket = snGroups.get(fcpKey);
      if (bucket) bucket.push(cand);
      else snGroups.set(fcpKey, [cand]);
    }
    const isSplit = snGroups.size > 1;
    let emittedIdx = 0;
    for (const [fcpGrupo, candsGrupo] of snGroups.entries()) {
      let vTotalGrupo = vTotalCteTrib;
      let vBcGrupo = vBcCteTrib;
      let percentualGrupo = percentualTrib;
      if (isSplit) {
        const somaGrupo = candsGrupo.reduce((sum, c) => sum + c.vTotal, 0);
        const ratioGrupo = Math.min(1, somaGrupo / vTotalNfes);
        vTotalGrupo = roundCurrency(cte.vTotalCte * ratioGrupo);
        if (vTotalGrupo <= 0) continue;
        vBcGrupo = ratearBaseCalculoCte(cte, vTotalGrupo, ratioGrupo, false);
        percentualGrupo = Math.round((ratioGrupo * 100 + Number.EPSILON) * 10000) / 10000;
      }

      const { maxMva, maxCandidates, reducao } = maxMvaAndReducao(candsGrupo);
      const temFcp = fcpGrupo > 0;
      const aDstTotal = temFcp ? roundRate(aDstPadrao + fcpGrupo) : aDstPadrao;
      emittedIdx += 1;
      const fcpMeta = buildFcpMetadata({
        aDstBase: aDstPadrao,
        fcpAliquota: temFcp ? fcpGrupo : null,
        fcpOrigem: temFcp ? joinFcpField(candsGrupo, 'fcpOrigem') : null,
        fcpDetalhe: temFcp ? joinFcpField(candsGrupo, 'fcpDetalhe') : null,
        fcpSeparado: false,
      });

      emitCteRow({
        context,
        cte,
        destination: destinoTrib,
        vTotal: vTotalGrupo,
        baseCalculo: vBcGrupo,
        mva: maxMva,
        reducao,
        aDst: aDstTotal,
        aliqSimples: 'N',
        entryDate,
        entryOrigin,
        percentualRateio: percentualGrupo,
        numerosNfeOrigem: numerosOrigem,
        mvaGrupo: maxCandidates[0]?.mvaGrupo || null,
        mvaFonte: maxCandidates[0]?.mvaFonte || null,
        processed,
        rowsByDestination,
        itemNumero: emittedIdx,
        desdobramento: isSplit,
        fcpMetadados: fcpMeta,
      });
    }
    diagnostic?.event('info', 'calculo', 'CT-e incluído na Antecipação Tributária.', {
      numeroCte: cte.numeroCte,
      destino: destinoTrib,
      valorRateado: vTotalCteTrib,
      desdobramentoFcpSn: isSplit,
    });
    return;
  }

  const { maxMva, maxCandidates, reducao: reducaoTrib } = maxMvaAndReducao(allCandidates);
  const fcpGroups = new Map<number, TribCandidateForCte[]>();
  for (const cand of allCandidates) {
    if (cand.fcp > 0) {
      const fcpKey = roundRate(cand.fcp);
      const bucket = fcpGroups.get(fcpKey);
      if (bucket) bucket.push(cand);
      else fcpGroups.set(fcpKey, [cand]);
    }
  }

  const fcpRowsData: FcpParcelaRowData[] = [];
  for (const [fcpAliq, candsFcp] of fcpGroups.entries()) {
    const somaFcp = candsFcp.reduce((sum, c) => sum + c.vTotal, 0);
    const allSameFcp = allTrib && candsFcp.length === allCandidates.length;
    const ratioFcp = allSameFcp ? 1 : Math.min(1, somaFcp / vTotalNfes);
    const vTotalCteFcp = allSameFcp ? cte.vTotalCte : roundCurrency(cte.vTotalCte * ratioFcp);
    if (vTotalCteFcp <= 0) continue;

    const vBcCteFcp = ratearBaseCalculoCte(cte, vTotalCteFcp, ratioFcp, allSameFcp);
    const { maxMva: maxMvaFcp, reducao: reducaoFcp } = maxMvaAndReducao(candsFcp);
    const fcpCalc = calculateSeparateFcp({
      destination: destinoTrib,
      vTotal: vTotalCteFcp,
      baseCalculo: vBcCteFcp,
      ipiDespesas: 0,
      mva: maxMvaFcp,
      reducao: reducaoFcp,
      fcpAliquota: fcpAliq,
    });
    fcpRowsData.push({
      vTotal: vTotalCteFcp,
      baseCalculo: vBcCteFcp,
      mva: maxMvaFcp,
      reducao: reducaoFcp,
      fcpAliquota: fcpAliq,
      fcpCalc,
      percentualRateio: Math.round((ratioFcp * 100 + Number.EPSILON) * 10000) / 10000,
      fcpOrigem: joinFcpField(candsFcp, 'fcpOrigem'),
      fcpDetalhe: joinFcpField(candsFcp, 'fcpDetalhe'),
    });
  }

  let fcpMeta: JsonObject;
  if (fcpRowsData.length === 0) {
    fcpMeta = buildFcpMetadata({
      aDstBase: aDstPadrao,
      fcpAliquota: null,
      fcpOrigem: null,
      fcpDetalhe: null,
      fcpSeparado: false,
    });
  } else if (fcpRowsData.length === 1) {
    const it0 = fcpRowsData[0];
    fcpMeta = {
      ...buildFcpMetadata({
        aDstBase: aDstPadrao,
        fcpAliquota: it0.fcpAliquota,
        fcpOrigem: it0.fcpOrigem,
        fcpDetalhe: it0.fcpDetalhe,
        fcpSeparado: true,
        fcpCalc: it0.fcpCalc,
      }),
      fcp_cte_v_total: formatCurrencyString(it0.vTotal),
      fcp_cte_mva: String(it0.mva),
      fcp_cte_reducao: it0.reducao != null ? String(it0.reducao) : null,
      fcp_percentual_rateio: it0.percentualRateio.toFixed(4),
    };
  } else {
    fcpMeta = {
      a_dst_base: formatRateString(aDstPadrao),
      fcp_separado: true,
      fcp_parcelas: fcpRowsData.map((it) => ({
        v_total: formatCurrencyString(it.vTotal),
        base_calculo: formatCurrencyString(it.baseCalculo),
        mva: String(it.mva),
        reducao: it.reducao != null ? String(it.reducao) : null,
        fcp_aliquota: formatRateString(it.fcpAliquota),
        fcp_base_st: formatCurrencyString(Number(it.fcpCalc.detalhes.base_st ?? 0)),
        debito: formatCurrencyString(it.fcpCalc.debito),
        fcp_valor_devido: formatCurrencyString(it.fcpCalc.valorDevido),
        percentual_rateio: it.percentualRateio.toFixed(4),
        fcp_origem: it.fcpOrigem,
        fcp_detalhe: it.fcpDetalhe,
      })),
    };
  }

  emitCteRow({
    context,
    cte,
    destination: destinoTrib,
    vTotal: vTotalCteTrib,
    baseCalculo: vBcCteTrib,
    mva: maxMva,
    reducao: reducaoTrib,
    aDst: aDstPadrao,
    aliqSimples: 'N',
    entryDate,
    entryOrigin,
    percentualRateio: percentualTrib,
    numerosNfeOrigem: numerosOrigem,
    mvaGrupo: maxCandidates[0]?.mvaGrupo || null,
    mvaFonte: maxCandidates[0]?.mvaFonte || null,
    processed,
    rowsByDestination,
    fcpMetadados: fcpMeta,
    fcpRowsData,
    fcpRowsByDestination,
  });
  diagnostic?.event('info', 'calculo', 'CT-e incluído na Antecipação Tributária.', {
    numeroCte: cte.numeroCte,
    destino: destinoTrib,
    valorRateado: vTotalCteTrib,
    mvaHerdada: maxMva,
  });
}

export function processCtesLocally(params: {
  ctes: ExtractedCTe[];
  nfeContextByKey: Map<string, NfeCteContext>;
  context: LocalProcessingRequest['context'];
  periodoInicio: string;
  periodoFim: string;
  entryRecords: EntrySheetRecord[];
  spedCteRecords: EntrySheetRecord[];
  hasEntrySource: boolean;
  processed: LocalProcessingResult['notasProcessadas'];
  rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  fcpRowsByDestination?: Partial<Record<TipoPlanilha, LocalOutputRow[]>>;
  ignored: NotaIgnorada[];
  warnings: AvisoAvaliacao[];
  diagnostic?: DiagnosticRecorder;
}): void {
  const {
    ctes,
    nfeContextByKey,
    context,
    periodoInicio,
    periodoFim,
    entryRecords,
    spedCteRecords,
    hasEntrySource,
    processed,
    rowsByDestination,
    fcpRowsByDestination = {},
    ignored,
    warnings,
    diagnostic,
  } = params;
  const empresaCnpj = cleanDigits(context.empresa.cnpj);
  const isSimplesCompany = Boolean(context.empresa.optante_simples_nacional);

  for (const cte of ctes) {
    const tomador = cleanDigits(cte.cnpjTomador);
    if (!empresaCnpj || tomador !== empresaCnpj) {
      ignored.push(
        cteIgnoredRecord(
          cte,
          `CT-e desconsiderado: o tomador do serviço (${tomador || 'não identificado'}) não é a empresa em processamento (${empresaCnpj}).`,
        ),
      );
      continue;
    }

    if (isSameUfNote(cte, context.empresa.uf)) {
      ignored.push(
        cteIgnoredRecord(
          cte,
          `Operação interna estadual desconsiderada: UF do emitente do CT-e (${cte.ufEmitente}) é igual à UF do tomador (${context.empresa.uf}).`,
        ),
      );
      continue;
    }

    const issueDate = cte.dataEmissao.slice(0, 10);
    if (issueDate < periodoInicio || issueDate > periodoFim) {
      ignored.push(
        cteIgnoredRecord(
          cte,
          `CT-e com data de emissão (${issueDate}) fora do período informado (${periodoInicio} a ${periodoFim}).`,
        ),
      );
      continue;
    }

    if (cte.vTotalCte <= 0) {
      ignored.push(
        cteIgnoredRecord(cte, `CT-e com valor total zerado (R$ ${cte.vTotalCte.toFixed(2)}).`),
      );
      continue;
    }

    if (cte.chavesNfe.length === 0) {
      ignored.push(
        cteIgnoredRecord(
          cte,
          'CT-e desconsiderado: nenhuma NF-e originária (<infNFe><chave>) foi vinculada no XML.',
        ),
      );
      continue;
    }

    const missing = cte.chavesNfe.filter((chv) => !nfeContextByKey.has(chv));
    if (missing.length > 0) {
      const faltantesDesc = missing
        .map((chv) => `NF-e ${extractNfeNumberAndSeriesFromKey(chv).numeroNota} (Chave: ${chv})`)
        .join(', ');
      warnings.push({
        numero_nota: cte.numeroCte,
        serie: cte.serie,
        item_numero: 1,
        arquivo: cte.filename,
        aviso: `CT-e nº ${cte.numeroCte} não processado: forneça o XML da(s) NF-e(s) originária(s) (${faltantesDesc}).`,
      });
      ignored.push(
        cteIgnoredRecord(
          cte,
          `NF-e(s) originária(s) não localizada(s): ${faltantesDesc}. Forneça o XML (ou ZIP com as notas) para processar este CT-e.`,
        ),
      );
      continue;
    }

    const nfesCtx = cte.chavesNfe.map((chv) => nfeContextByKey.get(chv)!);
    const vTotalNfes = nfesCtx.reduce((sum, ctx) => sum + ctx.vTotalNota, 0);
    const somaTrib = nfesCtx.reduce((sum, ctx) => sum + ctx.somaTrib, 0);
    const somaDifal = nfesCtx.reduce((sum, ctx) => sum + ctx.somaDifal, 0);

    if (vTotalNfes <= 0 || (somaTrib <= 0 && somaDifal <= 0)) {
      ignored.push(
        cteIgnoredRecord(
          cte,
          'CT-e desconsiderado: a(s) NF-e(s) originária(s) não possuem mercadorias destinadas à Antecipação Tributária ou DIFAL.',
        ),
      );
      continue;
    }

    const cteMatchKey = {
      chaveAcesso: cte.chaveAcesso,
      cnpjEmitente: cte.cnpjEmitente,
      numeroNota: cte.numeroCte,
      serie: cte.serie,
    };
    let cteEntryDate = matchEntryDate(cteMatchKey, entryRecords);
    let cteEntryOrigin: NotaFiscalProcessada['origem_data_entrada'] = cteEntryDate
      ? 'planilha_sistema_contabil'
      : null;
    if (!cteEntryDate && spedCteRecords.length > 0) {
      const d100Date = matchEntryDate(cteMatchKey, spedCteRecords);
      if (d100Date) {
        cteEntryDate = d100Date;
        cteEntryOrigin = 'sped_fiscal';
      }
    }

    const resolveEntryFor = (contributing: NfeCteContext[]): {
      entryDate: string | null;
      entryOrigin: NotaFiscalProcessada['origem_data_entrada'];
      paidEarly: boolean;
    } => {
      if (cteEntryDate) {
        return { entryDate: cteEntryDate, entryOrigin: cteEntryOrigin, paidEarly: false };
      }
      const confirmed = contributing.find((ctx) => ctx.confirmedEntry);
      if (confirmed) {
        return {
          entryDate: confirmed.entryDate,
          entryOrigin: confirmed.entryOrigin,
          paidEarly: false,
        };
      }
      return { entryDate: null, entryOrigin: null, paidEarly: hasEntrySource };
    };

    const numerosOrigem = nfesCtx.map((ctx) => ctx.numeroNota);

    if (somaTrib > 0) {
      const contributingTrib = nfesCtx.filter((ctx) => ctx.somaTrib > 0);
      const { entryDate, entryOrigin, paidEarly } = resolveEntryFor(contributingTrib);
      const destinoTrib = routePaidEarlyDestination('antecipacao_tributaria', paidEarly, isSimplesCompany);
      processCteTributaria({
        context,
        cte,
        nfesCtx,
        contributingTrib,
        destinoTrib,
        vTotalNfes,
        somaTrib,
        entryDate,
        entryOrigin,
        numerosOrigem,
        processed,
        rowsByDestination,
        fcpRowsByDestination,
        diagnostic,
      });
    }

    if (somaDifal > 0) {
      const contributingDifal = nfesCtx.filter((ctx) => ctx.somaDifal > 0);
      const { entryDate, entryOrigin, paidEarly } = resolveEntryFor(contributingDifal);
      const destinoDifal = routePaidEarlyDestination('difal', paidEarly, isSimplesCompany);
      const allDifal = nfesCtx.every((ctx) => ctx.allItemsDifal);
      const ratioDifal = allDifal ? 1 : Math.min(1, somaDifal / vTotalNfes);
      const vTotalCteDifal = allDifal ? cte.vTotalCte : roundCurrency(cte.vTotalCte * ratioDifal);

      if (vTotalCteDifal > 0) {
        const aDstDifal = resolveDestinationRate(
          context,
          {
            itemNumero: 1,
            ncm: '',
            cest: '',
            cfop: cte.cfop,
            descricao: '',
            descricaoConfiavel: false,
            vItem: vTotalCteDifal,
            vTotal: vTotalCteDifal,
            baseCalculo: vTotalCteDifal,
            ipiDespesas: 0,
            aOri: cte.aOri,
            vIcms: cte.vIcmsCte,
          },
          destinoDifal,
        ).aliquota;

        emitCteRow({
          context,
          cte,
          destination: destinoDifal,
          vTotal: vTotalCteDifal,
          baseCalculo: vTotalCteDifal,
          mva: 0,
          reducao: null,
          aDst: aDstDifal,
          aliqSimples: cte.fornecedorSimplesNacional ? 'S' : 'N',
          entryDate,
          entryOrigin,
          percentualRateio: Math.round((ratioDifal * 100 + Number.EPSILON) * 10000) / 10000,
          numerosNfeOrigem: numerosOrigem,
          mvaGrupo: null,
          mvaFonte: null,
          processed,
          rowsByDestination,
          fcpMetadados: buildFcpMetadata({
            aDstBase: aDstDifal,
            fcpAliquota: null,
            fcpOrigem: null,
            fcpDetalhe: null,
            fcpSeparado: false,
          }),
        });
        diagnostic?.event('info', 'calculo', 'CT-e incluído no DIFAL.', {
          numeroCte: cte.numeroCte,
          destino: destinoDifal,
          valorRateado: vTotalCteDifal,
        });
      }
    }
  }
}

