import type { ExtractedCTe, ExtractedItem, ExtractedNote } from './domain';
import { IBGE_UF_MAP } from './domain.ts';

function onlyDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function child(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  return Array.from(parent.children).find((node) => node.localName === name) ?? null;
}

function text(parent: Element | null | undefined, name: string): string {
  return child(parent, name)?.textContent?.trim() ?? '';
}

function number(parent: Element | null | undefined, name: string): number {
  const value = Number(text(parent, name).replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Alíquota de crédito de ICMS autorizada nas Informações Complementares
 * ("aliquota para credito de ICMS aproximadamente 3,59 %" -> 0.0359).
 * Só esta frase autoriza o crédito; a sentença "NAO GERA DIREITO A CREDITO..."
 * que costuma acompanhá-la é propositalmente ignorada. Espelha
 * app/services/extraction/inf_compl.py.
 */
export function extractCreditRateFromInfCpl(infCpl: string | null | undefined): number | null {
  if (!infCpl) return null;
  const normalized = infCpl.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const match = normalized.match(/aliquota\s+(?:para\s+)?credito\s+(?:de\s+)?icms\D{0,40}?(\d{1,3}(?:[.,]\d{1,4})?)\s*%/);
  if (!match) return null;
  const percent = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return Number((percent / 100).toFixed(6));
}

function normalizeIssueDate(value: string, docLabel = 'NF-e'): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`O XML da ${docLabel} não informa a data de emissão obrigatória.`);
  const datePart = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new Error(`Data de emissão inválida no XML: "${value}".`);
  }
  const timeMatch = trimmed.match(/T(\d{2}:\d{2}:\d{2})/);
  return timeMatch ? `${datePart}T${timeMatch[1]}` : `${datePart}T00:00:00`;
}

function findFirst(root: ParentNode, localName: string): Element | null {
  const nodes = 'querySelectorAll' in root ? Array.from(root.querySelectorAll('*')) : [];
  return nodes.find((node) => node.localName === localName) ?? null;
}

export function extractNfeNumberAndSeriesFromKey(chave: string): { numeroNota: string; serie: string } {
  const clean = onlyDigits(chave);
  if (clean.length !== 44) return { numeroNota: '', serie: '' };
  const serie = clean.slice(22, 25).replace(/^0+/, '') || '0';
  const numeroNota = clean.slice(25, 34).replace(/^0+/, '') || '0';
  return { numeroNota, serie };
}

export function parseXmlDocument(xmlText: string, filename: string, docLabel = 'NF-e'): XMLDocument {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`Arquivo XML de ${docLabel} inválido ou corrompido: ${filename}.`);
  }
  return doc;
}

export function isCteXmlDoc(doc: Document): boolean {
  return findFirst(doc, 'infCte') !== null;
}

const TOMA_TAG_MAP: Readonly<Record<string, string>> = {
  '0': 'rem',
  '1': 'exped',
  '2': 'receb',
  '3': 'dest',
};

