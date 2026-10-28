import type { ExtractedItem, ExtractedNote } from './domain';

const IBGE_UF_MAP: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
  '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

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

function normalizeIssueDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('O XML da NF-e não informa a data de emissão obrigatória.');
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

export function parseNfeXml(xmlText: string, filename: string): ExtractedNote {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error(`Arquivo XML de NF-e inválido ou corrompido: ${filename}.`);
  }

  const infNFe = findFirst(doc, 'infNFe');
  if (!infNFe) throw new Error(`Estrutura do XML sem <infNFe>: ${filename}.`);

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
    origemExtracao: 'xml',
    rawMetadata: {
      qtd_itens: itens.length,
      crt: text(emit, 'CRT'),
      fornecedor_simples_nacional: ['1', '2', '4'].includes(text(emit, 'CRT')) || itens.some((item) => Boolean(item.csosn)),
      emit_nome: text(emit, 'xNome'),
    },
    itens,
  };
}
