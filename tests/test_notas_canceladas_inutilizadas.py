"""Só notas autorizadas (com ou sem carta de correção) entram na apuração.

O ZIP traz a NF-e e, em arquivos separados, os eventos (cancelamento, carta de correção) e as
inutilizações. Os XMLs abaixo são sintéticos, com a mesma estrutura dos arquivos da SEFAZ.
"""
import re
from decimal import Decimal

import pytest

from app.core.exceptions import ValidationException
from app.services.extraction.nfe_eventos import (
    RegistroEventos,
    parse_evento_nfe,
    parse_inutilizacao_nfe,
)
from app.services.pipeline_service import ProcessingPipelineService
from tests.test_pipeline_simples_aliquota_interestadual import (
    _build_nfe_xml,
    _setup_pipeline_env,
)


def _chave(xml: bytes) -> str:
    return re.sub(r"\D", "", re.search(rb'Id="NFe(\d+)"', xml).group(1).decode())


def _com_protocolo(xml: bytes, c_stat: str = "100", motivo: str = "Autorizado o uso da NF-e") -> bytes:
    chave = _chave(xml)
    prot = (
        f'<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>{chave}</chNFe>'
        f"<nProt>135260000000001</nProt><cStat>{c_stat}</cStat><xMotivo>{motivo}</xMotivo>"
        "</infProt></protNFe></nfeProc>"
    )
    return xml.replace(b"</nfeProc>", prot.encode("utf-8"))


def _evento(chave: str, tp: str = "110111", c_stat: str = "135", desc: str = "Cancelamento") -> bytes:
    ret = (
        f'<retEvento versao="1.00"><infEvento Id="ID135260000000009"><tpAmb>1</tpAmb><cStat>{c_stat}</cStat>'
        f"<chNFe>{chave}</chNFe><tpEvento>{tp}</tpEvento><xEvento>{desc} Homologado</xEvento>"
        "<nSeqEvento>1</nSeqEvento><dhRegEvento>2026-07-20T16:00:55-03:00</dhRegEvento>"
        "<nProt>135260000000009</nProt></infEvento></retEvento>"
        if c_stat
        else ""
    )
    return (
        '<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00">'
        f'<infEvento Id="ID{tp}{chave}01"><cOrgao>35</cOrgao><tpAmb>1</tpAmb><CNPJ>99999999000199</CNPJ>'
        f"<chNFe>{chave}</chNFe><dhEvento>2026-07-20T16:00:40-03:00</dhEvento><tpEvento>{tp}</tpEvento>"
        f'<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00">'
        f"<descEvento>{desc}</descEvento></detEvento></infEvento></evento>{ret}</procEventoNFe>"
    ).encode("utf-8")


def _inutilizacao(ini: int, fim: int, c_stat: str = "102") -> bytes:
    return (
        '<ProcInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><inutNFe versao="4.00">'
        '<infInut Id="ID35990000000001"><tpAmb>1</tpAmb><xServ>INUTILIZAR</xServ><cUF>35</cUF>'
        f"<ano>26</ano><CNPJ>99999999000199</CNPJ><mod>55</mod><serie>1</serie><nNFIni>{ini}</nNFIni>"
        f"<nNFFin>{fim}</nNFFin><xJust>Falha na numeracao da serie</xJust></infInut></inutNFe>"
        f'<retInutNFe versao="4.00"><infInut><tpAmb>1</tpAmb><cStat>{c_stat}</cStat>'
        "<xMotivo>Inutilizacao de numero homologado</xMotivo><cUF>35</cUF><ano>26</ano>"
        f"<CNPJ>99999999000199</CNPJ><mod>55</mod><serie>1</serie><nNFIni>{ini}</nNFIni><nNFFin>{fim}</nNFFin>"
        "<dhRecbto>2026-07-21T10:00:00-03:00</dhRecbto><nProt>135260000000010</nProt></infInut></retInutNFe>"
        "</ProcInutNFe>"
    ).encode("utf-8")


def _nfe(numero: str) -> bytes:
    return _com_protocolo(
        _build_nfe_xml(numero=numero, uf_emit="SP", crt="3", orig="0", csosn="", p_icms="12.00", cfop="6102")
    )


def _processar(db_session, create_sample_excel_template, arquivos):
    _, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    return ProcessingPipelineService(db_session).process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=arquivos,
        sped_file_bytes=None,
    )


def _numeros(resultado):
    return sorted(n.numero_nota for n in resultado.notas_processadas)


def _motivos(resultado):
    return {i["numero_nota"]: i["motivo"] for i in (resultado.notas_ignoradas or [])}


def test_parse_evento_de_cancelamento():
    chave = _chave(_nfe("301"))
    evento = parse_evento_nfe(_evento(chave))
    assert evento.chave == chave
    assert evento.tp_evento == "110111"
    assert evento.c_stat == "135"
    assert evento.protocolo == "135260000000009"
    assert evento.cancela_nota is True