export function parseCteXmlFromDoc(doc: XMLDocument, filename: string): ExtractedCTe {
  const infCte = findFirst(doc, 'infCte');
  if (!infCte) throw new Error(`Estrutura do XML sem <infCte>: ${filename}.`);

  let chaveAcesso = onlyDigits(infCte.getAttribute('Id') ?? '');
  if (chaveAcesso.length !== 44) {
    const chCte = onlyDigits(text(findFirst(doc, 'infProt'), 'chCTe'));
    if (chCte.length === 44) chaveAcesso = chCte;
  }

  const ide = child(infCte, 'ide');
  if (!ide) throw new Error(`Estrutura do XML do CT-e sem <ide>: ${filename}.`);

  const numeroCte = text(ide, 'nCT');
  const serie = text(ide, 'serie');
  const cfop = text(ide, 'CFOP');
  const ufInicio = text(ide, 'UFIni').toUpperCase();
  const ufFim = text(ide, 'UFFim').toUpperCase();
  const dataEmissao = normalizeIssueDate(text(ide, 'dhEmi') || text(ide, 'dEmi'), 'CT-e');

  let tomaCodigo = '';
  let cnpjTomador = '';
  const toma4 = child(ide, 'toma4') ?? child(ide, 'toma04');
  if (toma4) {
    tomaCodigo = text(toma4, 'toma') || '4';
    cnpjTomador = onlyDigits(text(toma4, 'CNPJ') || text(toma4, 'CPF'));
  } else {
    const toma3 = child(ide, 'toma3') ?? child(ide, 'toma03');
    tomaCodigo = toma3 ? text(toma3, 'toma') : text(ide, 'toma');
    const papelTag = TOMA_TAG_MAP[tomaCodigo];
    if (papelTag) {
      const papelElem = child(infCte, papelTag);
      cnpjTomador = onlyDigits(text(papelElem, 'CNPJ') || text(papelElem, 'CPF'));
    }
  }

  const emit = child(infCte, 'emit');
  const cnpjEmitente = onlyDigits(text(emit, 'CNPJ') || text(emit, 'CPF'));
  const nomeEmitente = text(emit, 'xNome');
  const crt = text(emit, 'CRT');
  const enderEmit = child(emit, 'enderEmit');
  let ufEmitente = text(enderEmit, 'UF').toUpperCase();
  if (!ufEmitente) {
    ufEmitente = IBGE_UF_MAP[text(ide, 'cUF')] || IBGE_UF_MAP[chaveAcesso.slice(0, 2)] || ufInicio || '';
  }

  const vPrest = child(infCte, 'vPrest');
  let vTotalCte = number(vPrest, 'vTPrest');
  if (vTotalCte <= 0) vTotalCte = number(vPrest, 'vRec');

  const imp = child(infCte, 'imp');
  const icms = child(imp, 'ICMS');
  let vBcCte = 0;
  let pIcms = 0;
  let vIcmsCte = 0;
  let isSimples = ['1', '2', '4'].includes(crt);
  if (icms) {
    for (const group of Array.from(icms.children)) {
      if (group.localName === 'ICMSSN' || text(group, 'indSN') === '1') {
        isSimples = true;
      }
      vBcCte = number(group, 'vBC') || number(group, 'vBCOutraUF');
      pIcms = number(group, 'pICMS') || number(group, 'pICMSOutraUF');
      vIcmsCte = number(group, 'vICMS') || number(group, 'vICMSOutraUF');
      break;
    }
  }

  const aOriHighlighted = pIcms > 0;
  const aOri = aOriHighlighted ? (pIcms > 1 ? pIcms / 100 : pIcms) : 0;

  const chavesNfe: string[] = [];
  const seenChaves = new Set<string>();
  for (const node of Array.from(infCte.querySelectorAll('*'))) {
    if (node.localName !== 'infNFe') continue;
    const chv = onlyDigits(text(node, 'chave'));
    if (chv.length === 44 && !seenChaves.has(chv)) {
      seenChaves.add(chv);
      chavesNfe.push(chv);
    }
  }

  return {
    filename,
    chaveAcesso,
    numeroCte,
    serie,
    cfop,
    cnpjEmitente,
    nomeEmitente,
    ufEmitente,
    ufInicio,
    ufFim,
    cnpjTomador,
    tomaCodigo,
    dataEmissao,
    dataEntrada: null,
    vTotalCte,
    vBcCte,
    aOri,
    aOriHighlighted,
    vIcmsCte,
    fornecedorSimplesNacional: isSimples,
    chavesNfe,
    rawMetadata: {
      crt,
      emit_nome: nomeEmitente,
      toma_codigo: tomaCodigo,
      qtd_nfes_vinculadas: chavesNfe.length,
    },
  };
}

export function parseCteXml(xmlText: string, filename: string): ExtractedCTe {
  const doc = parseXmlDocument(xmlText, filename, 'CT-e');
  return parseCteXmlFromDoc(doc, filename);
}

