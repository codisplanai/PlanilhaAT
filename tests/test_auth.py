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
