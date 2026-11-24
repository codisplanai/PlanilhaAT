import { supplierUsageMode, supplierUsageRule, usageDecisionKey } from './supplierUsage.ts';
import type { UsoConsumoPending } from '../../types/localProcessing';
import type { LocalProcessingRequest } from '../../types/localProcessing';
import type {
  Convenio5291Decision,
  Convenio5291Pendencia,
  CteSemNfePendencia,
  NotaBonificacaoPendencia,
  TipoPlanilha,
} from '../../types/solicitacao';
import {
  BONUS_SUFFIXES,
  PARTIAL_DESTINATIONS,
  SUL_SUDESTE_EXCETO_ES,
  normalizeDescription,
} from './domain.ts';
import type { EntrySheetRecord, ExtractedCTe, ExtractedNote } from './domain.ts';
import { extractNfeNumberAndSeriesFromKey } from './xml.ts';
import { classifyConvenio5291, convenioDecisionKey, fullIcmsCode } from './convenio5291.ts';
import { classifyAnexoII } from './convenio5291Agricola.ts';
import { effectiveConvenio5291PartialConfig } from './convenio5291Global.ts';
import {
  acceptsRetroactiveDifal,
  getRevendaAntecipacaoConfig,
  isDifalDestination,
  isIndustria,
  redirectRevendaToAntecipacaoTributaria,
  resolveCfop,
} from './rules.ts';
import { isUsoConsumoAtivo, matchEntryCfop } from './sources.ts';

const CONVENIO_52_91_DESTINATIONS: ReadonlySet<TipoPlanilha> = new Set<TipoPlanilha>([
  ...PARTIAL_DESTINATIONS,
  'difal',
  'difal_antecipado',
]);

export function cleanDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function withinPeriod(note: ExtractedNote, start: string, end: string): boolean {
  const date = note.dataEmissao.slice(0, 10);
  return date >= start && date <= end;
}

export function isOwnEmissionNote(note: ExtractedNote, companyCnpj?: string): boolean {
  const cleanEmitente = cleanDigits(note.cnpjEmitente);
  const cleanEmpresa = cleanDigits(companyCnpj ?? '');
  return (Boolean(cleanEmitente && cleanEmpresa) && cleanEmitente === cleanEmpresa)
    || note.rawMetadata?.ind_emit === '0';
}

export function isSameUfNote(note: { ufEmitente: string }, companyUf: string): boolean {
  return Boolean(note.ufEmitente && companyUf && note.ufEmitente.toUpperCase() === companyUf.toUpperCase());
}

export function isNfeAvailableForCte(note: ExtractedNote): boolean {
  const chave = cleanDigits(note.chaveAcesso);
  if (chave.length !== 44) return false;
  if (note.origemExtracao === 'xml') return true;
  return note.itens.length > 0 && note.itens.some((item) => Boolean(item.cfop?.trim()));
}

export function eligibleCteNfeKeys(
  ctes: ExtractedCTe[],
  start: string,
  end: string,
  companyCnpj?: string,
  companyUf = '',
): Set<string> {
  const cleanEmpresa = cleanDigits(companyCnpj ?? '');
  if (!cleanEmpresa) return new Set();
  const keys = new Set<string>();
  for (const cte of ctes) {
    if (cleanDigits(cte.cnpjTomador) !== cleanEmpresa) continue;
    if (isSameUfNote(cte, companyUf)) continue;
    const date = cte.dataEmissao.slice(0, 10);
    if (date >= start && date <= end) {
      for (const chv of cte.chavesNfe) keys.add(chv);
    }
  }
  return keys;
}

export function cteMissingNfePreAnalysis(
  ctes: ExtractedCTe[],
  notes: ExtractedNote[],
  start: string,
  end: string,
  companyCnpj?: string,
  companyUf = '',
): CteSemNfePendencia[] {
  const cleanEmpresa = cleanDigits(companyCnpj ?? '');
  if (!cleanEmpresa || ctes.length === 0) return [];

  const availableChaves = new Set(
    notes.filter(isNfeAvailableForCte).map((note) => cleanDigits(note.chaveAcesso)),
  );

  const pending: CteSemNfePendencia[] = [];
  for (const cte of ctes) {
    if (cleanDigits(cte.cnpjTomador) !== cleanEmpresa) continue;
    if (isSameUfNote(cte, companyUf)) continue;
    const date = cte.dataEmissao.slice(0, 10);
    if (date < start || date > end) continue;
    const missing = cte.chavesNfe.filter((chv) => !availableChaves.has(chv));
    if (missing.length === 0) continue;

    pending.push({
      cte_chave_acesso: cte.chaveAcesso,
      cte_numero: cte.numeroCte,
      cte_serie: cte.serie,
      cnpj_emitente: cte.cnpjEmitente,
      nome_emitente: cte.nomeEmitente,
      valor_total: cte.vTotalCte,
      nfes_faltantes: missing.map((chv) => {
        const { numeroNota, serie } = extractNfeNumberAndSeriesFromKey(chv);
        return {
          chave_acesso: chv,
          numero_nota: numeroNota,
          serie,
        };
      }),
    });
  }
  return pending;
}