export function parseNfeXmlFromDoc(doc: XMLDocument, filename: string): ExtractedNote {
  const infNFe = findFirst(doc, 'infNFe');
  if (!infNFe) throw new Error(`Estrutura do XML sem <infNFe>: ${filename}.`);

  // Protocolo de autorização (protNFe/infProt), presente no nfeProc.
  const infProt = findFirst(doc, 'infProt');

  const rawId = infNFe.getAttribute('Id') ?? '';
  const chaveAcesso = onlyDigits(rawId);
  const ide = child(infNFe, 'ide');
  const emit = child(infNFe, 'emit');
  const dest = child(infNFe, 'dest');
  const enderEmit = child(emit, 'enderEmit');
  const enderDest = child(dest, 'enderDest');

  const numeroNota = text(ide, 'nNF');
  const serie = text(ide, 'serie');
  const dataEmissao = normalizeIssueDate(text(ide, 'dhEmi') || text(ide, 'dEmi'));

  let ufEmitente = text(enderEmit, 'UF').toUpperCase();
  if (!ufEmitente) {
    const cUf = text(ide, 'cUF') || chaveAcesso.slice(0, 2);
    ufEmitente = IBGE_UF_MAP[cUf] ?? '';
  }

  const total = child(infNFe, 'total');
  const icmsTot = child(total, 'ICMSTot');
  const vTotalNota = number(icmsTot, 'vNF');
  const vBcNota = number(icmsTot, 'vBC');
  const vIcmsNota = number(icmsTot, 'vICMS');
  const vDescNota = number(icmsTot, 'vDesc');
  const vStNota = number(icmsTot, 'vST');

  const aliqCreditoIcmsInfCompl = extractCreditRateFromInfCpl(text(child(infNFe, 'infAdic'), 'infCpl'));

  const itens: ExtractedItem[] = [];
  for (const det of Array.from(infNFe.children).filter((node) => node.localName === 'det')) {
    const prod = child(det, 'prod');
    const imposto = child(det, 'imposto');
    const ipi = child(imposto, 'IPI');
    const icms = child(imposto, 'ICMS');

    let vIpi = 0;
    if (ipi) {
      for (const group of Array.from(ipi.children)) {
        if (group.localName === 'IPITrib' || group.localName === 'IPINT') {
          vIpi = number(group, 'vIPI');
          break;
        }
      }
    }

    let baseCalculo = 0;
    let pIcms = 0;
    let pCredSN = 0;
    let csosn = '';
    let vIcms = 0;
    let vIcmsSt = 0;
    let origemMercadoria = '';
    let cstIcms = '';
    let pRedBC = 0;
    if (icms) {
      for (const group of Array.from(icms.children)) {
        origemMercadoria = text(group, 'orig');
        csosn = text(group, 'CSOSN');
        cstIcms = text(group, 'CST') || csosn;
        const bc = number(group, 'vBC');
        if (bc > 0) baseCalculo = bc;
        pRedBC = number(group, 'pRedBC');
        // pCredSN é crédito transferível declarado, não é a alíquota
        // interestadual pICMS. Mantê-los separados evita usar 2,5% como A.ORI.
        pIcms = number(group, 'pICMS');
        pCredSN = number(group, 'pCredSN');
        const vi = number(group, 'vICMS');
        if (vi > 0) vIcms = vi;
        const vst = number(group, 'vICMSST');
        if (vst > 0) vIcmsSt = vst;
        break;
      }
    }

    const vProd = number(prod, 'vProd');
    const vFrete = number(prod, 'vFrete');
    const vSeg = number(prod, 'vSeg');
    const vOutro = number(prod, 'vOutro');
    const vDesc = number(prod, 'vDesc');
    const vDespesas = vFrete + vSeg + vOutro;
    const ipiDespesas = vIpi;
    const vTotal = vProd + vDespesas + vIpi - vDesc;
    const baseCalculoXml = baseCalculo;
    const baseSemIpi = Math.max(0, vProd + vDespesas - vDesc);
    if (baseCalculo <= 0) {
      baseCalculo = Math.max(0, vTotal - vIpi);
    } else if (vDesc > 0 && baseCalculo > baseSemIpi) {
      baseCalculo = Math.max(0, Math.min(baseCalculo - vDesc, baseSemIpi));
    }

    const rawItem = det.getAttribute('nItem') ?? String(itens.length + 1);
    const parsedItem = Number.parseInt(rawItem, 10);
    const aOri = pIcms > 1 ? pIcms / 100 : pIcms;

    itens.push({
      itemNumero: Number.isFinite(parsedItem) ? parsedItem : itens.length + 1,
      ncm: onlyDigits(text(prod, 'NCM')),
      cest: onlyDigits(text(prod, 'CEST')),
      cfop: text(prod, 'CFOP'),
      descricao: text(prod, 'xProd'),
      descricaoConfiavel: true,
      vItem: vProd,
      vTotal,
      baseCalculo,
      baseCalculoXml,
      baseSemIpi,
      ipiDespesas,
      vIpi,
      vDesc,
      aOri,
      vIcms,
      pCredSN: pCredSN > 1 ? pCredSN / 100 : pCredSN,
      csosn,
      origemMercadoria,
      cstIcms,
      pRedBC,
      vIcmsSt: vIcmsSt > 0 ? vIcmsSt : 0,
    });
  }

  if (itens.length === 1 && vTotalNota > 0) {
    itens[0].vTotal = vTotalNota;
    const maxBaseLiquida = Math.max(0, vTotalNota - itens[0].ipiDespesas);
    if (vBcNota > 0) {
      if (vDescNota > 0 && vBcNota > maxBaseLiquida) {
        itens[0].baseCalculo = Math.max(0, Math.min(vBcNota - vDescNota, maxBaseLiquida));
      } else {
        itens[0].baseCalculo = vBcNota;
      }
    } else if (itens[0].baseCalculo <= 0) {
      itens[0].baseCalculo = maxBaseLiquida;
    }
    if ((itens[0].vIcmsSt ?? 0) <= 0 && vStNota > 0) {
      itens[0].vIcmsSt = vStNota;
    }
  }

  return {
    filename,
    chaveAcesso,
    numeroNota,
    serie,
    cnpjEmitente: onlyDigits(text(emit, 'CNPJ') || text(emit, 'CPF')),
    ufEmitente,
    cnpjDestinatario: onlyDigits(text(dest, 'CNPJ') || text(dest, 'CPF')),
    ufDestinatario: text(enderDest, 'UF').toUpperCase(),
    dataEmissao,
    dataEntrada: null,
    vTotalNota,
    vBcNota,
    vIcmsNota,
    vDescNota,
    vStNota: vStNota > 0 ? vStNota : 0,
    aliqCreditoIcmsInfCompl,
    cStatProtocolo: text(infProt, 'cStat') || null,
    protocoloAutorizacao: text(infProt, 'nProt') || null,
    origemExtracao: 'xml',
    rawMetadata: {
      qtd_itens: itens.length,
      // Evidência de ST obtida do XML, mesmo quando igual a zero.
      icms_st_xml: Math.max(vStNota, ...itens.map((item) => Number(item.vIcmsSt ?? 0))),
      crt: text(emit, 'CRT'),
      fornecedor_simples_nacional: ['1', '2', '4'].includes(text(emit, 'CRT')) || itens.some((item) => Boolean(item.csosn)),
      emit_nome: text(emit, 'xNome'),
    },
    itens,
  };
}

export function parseNfeXml(xmlText: string, filename: string): ExtractedNote {
  const doc = parseXmlDocument(xmlText, filename, 'NF-e');
  return parseNfeXmlFromDoc(doc, filename);
}
