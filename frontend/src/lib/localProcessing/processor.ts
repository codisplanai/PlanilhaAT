import type {
  LocalGeneratedArtifact,
  LocalOutputRow,
  LocalProcessingRequest,
  LocalProcessingResult,
} from '../../types/localProcessing';
import type {
  AvisoAvaliacao,
  ItemExcluido,
  NotaBonificacaoPendencia,
  NotaIgnorada,
  TipoPlanilha,
} from '../../types/solicitacao';
import type { CfopResolution, ExtractedItem, ExtractedNote, TaxRateResolution } from './domain';
import { calculateTax } from './calculations';
import {
  evaluatePartialMerchandiseExclusion,
  normalizeDescription,
  resolveCfop,
  resolveDestinationRate,
  resolveMva,
  shouldExcludeEqualRates,
} from './rules';
import {
  isUsoConsumoAtivo,
  loadLocalFiscalSources,
  matchEntryCfop,
  matchEntryDate,
} from './sources';
import { fillTemplateLocally } from './xlsx';

const BONUS_SUFFIXES = new Set(['910', '911', '949']);
const PARTIAL_DESTINATIONS = new Set<TipoPlanilha>([
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
]);
const EARLY_DESTINATIONS = new Set<TipoPlanilha>([
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_antecipado_simples',
]);

function cleanDigits(value: string): string {
  return value.replace(/\D/g, '');
}

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

