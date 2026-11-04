"""Empresa industrial: não recolhe Parcial nem Tributária, gera apenas DIFAL."""

import copy
from decimal import Decimal

from app.models.empresa import Empresa
from app.services.pipeline_service import ProcessingPipelineService
from tests.conftest import CHAVE_NF901, build_sped_entradas, build_xml_nfe, chave_nfe
from tests.test_passo_a_passo_pipeline import PASSO_CONFIG

TIPOS = (
    "antecipacao_parcial",
    "antecipacao_parcial_antecipado",
    "antecipacao_tributaria",
    "antecipacao_tributaria_antecipado",
    "difal",
    "difal_antecipado",
)

MOTIVO_INDUSTRIA = (
    "Empresa industrial: não recolhe Antecipação Parcial nem Tributária "
    "(apenas DIFAL de uso/consumo e ativo imobilizado)."
)
MENSAGEM_SEM_PLANILHA = (
    "Nenhuma planilha gerada: empresa industrial sem itens de uso/consumo ou ativo imobilizado (DIFAL)"
)
CHAVE_960 = chave_nfe("2601", 960)


def _sped(itens):
    return build_sped_entradas([
        {"numero": "901", "chave": CHAVE_NF901, "dt_doc": "10012026", "dt_entrada": "20012026",
         "itens": itens},
    ])


def _processar(db_session, sol, **kwargs):
    res = ProcessingPipelineService(db_session).process_solicitacao(sol.id, **kwargs)
    db_session.refresh(res)
    return res


def test_industria_revenda_vai_para_excluidos(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, atividade="industria")

    res = _processar(db_session, sol, sped_file_bytes=_sped([("2102", "1000,00")]))

    assert res.notas_processadas == []
    assert [s for s in res.saidas if s.arquivo_path] == []
    assert len(res.itens_excluidos) == 1
    assert res.itens_excluidos[0]["tipo_exclusao"] == "industria_sem_antecipacao"
    assert res.itens_excluidos[0]["motivo"] == MOTIVO_INDUSTRIA
    assert res.mensagem_erro == MENSAGEM_SEM_PLANILHA


def test_industria_nota_mista(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, atividade="industria")

    res = _processar(
        db_session, sol, sped_file_bytes=_sped([("2556", "500,00"), ("2102", "300,00")]))

    assert [(n.destino_planilha, n.v_total) for n in res.notas_processadas] == [
        ("difal", Decimal("500.00"))]
    assert [i["tipo_exclusao"] for i in res.itens_excluidos] == ["industria_sem_antecipacao"]


def test_industria_tributaria_vai_para_excluidos(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, atividade="industria")

    res = _processar(
        db_session, sol, sped_file_bytes=_sped([("2556", "500,00"), ("2403", "300,00")]))

    assert {n.destino_planilha for n in res.notas_processadas} == {"difal"}
    assert [i["tipo_exclusao"] for i in res.itens_excluidos] == ["industria_sem_antecipacao"]


def test_industria_bonificacao_confirmada_vai_para_difal(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, atividade="industria")
    xml = build_xml_nfe("960", CHAVE_960, "400.00", "25", cfop="6911")

    res = _processar(db_session, sol, xml_files_bytes=[("960.xml", xml)],
                     decisoes_bonificacao={CHAVE_960: False})

    assert [n.destino_planilha for n in res.notas_processadas] == ["difal"]


def test_industria_bonificacao_negada_vai_para_excluidos(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, atividade="industria")
    xml = build_xml_nfe("960", CHAVE_960, "400.00", "25", cfop="6911")

    res = _processar(db_session, sol, xml_files_bytes=[("960.xml", xml)],
                     decisoes_bonificacao={CHAVE_960: True})

    assert res.notas_processadas == []
    assert res.itens_excluidos[0]["tipo_exclusao"] == "industria_sem_antecipacao"
    assert res.itens_excluidos[0]["motivo"] == (
        "Bonificação/amostra/outras entradas (CFOP 6911) não confirmada como uso/consumo "
        "pelo usuário (empresa industrial)."
    )


def test_industria_ignora_politica_revenda_tributaria(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS, atividade="industria")
    empresa = db_session.query(Empresa).filter_by(id=sol.empresa_id).one()
    config = copy.deepcopy(PASSO_CONFIG)
    config["mva_revenda_antecipacao_tributaria"]["empresa_cnpj"] = empresa.cnpj
    empresa.perfil_regras.configuracoes_extras = config
    db_session.commit()

    res = _processar(
        db_session, sol, sped_file_bytes=_sped([("2556", "500,00"), ("2102", "300,00")]))

    assert {n.destino_planilha for n in res.notas_processadas} == {"difal"}
    assert [i["tipo_exclusao"] for i in res.itens_excluidos] == ["industria_sem_antecipacao"]


def test_comercio_inalterado(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=TIPOS)

    res = _processar(db_session, sol, sped_file_bytes=_sped([("2102", "1000,00")]))

    assert [n.destino_planilha for n in res.notas_processadas] == ["antecipacao_parcial"]
    assert res.itens_excluidos == []
