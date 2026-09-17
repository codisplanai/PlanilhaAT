import pytest


@pytest.fixture
def client_operador(client):
    """TestClient autenticado com usuário de role 'operador' (Analista Fiscal)."""
    res = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com",
        "password": "fiscal",
    })
    assert res.status_code == 200, res.text
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    return client


def test_operador_cadastra_e_edita_perfil(client_operador):
    # 1. Operador cadastra novo perfil
    res_create = client_operador.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Criado por Operador",
        "descricao": "Perfil para testes de permissão",
        "configuracoes_extras": {"limitar_aliquota_origem": True},
    })
    assert res_create.status_code == 201, res_create.text
    perfil = res_create.json()
    perfil_id = perfil["id"]
    assert perfil["nome"] == "Perfil Criado por Operador"

    # 2. Operador edita perfil
    res_update = client_operador.put(f"/api/v1/perfis-regras/{perfil_id}", json={
        "nome": "Perfil Editado por Operador",
        "descricao": "Nova descrição",
    })
    assert res_update.status_code == 200
    assert res_update.json()["nome"] == "Perfil Editado por Operador"

    # 3. Operador NÃO pode excluir perfil (403 Forbidden)
    res_delete = client_operador.delete(f"/api/v1/perfis-regras/{perfil_id}")
    assert res_delete.status_code == 403
    assert "exclusiva para o Contador Sênior" in res_delete.json()["detail"]


def test_operador_cadastra_e_edita_empresa(client_operador):
    # Cadastra perfil primeiro
    res_perfil = client_operador.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Para Empresa Operador",
    })
    perfil_id = res_perfil.json()["id"]

    # 1. Operador cadastra empresa (dados semelhantes aos da tela da imagem)
    res_create = client_operador.post("/api/v1/empresas", json={
        "razao_social": "CRIE E BORDE ARMARINHO LTDA",
        "cnpj": "00.867.173/0001-01",
        "inscricao_estadual": "42903840",
        "uf": "BA",
        "perfil_regras_id": perfil_id,
        "ativo": True,
    })
    assert res_create.status_code == 201, res_create.text
    empresa = res_create.json()
    empresa_id = empresa["id"]
    assert empresa["razao_social"] == "CRIE E BORDE ARMARINHO LTDA"
    assert empresa["cnpj"] == "00867173000101"

    # 2. Operador edita empresa
    res_update = client_operador.put(f"/api/v1/empresas/{empresa_id}", json={
        "razao_social": "CRIE E BORDE ARMARINHO LTDA ATUALIZADA",
    })
    assert res_update.status_code == 200
    assert res_update.json()["razao_social"] == "CRIE E BORDE ARMARINHO LTDA ATUALIZADA"

    # 3. Operador define termo de acordo
    res_termo = client_operador.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={
        "aliquota": 0.04,
        "descricao": "Termo especial TARE",
    })
    assert res_termo.status_code == 200
    assert res_termo.json()["aliquota"] == 0.04

    # 4. Operador NÃO pode remover termo de acordo (403 Forbidden)
    res_del_termo = client_operador.delete(f"/api/v1/empresas/{empresa_id}/termo-acordo")
    assert res_del_termo.status_code == 403

    # 5. Operador NÃO pode excluir empresa (403 Forbidden)
    res_delete = client_operador.delete(f"/api/v1/empresas/{empresa_id}")
    assert res_delete.status_code == 403
    assert "exclusiva para o Contador Sênior" in res_delete.json()["detail"]


def test_operador_cadastra_e_edita_regras_aliquotas(client_operador):
    res_perfil = client_operador.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Aliquotas Operador",
    })
    perfil_id = res_perfil.json()["id"]

    # 1. Operador cria regra de alíquota padrão
    res_create = client_operador.post("/api/v1/regras-aliquotas", json={
        "perfil_regras_id": perfil_id,
        "uf": "BA",
        "aliquota": 0.205,
        "descricao": "Alíquota interna BA 20.5%",
    })
    assert res_create.status_code == 201, res_create.text
    regra_id = res_create.json()["id"]

    # 2. Operador edita regra de alíquota
    res_update = client_operador.put(f"/api/v1/regras-aliquotas/{regra_id}", json={
        "aliquota": 0.19,
    })
    assert res_update.status_code == 200
    assert res_update.json()["aliquota"] == 0.19

    # 3. Operador NÃO pode excluir regra de alíquota (403 Forbidden)
    res_del = client_operador.delete(f"/api/v1/regras-aliquotas/{regra_id}")
    assert res_del.status_code == 403


