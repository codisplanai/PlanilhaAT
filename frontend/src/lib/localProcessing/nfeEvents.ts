/**
 * Eventos e inutilizações de NF-e: identifica notas canceladas, inutilizadas ou não autorizadas.
 * Espelha app/services/extraction/nfe_eventos.py.
 *
 * O ZIP de XMLs traz, além da NF-e (nfeProc), arquivos de evento (procEventoNFe) e de
 * inutilização (procInutNFe). Só entram na apuração notas autorizadas (com ou sem carta de
 * correção). O tipo do evento vem em tpEvento:
 *   110111 Cancelamento | 110112 Cancelamento por substituição | 110110 Carta de Correção
 * Um evento só vale quando a SEFAZ o homologou (retEvento/cStat 135 ou 155).
 */

export const TP_EVENTO_CANCELAMENTO: Readonly<Record<string, string>> = {
  '110111': 'Cancelamento',
  '110112': 'Cancelamento por substituição',
};
export const TP_EVENTO_CARTA_CORRECAO = '110110';

/** 135 = evento registrado e vinculado; 155 = cancelamento homologado fora de prazo. */
const CSTAT_EVENTO_HOMOLOGADO = new Set(['135', '155']);
/** 100 = autorizado o uso da NF-e; 150 = autorizado fora do prazo. */
const CSTAT_NFE_AUTORIZADA = new Set(['100', '150']);
/** 102 = inutilização de número homologada. */
const CSTAT_INUTILIZACAO_HOMOLOGADA = new Set(['102']);

const SITUACAO_PROTOCOLO: Readonly<Record<string, string>> = {
  '101': 'cancelada',
  '151': 'cancelada',
  '110': 'com uso denegado',
  '205': 'com uso denegado',
  '301': 'com uso denegado',
  '302': 'com uso denegado',
  '303': 'com uso denegado',
};

export interface NfeEvent {
  chave: string;
  tpEvento: string;
  descricao: string;
  cStat: string;
  protocolo: string;
  dataEvento: string;
}

export interface NfeInutilizacao {
  cnpj: string;
  serie: string;
  numeroIni: number;
  numeroFim: number;
  cStat: string;
  protocolo: string;
}

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function all(doc: Document, localName: string): Element[] {
  return Array.from(doc.querySelectorAll('*')).filter((node) => node.localName === localName);
}

function child(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  return Array.from(parent.children).find((node) => node.localName === name) ?? null;
}

function text(parent: Element | null | undefined, name: string): string {
  return child(parent, name)?.textContent?.trim() ?? '';
}

export function isNfeEventDoc(doc: Document): boolean {
  return all(doc, 'infEvento').some((el) => child(el, 'tpEvento') !== null && child(el, 'chNFe') !== null);
}

export function isNfeInutDoc(doc: Document): boolean {
  return all(doc, 'infInut').length > 0;
}

export function parseNfeEventDoc(doc: Document): NfeEvent | null {
  const evento = all(doc, 'evento')[0] ?? null;
  let infEvento = child(evento, 'infEvento');
  if (!infEvento) {
    infEvento = all(doc, 'infEvento').find((el) => child(el, 'chNFe') !== null) ?? null;
  }
  if (!infEvento) return null;
  const chave = digits(text(infEvento, 'chNFe'));
  const tpEvento = digits(text(infEvento, 'tpEvento'));
  if (chave.length !== 44 || !tpEvento) return null;
  const retInf = child(all(doc, 'retEvento')[0] ?? null, 'infEvento');
  return {
    chave,
    tpEvento,
    descricao: text(child(infEvento, 'detEvento'), 'descEvento') || text(retInf, 'xEvento'),
    cStat: text(retInf, 'cStat'),
    protocolo: text(retInf, 'nProt'),
    dataEvento: text(retInf, 'dhRegEvento') || text(infEvento, 'dhEvento'),
  };
}

