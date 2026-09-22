import os
import datetime
from decimal import Decimal
import pytest
from app.models.perfil_regras import PerfilRegras
from app.models.empresa import Empresa
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.services.pipeline_service import ProcessingPipelineService
from app.services.extraction.data_entrada_matcher import (
    DataEntradaNormalizer,
    DataEntradaMatcher,
    PlanilhaEntradaParser,
    PlanilhaEntradaRecord
)
from app.core.seeds import seed_default_templates

def test_data_entrada_normalizer():
    # CNPJ
    assert DataEntradaNormalizer.normalize_cnpj("08.177.785/0001-84") == "08177785000184"
    assert DataEntradaNormalizer.normalize_cnpj("  123.456.789-00 ") == "12345678900"
    assert DataEntradaNormalizer.normalize_cnpj(None) == ""

    # Número
    assert DataEntradaNormalizer.normalize_numero("0000028695   ") == "28695"
    assert DataEntradaNormalizer.normalize_numero("001234") == "1234"
    assert DataEntradaNormalizer.normalize_numero("1234") == "1234"
    assert DataEntradaNormalizer.normalize_numero(None) == ""

    # Série
    assert DataEntradaNormalizer.normalize_serie("001      ") == "001"
    assert DataEntradaNormalizer.normalize_serie(" 1 ") == "1"
    assert DataEntradaNormalizer.normalize_serie(None) == ""

    # Chave
    assert DataEntradaNormalizer.normalize_chave("31260408177785000184550010000286951000430850") == "31260408177785000184550010000286951000430850"
    assert DataEntradaNormalizer.normalize_chave("1234") == "" # Chave incompleta

def test_data_entrada_matcher_prioridade_chave():
    records = [
        PlanilhaEntradaRecord(
            numero_raw="100",
            numero_normalizado="100",
            serie_normalizada="1",
            cnpj_emitente_normalizado="99888777000166",
            chave_acesso_normalizada="31260408177785000184550010000286951000430850",
            data_entrada=datetime.date(2026, 5, 4)
        )
    ]

    # Match exato por chave
    dt, origem = DataEntradaMatcher.match_data_entrada(
        nf_chave="31260408177785000184550010000286951000430850",
        nf_cnpj_emitente="00000000000000", # Diferente, mas chave tem prioridade
        nf_serie="999",
        nf_numero="999",
        planilha_records=records
    )
    assert dt == datetime.date(2026, 5, 4)
    assert origem == "planilha_sistema_contabil"

def test_data_entrada_matcher_prioridade_cnpj_serie_numero():
    records = [
        PlanilhaEntradaRecord(
            numero_raw="0000028695",
            numero_normalizado="28695",
            serie_normalizada="001",
            cnpj_emitente_normalizado="08177785000184",
            chave_acesso_normalizada="", # Sem chave na planilha
            data_entrada=datetime.date(2026, 5, 10)
        )
    ]

    # Match por CNPJ + Série + Número
    dt, origem = DataEntradaMatcher.match_data_entrada(
        nf_chave="", # Sem chave no XML
        nf_cnpj_emitente="08.177.785/0001-84",
        nf_serie="1", # Normalização de 001 para 1
        nf_numero="00028695",
        planilha_records=records
    )
    assert dt == datetime.date(2026, 5, 10)
    assert origem == "planilha_sistema_contabil"

def test_data_entrada_matcher_zero_correspondencias():
    records = [
        PlanilhaEntradaRecord(
            numero_raw="100",
            numero_normalizado="100",
            serie_normalizada="1",
            cnpj_emitente_normalizado="11111111000111",
            chave_acesso_normalizada="",
            data_entrada=datetime.date(2026, 5, 4)
        )
    ]

    # Nota inexistente
    dt, origem = DataEntradaMatcher.match_data_entrada(
        nf_chave="44444444444444444444444444444444444444444444",
        nf_cnpj_emitente="99888777000166",
        nf_serie="1",
        nf_numero="200",
        planilha_records=records
    )
    assert dt is None
    assert origem is None

def test_data_entrada_matcher_ambiguidade_datas_conflitantes():
    records = [
        PlanilhaEntradaRecord(
            numero_raw="100",
            numero_normalizado="100",
            serie_normalizada="1",
            cnpj_emitente_normalizado="99888777000166",
            chave_acesso_normalizada="",
            data_entrada=datetime.date(2026, 5, 4)
        ),
        PlanilhaEntradaRecord(
            numero_raw="100",
            numero_normalizado="100",
            serie_normalizada="1",
            cnpj_emitente_normalizado="99888777000166",
            chave_acesso_normalizada="",
            data_entrada=datetime.date(2026, 5, 12) # Conflito de datas para a mesma nota!
        )
    ]

    dt, origem = DataEntradaMatcher.match_data_entrada(
        nf_chave="",
        nf_cnpj_emitente="99888777000166",
        nf_serie="1",
        nf_numero="100",
        planilha_records=records
    )
    # Deve deixar em branco devido à ambiguidade
    assert dt is None
    assert origem is None

def test_data_entrada_matcher_com_arquivo_real_teste2_xls():
    real_path = r"c:\Users\Rodrigo\Desktop\teste2.XLS"
    if not os.path.exists(real_path):
        pytest.skip("Arquivo teste2.XLS não presente")

    with open(real_path, "rb") as f:
        file_bytes = f.read()

    records = PlanilhaEntradaParser.parse(file_bytes, "teste2.XLS")
    assert len(records) > 0

    # Testar correspondência para a nota 28695
    # Chave: 31260408177785000184550010000286951000430850 | CNPJ: 08177785000184 | Serie: 001 | Num: 28695
    dt, origem = DataEntradaMatcher.match_data_entrada(
        nf_chave="31260408177785000184550010000286951000430850",
        nf_cnpj_emitente="08177785000184",
        nf_serie="1",
        nf_numero="28695",
        planilha_records=records
    )
    assert dt == datetime.date(2026, 5, 4)
    assert origem == "planilha_sistema_contabil"

