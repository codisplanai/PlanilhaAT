def test_rotas_legacy_de_upload_fiscal_nao_existem(client, cenario_janeiro):
    sol = cenario_janeiro()

    payloads = [
        (
            f"/api/v1/solicitacoes/{sol.id}/pre-analisar",
            {"files": ("nota.xml", b"<xml/>", "application/xml")},
        ),
        (
            f"/api/v1/solicitacoes/{sol.id}/processar",
            {"sped_file": ("sped.txt", b"|0000|", "text/plain")},
        ),
    ]

    for url, files in payloads:
        response = client.post(url, files=files)
        assert response.status_code in {404, 405}, response.text

    response = client.get(f"/api/v1/solicitacoes/{sol.id}/download")
    assert response.status_code in {404, 405}, response.text


def test_resultado_local_rejeita_conteudo_bruto(client, cenario_janeiro):
    sol = cenario_janeiro()

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json={
            "notas_processadas": [],
            "saidas": [],
            "notas_ignoradas": [],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
            "xml": "<NFe>conteudo-bruto-proibido</NFe>",
        },
    )
    assert response.status_code == 422, response.text


def test_resultado_local_rejeita_multipart(client, cenario_janeiro):
    sol = cenario_janeiro()

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        files={"file": ("nota.xml", b"<xml/>", "application/xml")},
    )
    assert response.status_code == 422, response.text


def test_resultado_local_aceita_apenas_json_estruturado(client, cenario_janeiro):
    sol = cenario_janeiro()

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json={
            "notas_processadas": [],
            "saidas": [],
            "notas_ignoradas": [],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
            "mensagem": "Processamento local sem itens a persistir.",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "concluido"
    assert data["arquivo_saida_path"] is None
    assert data["total_notas_processadas"] == 0


def test_resultado_local_aceita_nome_do_arquivo_como_metadado(client, cenario_janeiro):
    """Regressão: o nome diagnóstico não pode ser confundido com o conteúdo fiscal."""
    sol = cenario_janeiro()

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json={
            "notas_processadas": [],
            "saidas": [],
            "notas_ignoradas": [{
                "numero_nota": "Não identificado",
                "motivo": "XML inválido.",
                "arquivo": "nota_001.xml",
            }],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["notas_ignoradas"][0]["arquivo"] == "nota_001.xml"


def test_resultado_local_rejeita_conteudo_bruto_disfarcado_de_arquivo(client, cenario_janeiro):
    sol = cenario_janeiro()

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json={
            "notas_processadas": [],
            "saidas": [],
            "notas_ignoradas": [{
                "numero_nota": "Não identificado",
                "motivo": "Entrada inválida.",
                "arquivo": "<nfeProc>conteudo fiscal</nfeProc>",
            }],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
        },
    )

    assert response.status_code == 422, response.text


def test_contexto_local_nao_contem_arquivo_fiscal(client, cenario_janeiro):
    sol = cenario_janeiro()

    response = client.get(
        "/api/v1/processamento-local/contexto",
        params={"empresa_id": sol.empresa_id},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    serialized = str(data).lower()

    assert "xml_content" not in serialized
    assert "sped_file" not in serialized
    assert "arquivo_bytes" not in serialized
    assert data["empresa"]["id"] == sol.empresa_id