export function parseNfeInutDoc(doc: Document): NfeInutilizacao | null {
  const infs = all(doc, 'infInut');
  const pedido = infs.find((el) => child(el, 'nNFIni') !== null) ?? null;
  const retorno = infs.find((el) => child(el, 'cStat') !== null) ?? null;
  if (!pedido) return null;
  const numeroIni = Number(digits(text(pedido, 'nNFIni')));
  const numeroFim = Number(digits(text(pedido, 'nNFFin')) || numeroIni);
  if (!Number.isFinite(numeroIni) || !Number.isFinite(numeroFim)) return null;
  return {
    cnpj: digits(text(pedido, 'CNPJ')),
    serie: digits(text(pedido, 'serie')).replace(/^0+/, ''),
    numeroIni,
    numeroFim,
    cStat: text(retorno, 'cStat'),
    protocolo: text(retorno, 'nProt'),
  };
}

/** Motivo quando o protocolo (protNFe) da própria NF-e indica que ela não está autorizada. */
export function protocolRejectionReason(cStat: string | null | undefined): string | null {
  const code = String(cStat ?? '').trim();
  if (!code || CSTAT_NFE_AUTORIZADA.has(code)) return null;
  const situacao = SITUACAO_PROTOCOLO[code] ?? `não autorizada (cStat ${code})`;
  return `NF-e ${situacao} no protocolo da SEFAZ (cStat ${code}). Apenas notas autorizadas são apuradas.`;
}

function formatDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export interface NoteIdentity {
  chaveAcesso: string;
  cnpjEmitente: string;
  serie: string;
  numeroNota: string;
}

/** Eventos e inutilizações lidos do lote de XMLs, para decidir quais notas valem. */
export class NfeEventRegistry {
  private readonly cancelamentos = new Map<string, NfeEvent>();
  private readonly inutilizacoes: NfeInutilizacao[] = [];
  cartasCorrecao = 0;

  addEvent(event: NfeEvent): void {
    if (event.tpEvento === TP_EVENTO_CARTA_CORRECAO) {
      this.cartasCorrecao += 1;
    } else if (event.tpEvento in TP_EVENTO_CANCELAMENTO && CSTAT_EVENTO_HOMOLOGADO.has(event.cStat)) {
      if (!this.cancelamentos.has(event.chave)) this.cancelamentos.set(event.chave, event);
    }
  }

  addInutilizacao(inut: NfeInutilizacao): void {
    if (CSTAT_INUTILIZACAO_HOMOLOGADA.has(inut.cStat)) this.inutilizacoes.push(inut);
  }

  /** Motivo para desconsiderar a nota (cancelada/inutilizada) ou null se segue válida. */
  invalidityReason(note: NoteIdentity): string | null {
    const event = this.cancelamentos.get(digits(note.chaveAcesso));
    if (event) {
      const date = formatDate(event.dataEvento);
      const when = date ? ` em ${date}` : '';
      const prot = event.protocolo ? ` (protocolo ${event.protocolo})` : '';
      return `NF-e cancelada: evento de ${TP_EVENTO_CANCELAMENTO[event.tpEvento]} (${event.tpEvento}) homologado${when}${prot}. Nota desconsiderada da apuração.`;
    }
    const cnpj = digits(note.cnpjEmitente);
    const serie = digits(note.serie).replace(/^0+/, '');
    const numero = Number(digits(note.numeroNota));
    if (!Number.isFinite(numero)) return null;
    const inut = this.inutilizacoes.find(
      (item) => item.cnpj === cnpj && item.serie === serie && item.numeroIni <= numero && numero <= item.numeroFim,
    );
    if (!inut) return null;
    const prot = inut.protocolo ? ` (protocolo ${inut.protocolo})` : '';
    return `NF-e inutilizada: numeração ${inut.numeroIni} a ${inut.numeroFim} da série ${inut.serie || '0'} inutilizada${prot}. Nota desconsiderada da apuração.`;
  }
}
