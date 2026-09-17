import json
from decimal import Decimal
from datetime import date
from fastapi.testclient import TestClient

from app.main import app
from app.services.pipeline_service import ProcessingPipelineService
from tests.conftest import CHAVE_NF901, build_xml_nfe


SPED_BONIFICACAO_COM_CREDITO = """|0000|014|0|01012026|31012026|CLIENTE CONTABILIDADE BAHIA LTDA|12345678000195|BA|123456789|2927408|||A|1|
|0150|F1|FORNECEDOR SP LTDA|1058|98765432000180|||3550308||||
|0200|P1|PRODUTO BONIFICADO|||UN|01|21069090|||18,00||
|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO BONIFICADO|1,000|UN|2000,00|0,00|0|000|2910||2000,00|12,00|240,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
""".encode("utf-8")


SPED_BONIFICACAO_SEM_CREDITO = """|0000|014|0|01012026|31012026|CLIENTE CONTABILIDADE BAHIA LTDA|12345678000195|BA|123456789|2927408|||A|1|
|0150|F1|FORNECEDOR SP LTDA|1058|98765432000180|||3550308||||
|0200|P1|PRODUTO BONIFICADO|||UN|01|21069090|||18,00||
|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|10012026|20012026|2000,00|0|0,00|0,00|0,00|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO BONIFICADO|1,000|UN|2000,00|0,00|0|041|2910||0,00|0,00|0,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
""".encode("utf-8")


def test_detect_bonificacao_sped_com_credito(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    service = ProcessingPipelineService(db_session)

    res = service.pre_analisar(
        solicitacao_id=sol.id,
        sped_file_bytes=SPED_BONIFICACAO_COM_CREDITO,
        sped_filename="sped_fiscal.txt",
    )

    assert res["requer_decisao"] is True
    assert len(res["notas_bonificacao"]) == 1
    item = res["notas_bonificacao"][0]
    assert item["numero_nota"] == "901"
    assert "2910" in item["cfops"]
    assert item["tem_credito"] is True
    assert item["sugestao_revenda"] is True
    assert "identificado no SPED Fiscal" in item["motivo_sugestao"]


def test_detect_bonificacao_sped_sem_credito(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    service = ProcessingPipelineService(db_session)

    res = service.pre_analisar(
        solicitacao_id=sol.id,
        sped_file_bytes=SPED_BONIFICACAO_SEM_CREDITO,
        sped_filename="sped_fiscal.txt",
    )

    assert res["requer_decisao"] is True
    assert len(res["notas_bonificacao"]) == 1
    item = res["notas_bonificacao"][0]
    assert item["numero_nota"] == "901"
    assert "2910" in item["cfops"]
    assert item["tem_credito"] is False
    assert item["sugestao_revenda"] is False
    assert "Sem destaque de crédito" in item["motivo_sugestao"]


def test_detect_amostra_gratis_xml(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    service = ProcessingPipelineService(db_session)

    xml_amostra = build_xml_nfe("905", "35260198765432000180550010000009051000000905", "100.00", "15", cfop="6911")
    res = service.pre_analisar(
        solicitacao_id=sol.id,
        xml_files_bytes=[("905.xml", xml_amostra)],
    )

    assert res["requer_decisao"] is True
    assert len(res["notas_bonificacao"]) == 1
    item = res["notas_bonificacao"][0]
    assert item["numero_nota"] == "905"
    assert "6911" in item["cfops"]
    assert item["tem_credito"] is True
    assert item["sugestao_revenda"] is True


def test_processamento_bonificacao_revenda_sim(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    service = ProcessingPipelineService(db_session)

    # Decisão explícita: Sim (Revenda)
    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        sped_file_bytes=SPED_BONIFICACAO_COM_CREDITO,
        decisoes_bonificacao={CHAVE_NF901: True},
    )
    db_session.refresh(res)

    assert res.total_notas_processadas == 1
    nota = res.notas_processadas[0]
    assert nota.numero_nota == "901"
    assert nota.cfop == "2910"  # CFOP original preservado
    assert nota.destino_planilha == "antecipacao_parcial"
    assert len(res.notas_ignoradas) == 0


def test_processamento_bonificacao_revenda_nao(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=("antecipacao_parcial", "difal"))
    service = ProcessingPipelineService(db_session)

    # Decisão explícita: Não (Não é para Revenda -> Vai para DIFAL)
    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        sped_file_bytes=SPED_BONIFICACAO_COM_CREDITO,
        decisoes_bonificacao={CHAVE_NF901: False},
    )
    db_session.refresh(res)

    assert res.total_notas_processadas == 1
    assert len(res.notas_processadas) == 1
    nota = res.notas_processadas[0]
    assert nota.numero_nota == "901"
    assert nota.destino_planilha == "difal"
    assert len(res.notas_ignoradas) == 0


def test_processamento_simples_nacional_bonificacao(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_parcial_simples"))
    sol.empresa.optante_simples_nacional = True
    db_session.commit()

    service = ProcessingPipelineService(db_session)
    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        sped_file_bytes=SPED_BONIFICACAO_COM_CREDITO,
        decisoes_bonificacao={CHAVE_NF901: True},
    )
    db_session.refresh(res)

    assert res.total_notas_processadas == 1
    nota = res.notas_processadas[0]
    assert nota.destino_planilha == "antecipacao_parcial_simples"
    assert nota.cfop == "2910"


def test_api_pre_analisar_e_processar(db_session, cenario_janeiro, client):
    sol = cenario_janeiro()

    # 1. Chamar endpoint /pre-analisar
    resp_pre = client.post(
        f"/api/v1/solicitacoes/{sol.id}/pre-analisar",
        files={"sped_file": ("sped.txt", SPED_BONIFICACAO_COM_CREDITO, "text/plain")},
    )
    assert resp_pre.status_code == 200
    data_pre = resp_pre.json()
    assert data_pre["requer_decisao"] is True
    assert len(data_pre["notas_bonificacao"]) == 1

    # 2. Chamar endpoint /processar com decisoes_bonificacao
    decisoes = json.dumps({CHAVE_NF901: True})
    resp_proc = client.post(
        f"/api/v1/solicitacoes/{sol.id}/processar",
        files={"sped_file": ("sped.txt", SPED_BONIFICACAO_COM_CREDITO, "text/plain")},
        data={"decisoes_bonificacao": decisoes},
    )
    assert resp_proc.status_code == 200
    data_proc = resp_proc.json()
    assert data_proc["status"] == "concluido"
    assert data_proc["total_notas_processadas"] == 1