export function usoConsumoPreAnalysis(
  notes: ExtractedNote[], start: string, end: string,
  context: LocalProcessingRequest['context'], referencedKeys: ReadonlySet<string>,
  decisions?: Record<string, boolean>,
): UsoConsumoPending[] {
  const pending: UsoConsumoPending[] = [];
  for (const note of notes) {
    const rule = supplierUsageRule(note, context.empresa);
    if (rule?.modo !== 'confirmacao' || note.itens.length === 0) continue;
    if (!withinPeriod(note, start, end)
      && !acceptsRetroactiveDifal(note, start, Boolean(context.empresa.optante_simples_nacional))
      && !referencedKeys.has(cleanDigits(note.chaveAcesso))) continue;
    const key = usageDecisionKey(note);
    if (typeof decisions?.[key] === 'boolean') continue;
    pending.push({ key, chaveAcesso: note.chaveAcesso, numeroNota: note.numeroNota, serie: note.serie,
      cnpj: note.cnpjEmitente, fornecedor: rule.nome || String(note.rawMetadata.emit_nome ?? ''),
      quantidadeItens: note.itens.length, valorTotal: note.vTotalNota });
  }
  return pending;
}

export function bonusPreAnalysis(
  notes: ExtractedNote[],
  start: string,
  end: string,
  companyUf: string,
  companyCnpj?: string,
  isSimples = false,
  referencedNfeKeys?: ReadonlySet<string>,
): NotaBonificacaoPendencia[] {
  const pending: NotaBonificacaoPendencia[] = [];
  for (const note of notes) {
    if (isOwnEmissionNote(note, companyCnpj) || isSameUfNote(note, companyUf)) continue;
    const referenced = Boolean(referencedNfeKeys?.has(cleanDigits(note.chaveAcesso)));
    if (!withinPeriod(note, start, end) && !acceptsRetroactiveDifal(note, start, isSimples) && !referenced) continue;
    const bonus = note.itens.filter((item) => BONUS_SUFFIXES.has(cleanDigits(item.cfop).slice(-3)));
    if (bonus.length === 0) continue;
    const total = bonus.reduce((sum, item) => sum + item.vTotal, 0);
    const hasCredit = note.vIcmsNota > 0 || bonus.some((item) => item.vIcms > 0 || (item.baseCalculo > 0 && item.aOri > 0));
    pending.push({
      chave_acesso: note.chaveAcesso,
      numero_nota: note.numeroNota,
      serie: note.serie,
      cnpj_emitente: note.cnpjEmitente,
      nome_emitente: String(note.rawMetadata.emit_nome ?? ''),
      cfops: [...new Set(bonus.map((item) => item.cfop).filter(Boolean))].sort(),
      valor_total: total,
      tem_credito: hasCredit,
      sugestao_revenda: hasCredit,
      motivo_sugestao: hasCredit
        ? (note.vIcmsNota > 0
          ? `Crédito de ICMS de R$ ${note.vIcmsNota.toFixed(2)} identificado no documento fiscal`
          : 'Destaque de crédito de ICMS identificado no item')
        : 'Sem destaque de crédito de ICMS',
    });
  }
  return pending;
}

