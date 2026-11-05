"""A.ORI do DIFAL a partir da alíquota de crédito informada em Informações Complementares.

Fornecedor do Simples Nacional pode autorizar o crédito de ICMS por texto no infCpl
("aliquota para credito de ICMS aproximadamente 3,59 %"). Só a frase da alíquota de
crédito autoriza; a sentença "NAO GERA DIREITO A CREDITO..." que a acompanha é ignorada.
"""
from decimal import Decimal

import pytest

from app.constants import ANTECIPACAO_PARCIAL, DIFAL
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.extraction.inf_compl import extrair_aliquota_credito_icms
from app.services.pipeline_outputs import processed_note_to_row
from app.services.pipeline_service import ProcessingPipelineService
from tests.test_pipeline_simples_aliquota_interestadual import (
    _build_nfe_xml,
    _setup_pipeline_env,
)

INF_CPL_COM_CREDITO = (
    "Inf. Contribuinte: - DOC. EMIT. POR OPTANTE SIMPLES NACIONAL(aliquota Simples "
    "Nacional aproximadamente 10,71 % - aliquota para credito de ICMS aproximadamente "
    "3,59 %)-NAO GERA DIREITO A CREDITO DE ICMS, IPI E ISS - Pedido Aprovado por Wilson"
)
INF_CPL_SEM_CREDITO = (
    "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. "
    "NAO GERA DIREITO A CREDITO FISCAL DE IPI."
)


def _com_inf_cpl(xml: bytes, texto: str) -> bytes:
    info = f"<infAdic><infCpl>{texto}</infCpl></infAdic></infNFe>".encode("utf-8")
    return xml.replace(b"</infNFe>", info)


@pytest.mark.parametrize(
    "texto, esperado",
    [
        (INF_CPL_COM_CREDITO, Decimal("0.0359")),
        ("ALIQUOTA PARA CRÉDITO DE ICMS APROXIMADAMENTE 2,5%", Decimal("0.025")),
        ("aliquota para credito de icms de 1.25 %", Decimal("0.0125")),
        (INF_CPL_SEM_CREDITO, None),
        ("aliquota Simples Nacional aproximadamente 10,71 %", None),
        ("", None),
        (None, None),
    ],
)
def test_extrai_aliquota_credito_do_texto(texto, esperado):
    assert extrair_aliquota_credito_icms(texto) == esperado


def test_extrator_xml_le_aliquota_credito_do_inf_cpl():
    xml = _com_inf_cpl(
        _build_nfe_xml(numero="201", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="2556"),
        INF_CPL_COM_CREDITO,
    )
    nf = NFeXMLExtractor().extract_from_xml(xml)
    assert nf.aliq_credito_icms_inf_compl == Decimal("0.0359")


def test_extrator_xml_sem_inf_cpl_nao_tem_aliquota_credito():
    xml = _build_nfe_xml(numero="202", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="2556")
    nf = NFeXMLExtractor().extract_from_xml(xml)
    assert nf.aliq_credito_icms_inf_compl is None


def test_difal_usa_credito_autorizado_em_inf_cpl(db_session, create_sample_excel_template):
    _, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    xml = _com_inf_cpl(
        _build_nfe_xml(numero="203", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="2556"),
        INF_CPL_COM_CREDITO,
    )

    resultado = ProcessingPipelineService(db_session).process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_203.xml", xml)],
        sped_file_bytes=None,
    )

    nota = resultado.notas_processadas[0]
    assert nota.destino_planilha == DIFAL
    assert nota.a_ori == Decimal("0.0359")
    assert nota.metadados_extras["a_ori_destacada"] is True
    assert nota.metadados_extras["a_ori_inferida_simples"] is False
    assert nota.metadados_extras["a_ori_inf_compl"] is True
    # base_st = 1000 / (1 - 0.205) = 1257.86; devido = base_st * (0.205 - 0.0359)
    assert nota.credito == Decimal("45.16")
    assert nota.valor_devido == Decimal("212.70")
    avisos = [a for a in resultado.avisos_avaliacao if "Informações Complementares" in a.get("aviso", "")]
    assert len(avisos) == 1
    # A célula A.ORI da planilha de DIFAL sai preenchida com a alíquota autorizada
    assert processed_note_to_row(nota)["a_ori"] == Decimal("0.0359")


def test_difal_sem_frase_de_credito_continua_sem_a_ori(db_session, create_sample_excel_template):
    _, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    xml = _com_inf_cpl(
        _build_nfe_xml(numero="204", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="2556"),
        INF_CPL_SEM_CREDITO,
    )

    resultado = ProcessingPipelineService(db_session).process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_204.xml", xml)],
        sped_file_bytes=None,
    )

    nota = resultado.notas_processadas[0]
    assert nota.a_ori == Decimal("0.0000")
    assert nota.metadados_extras["a_ori_destacada"] is False
    assert nota.metadados_extras["a_ori_inf_compl"] is False
    assert processed_note_to_row(nota)["a_ori"] is None


def test_difal_picms_destacado_prevalece_sobre_inf_cpl(db_session, create_sample_excel_template):
    _, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    xml = _com_inf_cpl(
        _build_nfe_xml(
            numero="205", uf_emit="SP", crt="1", orig="0", csosn="101",
            p_icms="12.00", cfop="2556",
        ),
        INF_CPL_COM_CREDITO,
    )

    resultado = ProcessingPipelineService(db_session).process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_205.xml", xml)],
        sped_file_bytes=None,
    )

    nota = resultado.notas_processadas[0]
    assert nota.a_ori == Decimal("0.12")
    assert nota.metadados_extras["a_ori_inf_compl"] is False


def test_parcial_nao_usa_credito_do_inf_cpl(db_session, create_sample_excel_template):
    _, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    xml = _com_inf_cpl(
        _build_nfe_xml(numero="206", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="6102"),
        INF_CPL_COM_CREDITO,
    )

    resultado = ProcessingPipelineService(db_session).process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_206.xml", xml)],
        sped_file_bytes=None,
    )

    nota = resultado.notas_processadas[0]
    assert nota.destino_planilha == ANTECIPACAO_PARCIAL
    # Antecipação mantém a tabela interestadual (SP -> BA = 7%)
    assert nota.a_ori == Decimal("0.07")
    assert nota.metadados_extras["a_ori_inf_compl"] is False


def test_uniao_sped_xml_preserva_aliquota_credito_do_xml():
    from app.services.pipeline_helpers import enrich_sped_with_xml

    xml = _com_inf_cpl(
        _build_nfe_xml(numero="207", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="6102"),
        INF_CPL_COM_CREDITO,
    )
    nf_xml = NFeXMLExtractor().extract_from_xml(xml)
    nf_sped = nf_xml.copy(deep=True)
    nf_sped.aliq_credito_icms_inf_compl = None
    nf_sped.origem_extracao = "sped"

    enrich_sped_with_xml(nf_sped, nf_xml)

    assert nf_sped.aliq_credito_icms_inf_compl == Decimal("0.0359")
