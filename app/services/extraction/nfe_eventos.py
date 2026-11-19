"""Eventos e inutilizações de NF-e: identifica notas canceladas, inutilizadas ou não autorizadas.

O ZIP de XMLs traz, além da NF-e (``nfeProc``), arquivos de evento (``procEventoNFe``) e de
inutilização (``procInutNFe``). Só entram na apuração notas autorizadas (com ou sem carta de
correção). O tipo do evento vem em ``tpEvento``:

* 110111 - Cancelamento
* 110112 - Cancelamento por substituição
* 110110 - Carta de Correção (não altera a validade da nota)

Um evento só vale quando a SEFAZ o homologou (``retEvento``/``cStat`` 135 ou 155).
"""
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
import xml.etree.ElementTree as ET

from app.services.extraction.xml_utils import find_elem, get_text, strip_tag

TP_EVENTO_CANCELAMENTO = {
    "110111": "Cancelamento",
    "110112": "Cancelamento por substituição",
}
TP_EVENTO_CARTA_CORRECAO = "110110"

# 135 = evento registrado e vinculado à NF-e; 155 = cancelamento homologado fora de prazo.
CSTAT_EVENTO_HOMOLOGADO = {"135", "155"}
# 100 = autorizado o uso da NF-e; 150 = autorizado fora do prazo.
CSTAT_NFE_AUTORIZADA = {"100", "150"}
# 102 = inutilização de número homologada.
CSTAT_INUTILIZACAO_HOMOLOGADA = {"102"}

_MOTIVOS_PROTOCOLO = {
    "101": "cancelada",
    "151": "cancelada",
    "110": "com uso denegado",
    "205": "com uso denegado",
    "301": "com uso denegado",
    "302": "com uso denegado",
    "303": "com uso denegado",
}


@dataclass
class EventoNFe:
    chave: str
    tp_evento: str
    descricao: str = ""
    c_stat: str = ""
    protocolo: str = ""
    data_evento: str = ""

    @property
    def homologado(self) -> bool:
        return self.c_stat in CSTAT_EVENTO_HOMOLOGADO

    @property
    def cancela_nota(self) -> bool:
        return self.tp_evento in TP_EVENTO_CANCELAMENTO and self.homologado


@dataclass
class InutilizacaoNFe:
    cnpj: str
    serie: str
    numero_ini: int
    numero_fim: int
    c_stat: str = ""
    protocolo: str = ""

    @property
    def homologada(self) -> bool:
        return self.c_stat in CSTAT_INUTILIZACAO_HOMOLOGADA