def test_api_patch_data_entrada_manual(client, db_session):
    seed_default_templates(db_session)
    perfil = PerfilRegras(nome="Perfil Padrão")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.2050"),
        descricao="Alíquota BA"
    ))
    db_session.commit()

    empresa = Empresa(
        razao_social="EMPRESA TESTE MANUAL",
        cnpj="12345678000195",
        uf="BA",
        perfil_regras_id=perfil.id
    )
    db_session.add(empresa)
    db_session.commit()

    # 1. Criar e processar sem planilha de entrada (fica em branco)
    res_create = client.post("/api/v1/solicitacoes", json={
        "empresa_id": empresa.id,
        "periodo_inicio": "2026-01-01",
        "periodo_fim": "2026-01-31",
        "tipo_planilha": "antecipacao_parcial"
    })
    sol_id = res_create.json()["id"]

    res_proc = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol_id}/resultado",
        json={
            "notas_processadas": [
                {
                    "chave_acesso": "29260111222333000181550010000012341000012340",
                    "numero_nota": "1234",
                    "serie": "1",
                    "cnpj_emitente": "11222333000181",
                    "uf_emitente": "SP",
                    "cnpj_destinatario": empresa.cnpj,
                    "uf_destinatario": "BA",
                    "data_emissao": "2026-01-15T10:00:00",
                    "data_entrada": None,
                    "origem_data_entrada": None,
                    "item_numero": 1,
                    "ncm": "72142000",
                    "cfop": "2102",
                    "destino_planilha": "antecipacao_parcial",
                    "v_total": 1000.0,
                    "base_calculo": 1000.0,
                    "ipi_despesas": 0.0,
                    "a_ori": 0.12,
                    "a_dst_resolvida": 0.205,
                    "debito": 205.0,
                    "credito": 120.0,
                    "valor_devido": 85.0,
                    "metadados_extras": {"origem_processamento": "browser"},
                }
            ],
            "saidas": [],
            "notas_ignoradas": [],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
            "mensagem": None,
        },
    )
    assert res_proc.status_code == 200, res_proc.text
    sol_data = res_proc.json()
    assert len(sol_data["notas_processadas"]) == 1
    nota_id = sol_data["notas_processadas"][0]["id"]
    assert sol_data["notas_processadas"][0]["data_entrada"] is None
    assert sol_data["notas_processadas"][0]["origem_data_entrada"] is None

    # 2. Atualizar manualmente a Data de Entrada
    res_patch = client.patch(
        f"/api/v1/solicitacoes/{sol_id}/notas/{nota_id}/data-entrada",
        json={"data_entrada": "2026-01-20"}
    )
    assert res_patch.status_code == 200
    nota_atualizada = res_patch.json()
    assert nota_atualizada["data_entrada"] == "2026-01-20"
    assert nota_atualizada["origem_data_entrada"] == "manual"


def test_planilha_entrada_parser_tsv_prosoft():
    raw_content = (
        "Consulta de Notas Fiscais de Entrada\r\n"
        "Empresa: 0095 - TESTE LTDA\r\n"
        "\r\n"
        "Número Nota\tDt.Escritur.\tSérie\tSubSér\tCFOP\tTerceiro\tUF\tChave da Nota Fiscal Eletrônica\r\n"
        "'0000002610   \t03/08/2026\t'001      \t'\t'1102  \t'44730457000127\tBA\t29260844730457000127550010000026101001791840\r\n"
        "'0000018116   \t05/08/2026\t'006      \t'\t'1202  \t'15157837000469\tBA\t29260833847666000139550060000181161818384800\r\n"
    ).encode("latin1")

    records = PlanilhaEntradaParser.parse(raw_content, "prosoft_entradas.XLS")
    assert len(records) == 2
    r1 = records[0]
    assert r1.numero_normalizado == "2610"
    assert r1.serie_normalizada == "001"
    assert r1.cnpj_emitente_normalizado == "44730457000127"
    assert r1.chave_acesso_normalizada == "29260844730457000127550010000026101001791840"
    assert r1.data_entrada == datetime.date(2026, 8, 3)
    assert r1.cfop_normalizado == "1102"


def test_planilha_entrada_parser_arquivo_real_downloads():
    sample_path = r"c:\Users\Rodrigo\Downloads\exemplo_ENTRADA.XLS"
    if not os.path.exists(sample_path):
        pytest.skip("Arquivo exemplo_ENTRADA.XLS não presente em Downloads")

    with open(sample_path, "rb") as f:
        file_bytes = f.read()

    records = PlanilhaEntradaParser.parse(file_bytes, "exemplo_ENTRADA.XLS")
    assert len(records) == 826

    # Testar correspondência da nota 2610 presente
    dt, origem = DataEntradaMatcher.match_data_entrada(
        nf_chave="29260844730457000127550010000026101001791840",
        nf_cnpj_emitente="44730457000127",
        nf_serie="1",
        nf_numero="2610",
        planilha_records=records,
    )
    assert dt == datetime.date(2026, 8, 3)
    assert origem == "planilha_sistema_contabil"

    # Testar nota ausente (não deve ter entrada confirmada)
    dt_ausente, origem_ausente = DataEntradaMatcher.match_data_entrada(
        nf_chave="31260817718478000154551040028464821000000000",
        nf_cnpj_emitente="99999999000199",
        nf_serie="104",
        nf_numero="2846482",
        planilha_records=records,
    )
    assert dt_ausente is None
    assert origem_ausente is None
