"""DIFAL retroativa (Regime Normal) e DIFAL Pago Antecipadamente (Simples Nacional)."""

from datetime import date
from decimal import Decimal

from app.services.pipeline_service import ProcessingPipelineService
from tests.conftest import (
    CHAVE_NF901,
    build_sped_entradas,
    build_xml_nfe,
    chave_nfe,
)

TIPOS = (
    "antecipacao_parcial",
    "antecipacao_parcial_antecipado",
    "antecipacao_parcial_simples",
    "antecipacao_parcial_antecipado_simples",
    "difal",
    "difal_antecipado",
)

CHAVE_950 = chave_nfe("2512", 950)
CHAVE_960 = chave_nfe("2601", 960)
CHAVE_970 = chave_nfe("2512", 970)

AVISO_RETROATIVA = (
    "Nota emitida antes do período (15/12/2025) com entrada no SPED do período: "
    "apenas itens de DIFAL (uso/consumo e ativo) foram considerados."
)


def _sped_retroativo(itens, chave=CHAVE_950, numero="950", dt_doc="15122025"):
    return build_sped_entradas([
        {"numero": numero, "chave": chave, "dt_doc": dt_doc, "dt_entrada": "05012026", "itens": itens},
    ])


def _processar(db_session, sol, **kwargs):
    res = ProcessingPipelineService(db_session).process_solicitacao(sol.id, **kwargs)
    db_session.refresh(res)
    return res


def _numeros_ignorados(res):
    return {n["numero_nota"] for n in (res.notas_ignoradas or [])}


def test_regime_normal_aceita_uso_consumo_retroativo(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS)
    xml = build_xml_nfe("950", CHAVE_950, "800.00", "15", mes="12", ano="2025")

    res = _processar(
        db_session, sol,
        xml_files_bytes=[("950.xml", xml)],
        sped_file_bytes=_sped_retroativo([("2556", "800,00")]),
    )

    notas = [n for n in res.notas_processadas if n.numero_nota == "950"]
    assert [n.destino_planilha for n in notas] == ["difal"]
    assert notas[0].data_entrada == date(2026, 1, 5)
    assert "950" not in _numeros_ignorados(res)


def test_retroativa_mista_so_difal(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS)

    res = _processar(
        db_session, sol,
        sped_file_bytes=_sped_retroativo([("2556", "500,00"), ("2102", "300,00")]),
    )

    notas = [n for n in res.notas_processadas if n.numero_nota == "950"]
    assert [n.destino_planilha for n in notas] == ["difal"]
    assert notas[0].v_total == Decimal("500.00")
    assert not (res.cfops_sem_regra or {})
    assert any(a["aviso"] == AVISO_RETROATIVA for a in (res.avisos_avaliacao or []))


def test_retroativa_sem_difal_continua_ignorada(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS)

    res = _processar(
        db_session, sol,
        sped_file_bytes=build_sped_entradas([
            {"numero": "950", "chave": CHAVE_950, "dt_doc": "15122025", "dt_entrada": "05012026",
             "itens": [("2102", "300,00")]},
            {"numero": "901", "chave": CHAVE_NF901, "dt_doc": "10012026", "dt_entrada": "20012026",
             "itens": [("2556", "100,00")]},
        ]),
    )

    motivos = {n["numero_nota"]: n["motivo"] for n in res.notas_ignoradas}
    assert "fora do período informado" in motivos["950"]
    assert all(n.numero_nota != "950" for n in res.notas_processadas)


def test_simples_nao_aceita_retroativa(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, simples=True)

    res = _processar(
        db_session, sol,
        sped_file_bytes=build_sped_entradas([
            {"numero": "950", "chave": CHAVE_950, "dt_doc": "15122025", "dt_entrada": "05012026",
             "itens": [("2556", "800,00")]},
            {"numero": "901", "chave": CHAVE_NF901, "dt_doc": "10012026", "dt_entrada": "20012026",
             "itens": [("2556", "100,00")]},
        ]),
    )

    assert "950" in _numeros_ignorados(res)
    assert all(n.numero_nota != "950" for n in res.notas_processadas)


def test_simples_bonificacao_sem_entrada_vai_para_difal_antecipado(
        db_session, cenario_janeiro, sped_janeiro_com_nf901, xml_nf901):
    sol = cenario_janeiro(tipos=TIPOS, simples=True)
    xml_960 = build_xml_nfe("960", CHAVE_960, "400.00", "25", cfop="6911")

    res = _processar(
        db_session, sol,
        xml_files_bytes=[("901.xml", xml_nf901), ("960.xml", xml_960)],
        sped_file_bytes=sped_janeiro_com_nf901,
        decisoes_bonificacao={CHAVE_960: False},
    )

    nota = next(n for n in res.notas_processadas if n.numero_nota == "960")
    assert nota.destino_planilha == "difal_antecipado"
    assert nota.data_entrada is None
    assert "difal_antecipado" in {s.tipo for s in res.saidas}


MOTIVO_SEM_ENTRADA = (
    "Bonificação/amostra/outras entradas para uso/consumo sem entrada no período: no Regime Normal a DIFAL é apurada no mês da entrada (SPED)."
)


def test_regime_normal_bonificacao_sem_entrada_fica_para_o_mes_da_entrada(
        db_session, cenario_janeiro, sped_janeiro_com_nf901, xml_nf901):
    """Evita pagar duas vezes: a nota entra na DIFAL só no mês da entrada (retroativa)."""
    sol = cenario_janeiro(tipos=TIPOS)
    xml_960 = build_xml_nfe("960", CHAVE_960, "400.00", "25", cfop="6911")

    res = _processar(
        db_session, sol,
        xml_files_bytes=[("901.xml", xml_nf901), ("960.xml", xml_960)],
        sped_file_bytes=sped_janeiro_com_nf901,
        decisoes_bonificacao={CHAVE_960: False},
    )

    assert all(n.numero_nota != "960" for n in res.notas_processadas)
    motivos = {n["numero_nota"]: n["motivo"] for n in res.notas_ignoradas}
    assert motivos["960"] == MOTIVO_SEM_ENTRADA


def test_regime_normal_bonificacao_sem_fonte_de_entradas_continua_difal(
        db_session, cenario_janeiro):
    """Só XML (sem SPED nem planilha auxiliar): não há como saber a entrada, segue para a DIFAL."""
    sol = cenario_janeiro(tipos=TIPOS)
    xml_960 = build_xml_nfe("960", CHAVE_960, "400.00", "25", cfop="6911")

    res = _processar(db_session, sol, xml_files_bytes=[("960.xml", xml_960)],
                     decisoes_bonificacao={CHAVE_960: False})

    assert [n.destino_planilha for n in res.notas_processadas] == ["difal"]


def _sped_bonificacao_retroativa():
    return build_sped_entradas([
        {"numero": "970", "chave": CHAVE_970, "dt_doc": "20122025", "dt_entrada": "06012026",
         "itens": [("2911", "250,00")]},
    ])


def test_pre_analise_inclui_bonificacao_retroativa_regime_normal(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS)
    analise = ProcessingPipelineService(db_session).pre_analisar(
        sol.id, sped_file_bytes=_sped_bonificacao_retroativa())
    assert CHAVE_970 in {n["chave_acesso"] for n in analise["notas_bonificacao"]}


def test_pre_analise_simples_nao_inclui_bonificacao_retroativa(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, simples=True)
    analise = ProcessingPipelineService(db_session).pre_analisar(
        sol.id, sped_file_bytes=_sped_bonificacao_retroativa())
    assert CHAVE_970 not in {n["chave_acesso"] for n in analise["notas_bonificacao"]}
