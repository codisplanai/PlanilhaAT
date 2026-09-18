import type { ExtractedItem, ExtractedNote } from './domain';

const IBGE_UF_MAP: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
  '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR',
  '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

function digits(value: string | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function decimal(value: string | undefined): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

function parseSpedDate(value: string | undefined): string | null {
  const clean = digits(value);
  if (clean.length !== 8) return null;
  const day = clean.slice(0, 2);
  const month = clean.slice(2, 4);
  const year = clean.slice(4, 8);
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : iso;
}

interface Participant {
  cnpj: string;
  nome: string;
  uf: string;
}

interface ItemRegistry {
  ncm: string;
  cest: string;
  descricao: string;
}

interface C100State {
  codPart: string;
  serie: string;
  numeroNota: string;
  chaveAcesso: string;
  dataEmissao: string;
  dataEntrada: string | null;
  vTotalNota: number;
  vBcNota: number;
  vIcmsNota: number;
  vIpiNota: number;
  vDespesasNota: number;
}

interface C190State {
  cfop: string;
  aOri: number;
  vOpr: number;
  baseCalculo: number;
  vIcms: number;
  vIpi: number;
}

export interface SpedParseResult {
  notes: ExtractedNote[];
  companyInfo: {
    nome: string;
    cnpj: string;
    uf: string;
    ie: string;
  };
}

export function parseSped(text: string, filename: string): SpedParseResult {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) throw new Error('O arquivo SPED Fiscal fornecido está vazio.');

  let destCnpj = '';
  let destUf = '';
  let destIe = '';
  let destNome = '';
  const participants = new Map<string, Participant>();
  const itemRegistry = new Map<string, ItemRegistry>();
  const notes: ExtractedNote[] = [];

  let current: C100State | null = null;
  let currentItems: ExtractedItem[] = [];
  let currentC190: C190State[] = [];

  const finalize = () => {
    if (!current) return;

    if (currentItems.length === 0 && currentC190.length > 0) {
      currentItems = currentC190.map((row, index) => {
        const aOri = row.aOri > 1 ? row.aOri / 100 : row.aOri;
        return {
          itemNumero: index + 1,
          ncm: '00000000',
          cest: '',
          cfop: row.cfop,
          descricao: `Item Analítico C190 #${index + 1} (CFOP ${row.cfop})`,
          descricaoConfiavel: false,
          vItem: row.vOpr,
          vTotal: row.vOpr + row.vIpi,
          baseCalculo: row.baseCalculo,
          ipiDespesas: row.vIpi,
          aOri,
          vIcms: row.vIcms,
        };
      });
    }

    if (currentItems.length === 0) {
      currentItems = [{
        itemNumero: 1,
        ncm: '00000000',
        cest: '',
        cfop: '',
        descricao: `NF-e ${current.numeroNota} (Consolidado SPED)`,
        descricaoConfiavel: false,
        vItem: current.vTotalNota,
        vTotal: current.vTotalNota,
        baseCalculo: current.vBcNota,
        ipiDespesas: current.vIpiNota + current.vDespesasNota,
        aOri: 0,
        vIcms: current.vIcmsNota,
      }];
    }

    const participant = participants.get(current.codPart);
    let ufEmitente = participant?.uf ?? '';
    if (!ufEmitente && current.chaveAcesso.length >= 2) {
      ufEmitente = IBGE_UF_MAP[current.chaveAcesso.slice(0, 2)] ?? '';
    }

    notes.push({
      filename,
      chaveAcesso: current.chaveAcesso,
      numeroNota: current.numeroNota,
      serie: current.serie,
      cnpjEmitente: participant?.cnpj ?? '',
      ufEmitente,
      cnpjDestinatario: destCnpj,
      ufDestinatario: destUf,
      dataEmissao: `${current.dataEmissao}T00:00:00`,
      dataEntrada: current.dataEntrada,
      vTotalNota: current.vTotalNota,
      vBcNota: current.vBcNota,
      vIcmsNota: current.vIcmsNota,
      origemExtracao: 'sped',
      rawMetadata: {
        origem: 'sped_fiscal',
        cod_part: current.codPart,
        qtd_itens: currentItems.length,
        dest_ie: destIe,
        dest_nome: destNome,
        emit_nome: participant?.nome ?? '',
      },
      itens: currentItems,
    });

    current = null;
    currentItems = [];
    currentC190 = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const fields = line.split('|');
    if (fields.length < 3) continue;
    const reg = (fields[1] ?? '').trim().toUpperCase();

    if (reg === '0000') {
      destNome = (fields[6] ?? '').trim();
      destCnpj = digits((fields[7] ?? '').trim() || (fields[8] ?? '').trim());
      const rawUf = (fields[9] ?? '').trim().toUpperCase();
      destUf = IBGE_UF_MAP[rawUf] ?? rawUf;
      destIe = (fields[10] ?? '').trim();
      continue;
    }

    if (reg === '0150') {
      const codPart = (fields[2] ?? '').trim();
      const nome = (fields[3] ?? '').trim();
      const cnpj = digits((fields[5] ?? '').trim() || (fields[6] ?? '').trim());
      let uf = '';
      const codMun = digits((fields[8] ?? '').trim());
      if (codMun.length >= 2) uf = IBGE_UF_MAP[codMun.slice(0, 2)] ?? '';
      if (!uf) {
        const possibleUf = (fields[7] ?? '').trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(possibleUf)) uf = possibleUf;
      }
      participants.set(codPart, { cnpj, nome, uf });
      continue;
    }

    if (reg === '0200') {
      const codItem = (fields[2] ?? '').trim();
      itemRegistry.set(codItem, {
        descricao: (fields[3] ?? '').trim(),
        ncm: digits((fields[8] ?? '').trim()),
        cest: digits((fields[13] ?? '').trim()),
      });
      continue;
    }

    if (reg === 'C100') {
      finalize();
      const indOper = (fields[2] ?? '0').trim();
      const codSit = (fields[6] ?? '00').trim();
      if (indOper !== '0' || !['00', '01'].includes(codSit)) continue;

      const numeroNota = (fields[8] ?? '').trim();
      const dataEmissao = parseSpedDate(fields[10]);
      if (!dataEmissao) {
        throw new Error(`O documento SPED nº "${numeroNota || '(sem número)'}" possui data de emissão inválida.`);
      }
      const vTotal = decimal(fields[12]);
      const vFrete = decimal(fields[18]);
      const vSeg = decimal(fields[19]);
      const vOut = decimal(fields[20]);

      current = {
        codPart: (fields[4] ?? '').trim(),
        serie: (fields[7] ?? '1').trim(),
        numeroNota,
        chaveAcesso: digits((fields[9] ?? '').trim()),
        dataEmissao,
        dataEntrada: parseSpedDate(fields[11]),
        vTotalNota: vTotal,
        vBcNota: decimal(fields[21]),
        vIcmsNota: decimal(fields[22]),
        vIpiNota: decimal(fields[25]),
        vDespesasNota: vFrete + vSeg + vOut,
      };
      currentItems = [];
      currentC190 = [];
      continue;
    }

    if (reg === 'C170' && current) {
      const rawItem = Number.parseInt((fields[2] ?? '').trim(), 10);
      const codItem = (fields[3] ?? '').trim();
      const registry = itemRegistry.get(codItem);
      const vItem = decimal(fields[7]);
      const vDesc = decimal(fields[8]);
      const cfop = (fields[11] ?? '').trim();
      const vBcIcms = decimal(fields[13]);
      const aliqIcms = decimal(fields[14]);
      const vIcms = decimal(fields[15]);
      const vIpi = decimal(fields[24]);
      const vBcPis = decimal(fields[26]);
      const aOri = aliqIcms > 1 ? aliqIcms / 100 : aliqIcms;
      let vTotal = vItem + vIpi - vDesc;
      if (vTotal <= 0 && vItem > 0) vTotal = vItem;

      let baseCalculo: number;
      let ipiDespesas: number;
      if (vBcIcms > 0) {
        baseCalculo = vBcIcms;
        ipiDespesas = vIpi === 0 && vTotal > vBcIcms ? vTotal - vBcIcms : vIpi;
      } else if (vBcPis > 0 && vBcPis < vTotal) {
        baseCalculo = vBcPis;
        ipiDespesas = vTotal - vBcPis;
      } else {
        baseCalculo = vTotal - vIpi;
        ipiDespesas = vIpi;
      }

      currentItems.push({
        itemNumero: Number.isFinite(rawItem) ? rawItem : currentItems.length + 1,
        ncm: registry?.ncm || '00000000',
        cest: registry?.cest || '',
        cfop,
        descricao: registry?.descricao || `Item ${codItem}`,
        descricaoConfiavel: true,
        vItem,
        vTotal,
        baseCalculo,
        ipiDespesas,
        aOri,
        vIcms,
      });
      continue;
    }

    if (reg === 'C190' && current) {
      const cfop = (fields[3] ?? '').trim();
      const aliq = decimal(fields[4]);
      const vOpr = decimal(fields[5]);
      const vBcIcms = decimal(fields[6]);
      const vIcms = decimal(fields[7]);
      const vIpi = decimal(fields[11]);
      currentC190.push({
        cfop,
        aOri: aliq,
        vOpr,
        baseCalculo: vBcIcms > 0 ? vBcIcms : vOpr - vIpi,
        vIcms,
        vIpi: vBcIcms > 0 && vIpi === 0 && vOpr > vBcIcms ? vOpr - vBcIcms : vIpi,
      });
    }
  }

  finalize();
  if (notes.length === 0) {
    throw new Error('Nenhum documento fiscal de entrada (Registro C100, IND_OPER=0) válido foi encontrado no SPED Fiscal.');
  }

  return {
    notes,
    companyInfo: { nome: destNome, cnpj: destCnpj, uf: destUf, ie: destIe },
  };
}