function withinPeriod(note: ExtractedNote, start: string, end: string): boolean {
  const date = note.dataEmissao.slice(0, 10);
  return date >= start && date <= end;
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

function bonusPreAnalysis(notes: ExtractedNote[], start: string, end: string, companyUf: string): NotaBonificacaoPendencia[] {
  const pending: NotaBonificacaoPendencia[] = [];
  for (const note of notes) {
    if (note.ufEmitente && companyUf && note.ufEmitente.toUpperCase() === companyUf.toUpperCase()) continue;
    if (!withinPeriod(note, start, end)) continue;
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

interface Group {
  destination: TipoPlanilha;
  aOri: number;
  aDst: number;
  items: ExtractedItem[];
  rateResolutions: TaxRateResolution[];
  cfopResolutions: CfopResolution[];
  aOriLimited: boolean;
  aOriOriginal: number;
}

function groupKey(destination: TipoPlanilha, aOri: number, aDst: number, item: ExtractedItem): string {
  const ncm = destination === 'antecipacao_tributaria' ? item.ncm : '';
  const cest = destination === 'antecipacao_tributaria' ? item.cest : '';
  return JSON.stringify([destination, aOri, aDst, ncm, cest]);
}

function sortRows(rows: LocalOutputRow[]): void {
  rows.sort((a, b) => {
    const aDate = a.data_entrada || a.data_emissao;
    const bDate = b.data_entrada || b.data_emissao;
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    if (a.data_emissao !== b.data_emissao) return a.data_emissao.localeCompare(b.data_emissao);
    const aNum = Number(cleanDigits(a.numero_nota)) || 0;
    const bNum = Number(cleanDigits(b.numero_nota)) || 0;
    return aNum - bNum || a.item_numero - b.item_numero;
  });
}

export async function processFiscalLocally(
  request: LocalProcessingRequest,
  templateBytes: Map<number, ArrayBuffer>,
): Promise<LocalProcessingResult> {
  const { context, periodoInicio, periodoFim, solicitacaoId } = request;
  if (!validateCnpj(context.empresa.cnpj)) {
    throw new Error(`CNPJ da empresa selecionada "${context.empresa.cnpj}" é inválido.`);
  }

  const sources = await loadLocalFiscalSources(request.input, periodoInicio, periodoFim);
  const pending = bonusPreAnalysis(sources.notes, periodoInicio, periodoFim, context.empresa.uf);
  if (pending.length > 0 && !request.bonusDecisions) {
    return {
      preAnalysis: { requer_decisao: true, notas_bonificacao: pending },
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
  const warnings: AvisoAvaliacao[] = [];
  const missingCfops: Record<string, number> = {};
  const rowsByDestination: Partial<Record<TipoPlanilha, LocalOutputRow[]>> = {};
  const processed: LocalProcessingResult['notasProcessadas'] = [];

  const hasEntrySource = Boolean(request.input.spedFile) || sources.entryRecords.length > 0;

  for (const note of sources.notes) {
    if (cleanDigits(note.cnpjDestinatario) !== cleanDigits(context.empresa.cnpj)) {
      throw new Error(
        `NF-e ${note.numeroNota} possui CNPJ destinatário ${note.cnpjDestinatario}, diferente da empresa selecionada.`,
      );
    }

    if (note.ufEmitente && context.empresa.uf && note.ufEmitente.toUpperCase() === context.empresa.uf.toUpperCase()) {
      ignored.push(ignoredNote(
        note,
        `Operação interna estadual desconsiderada: UF do fornecedor (${note.ufEmitente}) é igual à UF da empresa (${context.empresa.uf}).`,
      ));
      continue;
    }

    if (!withinPeriod(note, periodoInicio, periodoFim)) {
      ignored.push(ignoredNote(
        note,
        `Data de emissão fora do período informado (${periodoInicio} a ${periodoFim}).`,
      ));
      continue;
    }

    let entryDate = matchEntryDate(note, sources.entryRecords);
    let entryOrigin: string | null = entryDate ? 'planilha_sistema_contabil' : null;
    if (!entryDate && note.origemExtracao === 'sped' && note.dataEntrada) {
      entryDate = note.dataEntrada;
      entryOrigin = 'sped_fiscal';
    }

    const confirmedEntry = note.origemExtracao === 'sped' || Boolean(entryDate);
    const paidEarly = hasEntrySource && !confirmedEntry;
    const auxiliaryCfop = note.origemExtracao !== 'sped' ? matchEntryCfop(note, sources.entryRecords) : null;

    const groups = new Map<string, Group>();
    let classifiedItems = 0;

    for (const originalItem of note.itens) {
      const item = { ...originalItem };
      if (auxiliaryCfop && isUsoConsumoAtivo(auxiliaryCfop)) item.cfop = auxiliaryCfop;

      const cfopResolution = resolveCfop(context, item);
      let destination = cfopResolution.destino as TipoPlanilha | null;

      if (isUsoConsumoAtivo(item.cfop)) destination = 'difal';

      const suffix = cleanDigits(item.cfop).slice(-3);
      if (BONUS_SUFFIXES.has(suffix) && request.bonusDecisions) {
        const decision = request.bonusDecisions[note.chaveAcesso]
          ?? request.bonusDecisions[String(note.numeroNota)];
        if (typeof decision === 'boolean') destination = decision ? 'antecipacao_parcial' : 'difal';
      }

      if (!destination) {
        missingCfops[suffix || '????'] = (missingCfops[suffix || '????'] ?? 0) + 1;
        continue;
      }

      if (cfopResolution.reclassificado) item.cfop = cfopResolution.cfopEfetivo;
      if (destination === 'antecipacao_parcial' && paidEarly) destination = 'antecipacao_parcial_antecipado';
      if (context.empresa.optante_simples_nacional) {
        if (destination === 'antecipacao_parcial') destination = 'antecipacao_parcial_simples';
        if (destination === 'antecipacao_parcial_antecipado') destination = 'antecipacao_parcial_antecipado_simples';
      }

      if (PARTIAL_DESTINATIONS.has(destination)) {
        if (!item.descricaoConfiavel) {
          warnings.push({
            numero_nota: note.numeroNota,
            serie: note.serie,
            item_numero: item.itemNumero,
            arquivo: note.filename,
            aviso: 'Descrição sintética/não confiável: regra de exclusão por mercadoria não avaliada.',
          });
        } else if (!normalizeDescription(item.descricao)) {
          warnings.push({
            numero_nota: note.numeroNota,
            serie: note.serie,
            item_numero: item.itemNumero,
            arquivo: note.filename,
            aviso: 'Descrição do produto ausente: regra de exclusão por mercadoria não avaliada.',
          });
        } else if (!item.ncm || item.ncm === '00000000' || item.ncm.length < 8) {
          warnings.push({
            numero_nota: note.numeroNota,
            serie: note.serie,
            item_numero: item.itemNumero,
            arquivo: note.filename,
            aviso: `NCM ausente ou genérico ("${item.ncm}"): regra de exclusão por mercadoria não avaliada.`,
          });
        }

        const merchandise = evaluatePartialMerchandiseExclusion(context, destination, item);
        if (merchandise.excluded) {
          const base = item.baseCalculo <= 0 ? item.vTotal - item.ipiDespesas : item.baseCalculo;
          excluded.push({
            chave_acesso: note.chaveAcesso,
            numero_nota: note.numeroNota,
            serie: note.serie,
            item_numero: item.itemNumero,
            arquivo: note.filename,
            destino: destination,
            ncm: item.ncm,
            descricao: item.descricao,
            descricao_confiavel: item.descricaoConfiavel,
            motivo: merchandise.motivo || 'Mercadoria excluída',
            tipo_exclusao: 'mercadoria',
            regras_aplicadas: (merchandise.regras ?? []) as never[],
            v_total: item.vTotal,
            base_calculo: base,
            ipi_despesas: item.ipiDespesas,
            a_ori: item.aOri,
          });
          continue;
        }
      }

      const rate = resolveDestinationRate(context, item);
      let aOri = item.aOri;
      const originalAOri = aOri;
      const limitOrigin = context.perfil.configuracoes_extras.limitar_a_ori_reducoes === true;
      const reducedOrAgreement = ['reducao_produto:', 'excecao:', 'termo_acordo:']
        .some((prefix) => rate.origem.startsWith(prefix));
      let aOriLimited = false;
      if (limitOrigin && reducedOrAgreement && aOri > 0.10) {
        aOri = 0.10;
        aOriLimited = true;
      }

      if (PARTIAL_DESTINATIONS.has(destination)) {
        const numeric = shouldExcludeEqualRates(context, destination, item, aOri, rate.aliquota);
        if (numeric.excluded) {
          const base = item.baseCalculo <= 0 ? item.vTotal - item.ipiDespesas : item.baseCalculo;
          excluded.push({
            chave_acesso: note.chaveAcesso,
            numero_nota: note.numeroNota,
            serie: note.serie,
            item_numero: item.itemNumero,
            arquivo: note.filename,
            destino: destination,
            ncm: item.ncm,
            descricao: item.descricao,
            descricao_confiavel: item.descricaoConfiavel,
            motivo: 'Alíquotas iguais com valor devido zero ou negativo',
            tipo_exclusao: 'aliquotas_iguais',
            regras_aplicadas: [],
            v_total: item.vTotal,
            base_calculo: base,
            ipi_despesas: item.ipiDespesas,
            a_ori: aOri,
            a_dst: rate.aliquota,
            debito: numeric.debito,
            credito: numeric.credito,
            valor_devido: numeric.valorDevido,
          });
          continue;
        }
      }

      const key = groupKey(destination, aOri, rate.aliquota, item);
      const group = groups.get(key) ?? {
        destination,
        aOri,
        aDst: rate.aliquota,
        items: [],
        rateResolutions: [],
        cfopResolutions: [],
        aOriLimited: false,
        aOriOriginal: originalAOri,
      };
      group.items.push(item);
      group.rateResolutions.push(rate);
      group.cfopResolutions.push(cfopResolution);
      group.aOriLimited ||= aOriLimited;
      groups.set(key, group);
      classifiedItems += 1;
    }

    if (groups.size === 0) continue;

    const splitByDestination = new Map<TipoPlanilha, number>();
    for (const group of groups.values()) {
      const splitIndex = splitByDestination.get(group.destination) ?? 1;
      const useNoteTotal = groups.size === 1 && classifiedItems === note.itens.length && note.vTotalNota > 0;

      let vTotal = useNoteTotal ? note.vTotalNota : group.items.reduce((sum, item) => sum + item.vTotal, 0);
      let base = useNoteTotal && note.vBcNota > 0
        ? note.vBcNota
        : group.items.reduce((sum, item) => sum + item.baseCalculo, 0);
      let ipi = group.items.reduce((sum, item) => sum + item.ipiDespesas, 0);

      if (base <= 0) base = vTotal - ipi;
      else if (base > 0 && vTotal > base && ipi === 0) ipi = vTotal - base;

      if (vTotal <= 0) {
        ignored.push(ignoredNote(note, `Valor total zerado ou sem valor comercial (R$ ${vTotal.toFixed(2)}).`));
        continue;
      }
      if (base < 0 || group.aOri < 0 || group.aOri > 1 || group.aDst < 0 || group.aDst > 1) {
        throw new Error(`NF-e ${note.numeroNota}: valores fiscais fora da faixa válida.`);
      }

      const first = group.items[0];
      const ncm = first?.ncm ?? '';
      const cfop = first?.cfop ?? '';
      const description = group.items.length === 1
        ? first?.descricao ?? ''
        : `NF-e ${note.numeroNota} (${group.items.length} itens)`;
      const mva = group.destination === 'antecipacao_tributaria'
        ? resolveMva(context, ncm, group.aOri, first?.cest)
        : 0;
      const crt = String(note.rawMetadata.crt ?? '').trim();
      const aliqSimples = group.destination === 'difal' && ['1', '2'].includes(crt) ? 'S' : 'N';

      const calculation = calculateTax(group.destination, {
        vTotal,
        baseCalculo: base,
        ipiDespesas: ipi,
        aOri: group.aOri,
        aDst: group.aDst,
        mva,
        aliqSimples,
        isSimples: Boolean(context.empresa.optante_simples_nacional),
      });

      const effectiveEntryDate = EARLY_DESTINATIONS.has(group.destination) ? null : entryDate;
      const effectiveEntryOrigin = EARLY_DESTINATIONS.has(group.destination) ? null : entryOrigin;
      const rateOrigins = [...new Set(group.rateResolutions.map((item) => item.origem))].sort();
      const rateDetails = [...new Set(group.rateResolutions.map((item) => item.detalhe))].sort();
      const cfopDetails = [...new Set(group.cfopResolutions.map((item) => item.motivo).filter(Boolean))].sort();

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
        origem_data_entrada: effectiveEntryOrigin as never,
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
        metadados_extras: {
          desdobramento: groups.size > 1,
          subitem_index: splitIndex,
          total_subitens_destino: group.items.length,
          mva: String(mva),
          aliq_simples: aliqSimples,
          origem_a_dst: rateOrigins,
          detalhe_a_dst: rateDetails.join('; '),
          cfop_reclassificado: group.cfopResolutions.some((item) => item.reclassificado),
          detalhe_cfop: cfopDetails.join('; '),
          a_ori_limitada: group.aOriLimited,
          a_ori_original: String(group.aOriOriginal),
          ...calculation.detalhes,
        } as never,
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
        reducao: null,
        red: '',
        aliq_simples: aliqSimples,
        a_ori: group.aOri,
        a_dst: group.aDst,
        debito: calculation.debito,
        credito: calculation.credito,
        valor_devido: calculation.valorDevido,
      };
      (rowsByDestination[group.destination] ??= []).push(row);
      splitByDestination.set(group.destination, splitIndex + 1);
    }
  }

  for (const rows of Object.values(rowsByDestination)) if (rows) sortRows(rows);

  const totalRows = Object.values(rowsByDestination).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
  let message: string | null = null;
  if (totalRows === 0) {
    if (Object.keys(missingCfops).length > 0) {
      throw new Error(
        `Nenhum item correspondeu a um CFOP com regra de roteamento cadastrada (${Object.keys(missingCfops).sort().join(', ')}).`,
      );
    }
    if (excluded.length > 0) message = 'Nenhum item a recolher na Parcial';
    else if (ignored.length > 0) {
      throw new Error('Nenhuma NF-e válida para apuração interestadual foi encontrada no período informado.');
    } else {
      throw new Error('Nenhuma nota fiscal pôde ser processada localmente.');
    }
  }

  const artifacts: LocalGeneratedArtifact[] = [];
  if (totalRows > 0) {
    const month = Number(periodoInicio.slice(5, 7));
    const year = Number(periodoInicio.slice(0, 4));
    const competencia = `${String(month).padStart(2, '0')}/${year}`;
    const ie = context.empresa.inscricao_estadual || sources.spedCompanyInfo.ie || '';

    for (const [destination, rows] of Object.entries(rowsByDestination) as Array<[TipoPlanilha, LocalOutputRow[]]>) {
      if (!rows?.length) continue;
      const template = context.templates_ativos.find((item) => item.tipo === destination);
      if (!template) continue;
      const bytes = templateBytes.get(template.id);
      if (!bytes) throw new Error(`Template ativo não carregado para ${destination}.`);

      const output = await fillTemplateLocally(bytes, template, rows, {
        razaoSocial: context.empresa.razao_social,
        ie,
        competencia,
        month,
        year,
      });
      artifacts.push({
        tipo: destination,
        templateId: template.id,
        filename: `planilha_${context.empresa.cnpj}_${destination}_${solicitacaoId.slice(0, 8)}.xlsx`,
        bytes: output,
        totalNotas: rows.length,
        totalValorDevido: rows.reduce((sum, row) => sum + row.valor_devido, 0),
      });
    }

    const destinationsWithoutTemplate = Object.entries(rowsByDestination)
      .filter(([destination, rows]) => rows?.length && !context.templates_ativos.some((item) => item.tipo === destination))
      .map(([destination]) => destination);
    if (artifacts.length === 0 && destinationsWithoutTemplate.length > 0) {
      throw new Error(
        `Nenhuma planilha pôde ser gerada porque não há template ativo para: ${destinationsWithoutTemplate.join(', ')}.`,
      );
    }
  }

  return {
    preAnalysis: { requer_decisao: false, notas_bonificacao: pending },
    notasProcessadas: processed,
    notasIgnoradas: ignored,
    itensExcluidos: excluded,
    avisosAvaliacao: warnings,
    cfopsSemRegra: missingCfops,
    rowsByDestination,
    artifacts,
    mensagem: message,
  };
}
