def test_fluxo_estruturado_end_to_end_sem_upload(client, cenario_janeiro):
    sol = cenario_janeiro()

    result = {
        "notas_processadas": [
            {
                "chave_acesso": "29260112345678000195550010000009011000009010",
                "numero_nota": "901",
                "serie": "1",
                "cnpj_emitente": "11222333000181",
                "uf_emitente": "SP",
                "cnpj_destinatario": "12345678000195",
                "uf_destinatario": "BA",
                "data_emissao": "2026-01-15T10:00:00",
                "data_entrada": "2026-01-16",
                "origem_data_entrada": "sped_fiscal",
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
        "saidas": [
            {
                "tipo": "antecipacao_parcial",
                "template_id": None,
                "total_notas": 1,
                "total_valor_devido": 85.0,
                "aviso": None,
            }
        ],
        "notas_ignoradas": [],
        "itens_excluidos": [],
        "avisos_avaliacao": [],
        "cfops_sem_regra": {},
        "mensagem": None,
    }

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json=result,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "concluido"
    assert data["arquivo_saida_path"] is None
    assert data["total_notas_processadas"] == 1
    assert len(data["notas_processadas"]) == 1
    assert data["notas_processadas"][0]["numero_nota"] == "901"
    assert data["notas_processadas"][0]["valor_devido"] == 85.0
    assert len(data["saidas"]) == 1
    assert data["saidas"][0]["arquivo_path"] is None

    history = client.get(f"/api/v1/solicitacoes/{sol.id}")
    assert history.status_code == 200, history.text
    history_data = history.json()
    assert history_data["notas_processadas"][0]["metadados_extras"]["origem_processamento"] == "browser"

    legacy_download = client.get(f"/api/v1/solicitacoes/{sol.id}/download")
    assert legacy_download.status_code in {404, 405}


def test_resultado_estruturado_substitui_execucao_anterior(client, cenario_janeiro):
    sol = cenario_janeiro()

    payload = {
        "notas_processadas": [],
        "saidas": [],
        "notas_ignoradas": [],
        "itens_excluidos": [],
        "avisos_avaliacao": [],
        "cfops_sem_regra": {},
        "mensagem": "Nenhum item a recolher na Parcial",
    }
    first = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json=payload,
    )
    assert first.status_code == 200, first.text

    second = client.post(
        f"/api/v1/processamento-local/solicitacoes/{sol.id}/resultado",
        json=payload,
    )
    assert second.status_code == 200, second.text
    assert second.json()["mensagem_erro"] == "Nenhum item a recolher na Parcial"
