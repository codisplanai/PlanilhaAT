import io
import json
import openpyxl
from decimal import Decimal
from datetime import datetime, date

def test_regra_interestadual_xml_filtra_operacao_interna(client, sample_xml_nfe, create_sample_excel_template):
    """
    Testa a regra fundamental: apenas notas fiscais emitidas por fornecedores/terceiros
    de UF diferente da empresa cliente devem ser consideradas.
    Notas com a mesma UF do cliente (operações internas) são ignoradas e registradas.
    """
    # 1. Setup Perfil e Empresa Cliente na Bahia (UF: BA)
    res_perfil = client.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Teste UF Interestadual XML",
        "configuracoes_extras": {}
    })
    perfil_id = res_perfil.json()["id"]

    client.post("/api/v1/regras-aliquotas", json={
        "perfil_regras_id": perfil_id,
        "uf": "BA",
        "ncm": None,
        "aliquota": 0.205,
        "descricao": "Padrão BA"
    })

    res_empresa = client.post("/api/v1/empresas", json={
        "razao_social": "EMPRESA CLIENTE BAHIA LTDA",
        "cnpj": "12.345.678/0001-95",
        "uf": "BA",
        "perfil_regras_id": perfil_id,
        "ativo": True
    })
    empresa_id = res_empresa.json()["id"]

    # 2. Template
    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        template_bytes = f.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        }
    }

    client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "antecipacao_parcial",
            "mapeamento_json": json.dumps(mapping),
            "observacoes": "Template UF",
            "promover_ativo": True
        },
        files={
            "file": ("template_uf.xlsx", template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
    )

    # 3. XML 1: Fornecedor de São Paulo (UF: SP -> Cliente BA) -> Válida Interestadual
    xml_sp = sample_xml_nfe # Emitente SP, Destinatário BA, NF 1234

    # 4. XML 2: Fornecedor da Bahia (UF: BA -> Cliente BA) -> Operação Interna (Deve ser ignorada!)
    xml_ba = sample_xml_nfe.decode("utf-8")
    xml_ba = xml_ba.replace("<nNF>1234</nNF>", "<nNF>8888</nNF>")
    xml_ba = xml_ba.replace("<UF>SP</UF>", "<UF>BA</UF>")
    xml_ba = xml_ba.replace("<cUF>35</cUF>", "<cUF>29</cUF>")
    xml_ba = xml_ba.replace('Id="NFe35', 'Id="NFe29')
    xml_ba_bytes = xml_ba.encode("utf-8")

    # 5. Criar solicitação
    res_solic = client.post("/api/v1/solicitacoes", json={
        "empresa_id": empresa_id,
        "periodo_inicio": "2026-01-01",
        "periodo_fim": "2026-01-31",
        "tipo_planilha": "antecipacao_parcial"
    })
    solic_id = res_solic.json()["id"]

    # 6. Processar ambos os XMLs
    res_proc = client.post(
        f"/api/v1/solicitacoes/{solic_id}/processar",
        files=[
            ("files", ("nfe_sp_1234.xml", xml_sp, "text/xml")),
            ("files", ("nfe_ba_8888.xml", xml_ba_bytes, "text/xml")),
        ]
    )
    assert res_proc.status_code == 200, res_proc.text
    dados = res_proc.json()

    # Validações do resultado
    assert dados["status"] == "concluido"
    assert dados["total_notas_processadas"] == 1
    assert dados["notas_processadas"][0]["numero_nota"] == "1234"
    assert dados["notas_processadas"][0]["uf_emitente"] == "SP"
    assert dados["notas_processadas"][0]["uf_destinatario"] == "BA"

    # Nota 8888 deve constar em notas_ignoradas com justificativa de operação interna
    assert len(dados["notas_ignoradas"]) == 1
    ign = dados["notas_ignoradas"][0]
    assert ign["numero_nota"] == "8888"
    assert "Operação interna estadual desconsiderada" in ign["motivo"]
    assert "UF do fornecedor/emitente (BA) é igual à UF da empresa (BA)" in ign["motivo"]


def test_regra_interestadual_sped_fiscal(client, create_sample_excel_template):
    """
    Testa a regra fundamental com SPED Fiscal: participantes com mesma UF da empresa
    são ignorados, enquanto participantes de outras UFs são processados.
    """
    # 1. Setup Perfil e Empresa Cliente na Bahia (UF: BA)
    res_perfil = client.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Teste UF Interestadual SPED",
        "configuracoes_extras": {}
    })
    perfil_id = res_perfil.json()["id"]

    client.post("/api/v1/regras-aliquotas", json={
        "perfil_regras_id": perfil_id,
        "uf": "BA",
        "ncm": None,
        "aliquota": 0.205,
        "descricao": "Padrão BA"
    })

    res_empresa = client.post("/api/v1/empresas", json={
        "razao_social": "EMPRESA SPED BAHIA LTDA",
        "cnpj": "12.345.678/0001-95",
        "uf": "BA",
        "perfil_regras_id": perfil_id,
        "ativo": True
    })
    empresa_id = res_empresa.json()["id"]

    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        template_bytes = f.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        }
    }

    client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "antecipacao_parcial",
            "mapeamento_json": json.dumps(mapping),
            "observacoes": "Template UF",
            "promover_ativo": True
        },
        files={
            "file": ("template_uf_sped.xlsx", template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
    )

    # 2. SPED contendo:
    # - FORN_SP (SP, COD_MUN 3550308) -> NF 1001 (Interestadual SP -> BA) -> Deve ser PROCESSADA
    # - FORN_BA (BA, COD_MUN 2927408) -> NF 2002 (Interna BA -> BA) -> Deve ser IGNORADA
    sped_content = """|0000|019|0|01012026|31012026|EMPRESA SPED BAHIA LTDA|12345678000195||BA|123456789|2927408|||A|1|
|0150|FORN_SP|FORNECEDOR SAO PAULO LTDA|1058|98765432000180||SP|3550308||RUA SP|100||CENTRO|
|0150|FORN_BA|FORNECEDOR SALVADOR LTDA|1058|55443322000199||BA|2927408||AVENIDA BA|200||CENTRO|
|0200|PROD01|NOTEBOOK|||UN|01|84713012|||18,00||
|C100|0|1|FORN_SP|55|00|1|1001|35260198765432000180550010000010011000123456|10012026|15012026|5000,00|0|0,00|0,00|5000,00|0|0,00|0,00|0,00|5000,00|600,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|PROD01|NOTEBOOK|1,000|UN|5000,00|0,00|0|000|6102||5000,00|12,00|600,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|C100|0|1|FORN_BA|55|00|1|2002|29260155443322000199550010000020021000654321|18012026|20012026|3000,00|0|0,00|0,00|3000,00|0|0,00|0,00|0,00|3000,00|540,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|PROD01|NOTEBOOK|1,000|UN|3000,00|0,00|0|000|5102||3000,00|18,00|540,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|9|
"""

    res_solic = client.post("/api/v1/solicitacoes", json={
        "empresa_id": empresa_id,
        "periodo_inicio": "2026-01-01",
        "periodo_fim": "2026-01-31",
        "tipo_planilha": "antecipacao_parcial"
    })
    solic_id = res_solic.json()["id"]

    res_proc = client.post(
        f"/api/v1/solicitacoes/{solic_id}/processar",
        files={
            "sped_file": ("sped_fiscal.txt", sped_content.encode("utf-8"), "text/plain")
        }
    )
    assert res_proc.status_code == 200, res_proc.text
    dados = res_proc.json()

    assert dados["total_notas_processadas"] == 1
    assert dados["notas_processadas"][0]["numero_nota"] == "1001"
    assert dados["notas_processadas"][0]["uf_emitente"] == "SP"

    assert len(dados["notas_ignoradas"]) == 1
    assert dados["notas_ignoradas"][0]["numero_nota"] == "2002"
    assert "Operação interna estadual desconsiderada" in dados["notas_ignoradas"][0]["motivo"]


def test_todas_notas_mesma_uf_retorna_erro_amigavel(client, sample_xml_nfe, create_sample_excel_template):
    """
    Se todos os documentos enviados forem de mesma UF (operações internas),
    o sistema deve retornar erro 400 explicativo.
    """
    res_perfil = client.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Teste Todas Internas",
        "configuracoes_extras": {}
    })
    perfil_id = res_perfil.json()["id"]

    client.post("/api/v1/regras-aliquotas", json={
        "perfil_regras_id": perfil_id,
        "uf": "BA",
        "ncm": None,
        "aliquota": 0.205,
        "descricao": "Padrão"
    })

    res_empresa = client.post("/api/v1/empresas", json={
        "razao_social": "EMPRESA APENAS INTERNA LTDA",
        "cnpj": "12.345.678/0001-95",
        "uf": "BA",
        "perfil_regras_id": perfil_id,
        "ativo": True
    })
    empresa_id = res_empresa.json()["id"]

    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        template_bytes = f.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        }
    }

    client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "antecipacao_parcial",
            "mapeamento_json": json.dumps(mapping),
            "observacoes": "Template",
            "promover_ativo": True
        },
        files={
            "file": ("template_internas.xlsx", template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
    )

    # XML com emitente BA (mesma UF da empresa BA)
    xml_ba = sample_xml_nfe.decode("utf-8")
    xml_ba = xml_ba.replace("<UF>SP</UF>", "<UF>BA</UF>")
    xml_ba = xml_ba.replace("<cUF>35</cUF>", "<cUF>29</cUF>")
    xml_ba_bytes = xml_ba.encode("utf-8")

    res_solic = client.post("/api/v1/solicitacoes", json={
        "empresa_id": empresa_id,
        "periodo_inicio": "2026-01-01",
        "periodo_fim": "2026-01-31",
        "tipo_planilha": "antecipacao_parcial"
    })
    solic_id = res_solic.json()["id"]

    res_proc = client.post(
        f"/api/v1/solicitacoes/{solic_id}/processar",
        files=[
            ("files", ("nfe_ba_1234.xml", xml_ba_bytes, "text/xml")),
        ]
    )
    assert res_proc.status_code == 400
    assert "Nenhuma NF-e válida para apuração interestadual" in res_proc.json()["detail"]
