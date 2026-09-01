def test_auth_login_sucesso(client):
    res = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "admin"
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "admin@contabilidade.com"
    assert data["user"]["cargo"] == "Contador Sênior"

def test_auth_login_senha_invalida(client):
    res = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "wrongpassword"
    })
    assert res.status_code == 401
    assert "E-mail ou senha incorretos" in res.json()["detail"]

def test_auth_get_me(client):
    login_res = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "admin"
    })
    token = login_res.json()["access_token"]

    me_res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "admin@contabilidade.com"


def test_token_local_forjado_nao_e_aceito(client):
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer pat_token_forjado"},
    )
    assert response.status_code == 401


def test_logout_revoga_token_local(client):
    login = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com",
        "password": "fiscal",
    })
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_crud_exige_autenticacao(client):
    response = client.get("/api/v1/empresas", headers={"Authorization": ""})
    assert response.status_code == 401