def _digits(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def _descendants(root: ET.Element, name: str) -> List[ET.Element]:
    return [el for el in root.iter() if strip_tag(el.tag) == name]


def _root(xml_content: bytes) -> Optional[ET.Element]:
    try:
        return ET.fromstring(xml_content)
    except Exception:
        return None


def is_evento_nfe_xml(xml_content: bytes) -> bool:
    root = _root(xml_content)
    return root is not None and any(
        find_elem(el, "tpEvento") is not None and find_elem(el, "chNFe") is not None
        for el in _descendants(root, "infEvento")
    )


def is_inutilizacao_xml(xml_content: bytes) -> bool:
    root = _root(xml_content)
    return root is not None and bool(_descendants(root, "infInut"))


def parse_evento_nfe(xml_content: bytes) -> Optional[EventoNFe]:
    """Lê um ``procEventoNFe``. Retorna None se não for evento de NF-e."""
    root = _root(xml_content)
    if root is None:
        return None
    evento = next(iter(_descendants(root, "evento")), None)
    inf_evento = find_elem(evento, "infEvento") if evento is not None else None
    if inf_evento is None:
        # Arquivo contendo apenas o retorno do evento.
        inf_evento = next(
            (el for el in _descendants(root, "infEvento") if find_elem(el, "chNFe") is not None),
            None,
        )
    if inf_evento is None:
        return None
    chave = _digits(get_text(inf_evento, "chNFe"))
    tp_evento = _digits(get_text(inf_evento, "tpEvento"))
    if len(chave) != 44 or not tp_evento:
        return None
    det = find_elem(inf_evento, "detEvento")
    ret = next(iter(_descendants(root, "retEvento")), None)
    ret_inf = find_elem(ret, "infEvento") if ret is not None else None
    return EventoNFe(
        chave=chave,
        tp_evento=tp_evento,
        descricao=get_text(det, "descEvento") or get_text(ret_inf, "xEvento"),
        c_stat=get_text(ret_inf, "cStat"),
        protocolo=get_text(ret_inf, "nProt"),
        data_evento=get_text(ret_inf, "dhRegEvento") or get_text(inf_evento, "dhEvento"),
    )


def parse_inutilizacao_nfe(xml_content: bytes) -> Optional[InutilizacaoNFe]:
    """Lê um ``procInutNFe`` (faixa de numeração inutilizada)."""
    root = _root(xml_content)
    if root is None:
        return None
    infs = _descendants(root, "infInut")
    pedido = next((el for el in infs if find_elem(el, "nNFIni") is not None), None)
    retorno = next((el for el in infs if find_elem(el, "cStat") is not None), None)
    if pedido is None:
        return None
    try:
        ini = int(_digits(get_text(pedido, "nNFIni")))
        fim = int(_digits(get_text(pedido, "nNFFin")) or ini)
    except ValueError:
        return None
    return InutilizacaoNFe(
        cnpj=_digits(get_text(pedido, "CNPJ")),
        serie=_digits(get_text(pedido, "serie")).lstrip("0"),
        numero_ini=ini,
        numero_fim=fim,
        c_stat=get_text(retorno, "cStat"),
        protocolo=get_text(retorno, "nProt"),
    )


def motivo_protocolo_nao_autorizado(c_stat: Optional[str], protocolo: Optional[str] = None) -> Optional[str]:
    """Motivo quando o protocolo (protNFe) da própria NF-e indica que ela não está autorizada."""
    c_stat = (c_stat or "").strip()
    if not c_stat or c_stat in CSTAT_NFE_AUTORIZADA:
        return None
    situacao = _MOTIVOS_PROTOCOLO.get(c_stat, f"não autorizada (cStat {c_stat})")
    return f"NF-e {situacao} no protocolo da SEFAZ (cStat {c_stat}). Apenas notas autorizadas são apuradas."


def _formatar_data(valor: str) -> str:
    try:
        return datetime.fromisoformat(valor).strftime("%d/%m/%Y")
    except ValueError:
        return ""


@dataclass
class RegistroEventos:
    """Eventos e inutilizações lidos do lote de XMLs, para decidir quais notas valem."""

    cancelamentos: Dict[str, EventoNFe] = field(default_factory=dict)
    inutilizacoes: List[InutilizacaoNFe] = field(default_factory=list)
    cartas_correcao: int = 0

    def adicionar_evento(self, evento: EventoNFe) -> None:
        if evento.tp_evento == TP_EVENTO_CARTA_CORRECAO:
            self.cartas_correcao += 1
        elif evento.cancela_nota:
            self.cancelamentos.setdefault(evento.chave, evento)

    def adicionar_inutilizacao(self, inut: InutilizacaoNFe) -> None:
        if inut.homologada:
            self.inutilizacoes.append(inut)

    def motivo_invalidade(
        self,
        *,
        chave: str,
        cnpj_emitente: str,
        serie: str,
        numero: str,
    ) -> Optional[str]:
        """Motivo para desconsiderar a nota (cancelada/inutilizada) ou None se segue válida."""
        evento = self.cancelamentos.get(_digits(chave))
        if evento is not None:
            tipo = TP_EVENTO_CANCELAMENTO[evento.tp_evento]
            data = _formatar_data(evento.data_evento)
            quando = f" em {data}" if data else ""
            prot = f" (protocolo {evento.protocolo})" if evento.protocolo else ""
            return (
                f"NF-e cancelada: evento de {tipo} ({evento.tp_evento}) homologado{quando}{prot}. "
                "Nota desconsiderada da apuração."
            )
        cnpj = _digits(cnpj_emitente)
        serie_norm = _digits(serie).lstrip("0")
        try:
            numero_int = int(_digits(numero))
        except ValueError:
            return None
        for inut in self.inutilizacoes:
            if (
                inut.cnpj == cnpj
                and inut.serie == serie_norm
                and inut.numero_ini <= numero_int <= inut.numero_fim
            ):
                prot = f" (protocolo {inut.protocolo})" if inut.protocolo else ""
                return (
                    f"NF-e inutilizada: numeração {inut.numero_ini} a {inut.numero_fim} da série "
                    f"{inut.serie or '0'} inutilizada{prot}. Nota desconsiderada da apuração."
                )
        return None
