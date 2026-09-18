def test_contexto_processamento_local_disponibiliza_regras_sem_arquivo(client, cenario_janeiro):
    sol = cenario_janeiro()

    response = client.get(
        "/api/v1/processamento-local/contexto",
        params={"empresa_id": sol.empresa_id},
    )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["empresa"]["id"] == sol.empresa_id
    assert data["empresa"]["perfil_regras_id"] == data["perfil"]["id"]
    assert isinstance(data["regras_aliquotas"], list)
    assert isinstance(data["regras_cfop"], list)
    assert isinstance(data["regras_reducao"], list)
    assert isinstance(data["regras_reclassificacao"], list)
    assert isinstance(data["regras_exclusao_parcial"], list)
    assert isinstance(data["templates_ativos"], list)
    assert isinstance(data["mva_anexo"], list)


def test_contexto_processamento_local_empresa_inexistente(client):
    response = client.get(
        "/api/v1/processamento-local/contexto",
        params={"empresa_id": 99999999},
    )
    assert response.status_code == 404