def test_operador_cadastra_e_edita_regras_cfop(client_operador):
    res_perfil = client_operador.post("/api/v1/perfis-regras", json={
        "nome": "Perfil CFOP Operador",
    })
    perfil_id = res_perfil.json()["id"]

    # 1. Operador cria regra de CFOP
    res_create = client_operador.post("/api/v1/regras-cfop", json={
        "perfil_regras_id": perfil_id,
        "cfop_sufixo": "102",
        "destino": "antecipacao_parcial",
        "descricao": "Roteamento para parcial",
    })
    assert res_create.status_code == 201, res_create.text
    regra_id = res_create.json()["id"]

    # 2. Operador edita regra de CFOP
    res_update = client_operador.put(f"/api/v1/regras-cfop/{regra_id}", json={
        "destino": "antecipacao_tributaria",
    })
    assert res_update.status_code == 200
    assert res_update.json()["destino"] == "antecipacao_tributaria"

    # 3. Operador NÃO pode excluir regra de CFOP (403 Forbidden)
    res_del = client_operador.delete(f"/api/v1/regras-cfop/{regra_id}")
    assert res_del.status_code == 403


def test_operador_cadastra_e_edita_regras_reducao_e_reclassificacao(client_operador):
    res_perfil = client_operador.post("/api/v1/perfis-regras", json={
        "nome": "Perfil Reducao e Reclassif Operador",
    })
    perfil_id = res_perfil.json()["id"]

    # 1. Regra de redução de produto
    res_red = client_operador.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id,
        "ncm": "72142000",
        "termos_inclusao": ["vergalhao", "ferro"],
        "aliquota": 0.04,
        "descricao": "Redução cesta",
    })
    assert res_red.status_code == 201, res_red.text
    red_id = res_red.json()["id"]

    # Operador edita regra de redução
    res_red_up = client_operador.put(f"/api/v1/regras-reducao-produto/{red_id}", json={
        "aliquota": 0.07,
    })
    assert res_red_up.status_code == 200
    assert res_red_up.json()["aliquota"] == 0.07

    # Operador cria exceção
    res_exc = client_operador.post(f"/api/v1/regras-reducao-produto/{red_id}/excecoes", json={
        "descricao_exata": "Vergalhao Especial CA-50",
        "enquadrado": True,
    })
    assert res_exc.status_code == 201

    # Operador NÃO pode excluir regra de redução
    assert client_operador.delete(f"/api/v1/regras-reducao-produto/{red_id}").status_code == 403

    # 2. Regra de reclassificação CFOP
    res_rec = client_operador.post("/api/v1/regras-reclassificacao-cfop", json={
        "perfil_regras_id": perfil_id,
        "ncm": "84713012",
        "cfop_origem_sufixo": "102",
        "cfop_destino_sufixo": "403",
        "termos_inclusao": ["notebook"],
        "descricao": "Reclassificação ST",
    })
    assert res_rec.status_code == 201, res_rec.text
    rec_id = res_rec.json()["id"]

    # Operador edita regra de reclassificação
    res_rec_up = client_operador.put(f"/api/v1/regras-reclassificacao-cfop/{rec_id}", json={
        "cfop_destino_sufixo": "405",
    })
    assert res_rec_up.status_code == 200
    assert res_rec_up.json()["cfop_destino_sufixo"] == "405"

    # Operador cria exceção
    res_rec_exc = client_operador.post(f"/api/v1/regras-reclassificacao-cfop/{rec_id}/excecoes", json={
        "descricao_exata": "Notebook Gamer X",
        "aplicar": True,
    })
    assert res_rec_exc.status_code == 201

    # Operador NÃO pode excluir regra de reclassificação
    assert client_operador.delete(f"/api/v1/regras-reclassificacao-cfop/{rec_id}").status_code == 403