def test_parse_evento_nao_homologado_nao_cancela():
    chave = _chave(_nfe("302"))
    assert parse_evento_nfe(_evento(chave, c_stat="")).cancela_nota is False
    assert parse_evento_nfe(_evento(chave, c_stat="573")).cancela_nota is False


def test_parse_inutilizacao():
    inut = parse_inutilizacao_nfe(_inutilizacao(10, 20))
    assert (inut.cnpj, inut.serie, inut.numero_ini, inut.numero_fim) == ("99999999000199", "1", 10, 20)
    assert inut.homologada is True


def test_registro_inutilizacao_por_faixa():
    registro = RegistroEventos()
    registro.adicionar_inutilizacao(parse_inutilizacao_nfe(_inutilizacao(10, 20)))
    base = dict(chave="", cnpj_emitente="99999999000199", serie="1")
    assert registro.motivo_invalidade(numero="15", **base)
    assert registro.motivo_invalidade(numero="21", **base) is None
    assert registro.motivo_invalidade(numero="15", **{**base, "serie": "2"}) is None


def test_nota_cancelada_e_desconsiderada(db_session, create_sample_excel_template):
    cancelada, valida = _nfe("311"), _nfe("312")
    resultado = _processar(db_session, create_sample_excel_template, [
        ("cancelada.xml", cancelada),
        ("valida.xml", valida),
        ("evento_cancelada.xml", _evento(_chave(cancelada))),
    ])
    assert _numeros(resultado) == ["312"]
    motivo = _motivos(resultado)["311"]
    assert "cancelada" in motivo and "110111" in motivo and "20/07/2026" in motivo


def test_ordem_dos_arquivos_nao_importa(db_session, create_sample_excel_template):
    cancelada, valida = _nfe("313"), _nfe("314")
    resultado = _processar(db_session, create_sample_excel_template, [
        ("evento_cancelada.xml", _evento(_chave(cancelada))),
        ("valida.xml", valida),
        ("cancelada.xml", cancelada),
    ])
    assert _numeros(resultado) == ["314"]


def test_cancelamento_por_substituicao_tambem_descarta(db_session, create_sample_excel_template):
    cancelada, valida = _nfe("315"), _nfe("316")
    resultado = _processar(db_session, create_sample_excel_template, [
        ("a.xml", cancelada),
        ("b.xml", valida),
        ("ev.xml", _evento(_chave(cancelada), tp="110112", desc="Cancelamento por substituicao")),
    ])
    assert _numeros(resultado) == ["316"]


def test_carta_de_correcao_mantem_a_nota(db_session, create_sample_excel_template):
    nota, outra = _nfe("321"), _nfe("322")
    resultado = _processar(db_session, create_sample_excel_template, [
        ("a.xml", nota),
        ("b.xml", outra),
        ("cce.xml", _evento(_chave(nota), tp="110110", desc="Carta de Correcao")),
    ])
    assert _numeros(resultado) == ["321", "322"]


def test_cancelamento_nao_homologado_mantem_a_nota(db_session, create_sample_excel_template):
    nota, outra = _nfe("323"), _nfe("324")
    resultado = _processar(db_session, create_sample_excel_template, [
        ("a.xml", nota),
        ("b.xml", outra),
        ("ev.xml", _evento(_chave(nota), c_stat="")),
    ])
    assert _numeros(resultado) == ["323", "324"]


def test_nota_inutilizada_e_desconsiderada(db_session, create_sample_excel_template):
    inutilizada, valida = _nfe("331"), _nfe("340")
    resultado = _processar(db_session, create_sample_excel_template, [
        ("a.xml", inutilizada),
        ("b.xml", valida),
        ("inut.xml", _inutilizacao(330, 335)),
    ])
    assert _numeros(resultado) == ["340"]
    assert "inutilizada" in _motivos(resultado)["331"]


def test_protocolo_denegado_e_desconsiderado(db_session, create_sample_excel_template):
    denegada = _com_protocolo(
        _build_nfe_xml(numero="341", uf_emit="SP", crt="3", orig="0", csosn="", p_icms="12.00", cfop="6102"),
        c_stat="110",
        motivo="Uso Denegado",
    )
    resultado = _processar(db_session, create_sample_excel_template, [
        ("a.xml", denegada),
        ("b.xml", _nfe("342")),
    ])
    assert _numeros(resultado) == ["342"]
    assert "denegado" in _motivos(resultado)["341"]


def test_xml_sem_protocolo_continua_valido(db_session, create_sample_excel_template):
    sem_protocolo = _build_nfe_xml(
        numero="343", uf_emit="SP", crt="3", orig="0", csosn="", p_icms="12.00", cfop="6102"
    )
    resultado = _processar(db_session, create_sample_excel_template, [("a.xml", sem_protocolo)])
    assert _numeros(resultado) == ["343"]


def test_todas_canceladas_gera_mensagem_clara(db_session, create_sample_excel_template):
    cancelada = _nfe("351")
    with pytest.raises(ValidationException, match="canceladas, inutilizadas ou não autorizadas"):
        _processar(db_session, create_sample_excel_template, [
            ("a.xml", cancelada),
            ("ev.xml", _evento(_chave(cancelada))),
        ])