export function convenio5291PreAnalysis(
  notes: ExtractedNote[],
  start: string,
  end: string,
  companyUf: string,
  context: LocalProcessingRequest['context'],
  entryRecords: EntrySheetRecord[],
  bonusDecisions: Record<string, boolean> | undefined,
  decisions: Record<string, Convenio5291Decision> | undefined,
  usageDecisions?: Record<string, boolean>,
): Convenio5291Pendencia[] {
  const savedIndustrialConfig = context.perfil.configuracoes_extras.convenio_icms_52_91_anexo_i;
  const config = effectiveConvenio5291PartialConfig(savedIndustrialConfig);
  const agricolaConfig = effectiveConvenio5291PartialConfig(
    context.perfil.configuracoes_extras.convenio_icms_52_91_anexo_ii,
  );
  if (companyUf.toUpperCase() !== 'BA') return [];

  const revendaConfig = getRevendaAntecipacaoConfig(context);
  const industryCompany = isIndustria(context);
  const pending: Convenio5291Pendencia[] = [];

  for (const note of notes) {
    if (isOwnEmissionNote(note, context.empresa.cnpj) || isSameUfNote(note, companyUf)) continue;
    const retroactive = !withinPeriod(note, start, end)
      && acceptsRetroactiveDifal(note, start, Boolean(context.empresa.optante_simples_nacional));
    if (!withinPeriod(note, start, end) && !retroactive) continue;
    const forceUsage = Boolean(supplierUsageMode(note, context.empresa, usageDecisions));
    const auxiliaryCfop = note.origemExtracao !== 'sped' ? matchEntryCfop(note, entryRecords) : null;

    for (const originalItem of note.itens) {
      const item = { ...originalItem };
      if (auxiliaryCfop && isUsoConsumoAtivo(auxiliaryCfop)) item.cfop = auxiliaryCfop;

      const cfopResolution = resolveCfop(context, item);
      let destination = cfopResolution.destino as TipoPlanilha | null;
      if (forceUsage || isUsoConsumoAtivo(item.cfop)) destination = 'difal';

      const suffix = cleanDigits(item.cfop).slice(-3);
      if (!forceUsage && BONUS_SUFFIXES.has(suffix) && bonusDecisions) {
        const decision = bonusDecisions[note.chaveAcesso] ?? bonusDecisions[String(note.numeroNota)];
        if (decision === true && industryCompany) continue;
        if (typeof decision === 'boolean') destination = decision ? 'antecipacao_parcial' : 'difal';
      }
      if (!destination) continue;

      if (cfopResolution.reclassificado) item.cfop = cfopResolution.cfopEfetivo;
      destination = redirectRevendaToAntecipacaoTributaria(revendaConfig, destination);
      if (retroactive && destination !== 'difal') continue;
      // Indústria: itens fora da DIFAL serão excluídos, a decisão não teria efeito.
      if (industryCompany && !isDifalDestination(destination)) continue;
      if (!CONVENIO_52_91_DESTINATIONS.has(destination)) continue;
      // O Anexo I é global somente na Parcial; o DIFAL conserva o perfil
      // anterior à ativação (sem mudança retroativa da sua regra fiscal).
      const industrialConfig = PARTIAL_DESTINATIONS.has(destination)
        ? config : savedIndustrialConfig;

      // A prioridade agrícola aplica-se EXCLUSIVAMENTE à Parcial; DIFAL mantém
      // integralmente o tratamento industrial anterior.
      const agricola = PARTIAL_DESTINATIONS.has(destination)
        ? classifyAnexoII(agricolaConfig, note, item, companyUf)
        : null;
      const anexo = agricola && agricola.status !== 'fora_catalogo' ? 'II' : 'I';
      const classification = anexo === 'II'
        ? agricola!
        : classifyConvenio5291(industrialConfig, note, item, companyUf);
      if (classification.status !== 'revisar') continue;

      const decisionKey = convenioDecisionKey(note, item);
      if (typeof decisions?.[decisionKey] === 'boolean' || decisions?.[decisionKey] === 'anexo_i') continue;

      const alternativeIndustrial = anexo === 'II' && Boolean(industrialConfig?.enabled)
        && !['fora_catalogo', 'nao_aplicar'].includes(classifyConvenio5291(industrialConfig, note, item, companyUf).status);
      pending.push({
        anexo,
        alternativa_anexo_i: alternativeIndustrial,
        decision_key: decisionKey,
        chave_acesso: note.chaveAcesso,
        numero_nota: note.numeroNota,
        serie: note.serie || null,
        item_numero: item.itemNumero,
        fornecedor: String(note.rawMetadata.emit_nome ?? ''),
        cnpj_emitente: note.cnpjEmitente,
        uf_origem: note.ufEmitente,
        ncm: item.ncm,
        descricao: item.descricao,
        descricao_normalizada: normalizeDescription(item.descricao),
        cst: fullIcmsCode(item),
        p_icms: item.aOri,
        carga_efetiva_xml: Number(item.vIcms ?? 0) > 0 && Number(item.baseSemIpi ?? 0) > 0
          ? Number(item.vIcms) / Number(item.baseSemIpi)
          : null,
        carga_origem_convenio: anexo === 'II'
          ? (classification.operacaoQuatroPorCento ? 0.04
            : SUL_SUDESTE_EXCETO_ES.has(note.ufEmitente.toUpperCase()) ? 0.041 : 0.07)
          : null,
        carga_interna_convenio: anexo === 'II' ? 0.056 : null,
        p_red_bc: Number(item.pRedBC ?? 0) > 1
          ? Number(item.pRedBC ?? 0) / 100
          : Number(item.pRedBC ?? 0),
        v_bc_xml: Number(item.baseCalculoXml ?? item.baseCalculo),
        base_sem_ipi: Number(item.baseSemIpi ?? (item.vTotal - Number(item.vIpi ?? 0))),
        motivo: classification.motivo,
        item_legal: classification.itemLegal ?? null,
        descricao_legal: classification.descricaoLegal ?? null,
        cst20: classification.cst20,
        reducao_destacada: classification.reducaoDestacada,
        operacao_quatro_por_cento: classification.operacaoQuatroPorCento,
        sugestao_aplicar: classification.sugestaoAplicar,
      });
    }
  }

  return pending;
}

