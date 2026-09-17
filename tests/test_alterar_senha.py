import pytest
from app.models.profile import Profile
from app.services.supabase_admin import SupabaseAdminService


def test_alterar_senha_sem_autenticacao(client):
    client.headers.pop("Authorization", None)
    res = client.post("/api/v1/auth/alterar-senha", json={
        "senha_atual": "admin123",
        "nova_senha": "novaSenha123"
    })
    assert res.status_code == 401


def test_alterar_senha_senha_atual_incorreta(client):
    res = client.post("/api/v1/auth/alterar-senha", json={
        "senha_atual": "senha_totalmente_errada",
        "nova_senha": "novaSenha123"
    })
    assert res.status_code == 400
    assert "incorreta" in res.json()["detail"].lower()


def test_alterar_senha_nova_senha_curta(client):
    res = client.post("/api/v1/auth/alterar-senha", json={
        "senha_atual": "admin",
        "nova_senha": "123"
    })
    assert res.status_code == 422


def test_alterar_senha_nova_senha_igual_atual(client):
    res = client.post("/api/v1/auth/alterar-senha", json={
        "senha_atual": "minhasenha123",
        "nova_senha": "minhasenha123"
    })
    assert res.status_code == 400
    assert "diferente" in res.json()["detail"].lower()


def test_alterar_senha_sucesso_local_auth(client):
    # Altera de 'admin' para 'novaSenhaForte123'
    res = client.post("/api/v1/auth/alterar-senha", json={
        "senha_atual": "admin",
        "nova_senha": "novaSenhaForte123"
    })
    assert res.status_code == 200
    assert "sucesso" in res.json()["message"].lower()

    # Tenta logar com a nova senha
    res_login = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "novaSenhaForte123"
    })
    assert res_login.status_code == 200
    assert "access_token" in res_login.json()

    # Restaura senha 'admin' para os demais testes
    from app.api.endpoints.auth import USERS_DB
    USERS_DB["admin@contabilidade.com"]["password"] = "admin"
    USERS_DB["admin@contabilidade.com"]["valid_passwords"].add("admin")


def test_alterar_senha_supabase_mock(client, monkeypatch):
    # Simula Supabase configurado
    monkeypatch.setattr(
        "app.core.config.settings.SUPABASE_URL", "https://mock.supabase.co"
    )
    monkeypatch.setattr(
        "app.core.config.settings.SUPABASE_KEY", "mock-anon-key"
    )
    monkeypatch.setattr(
        "app.core.config.settings.SUPABASE_SERVICE_ROLE_KEY", "mock-service-key"
    )

    chamadas_update = []

    def mock_update_password(user_id: str, new_password: str):
        chamadas_update.append((user_id, new_password))

    monkeypatch.setattr(SupabaseAdminService, "update_password", mock_update_password)

    class MockSupabaseClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

        def post(self, url, **kwargs):
            class MockResponse:
                status_code = 200
                def json(self):
                    return {"access_token": "mock-token", "user": {"id": "mock-id"}}
            return MockResponse()

    monkeypatch.setattr("app.api.endpoints.auth.httpx.Client", MockSupabaseClient)

    res = client.post("/api/v1/auth/alterar-senha", json={
        "senha_atual": "admin",
        "nova_senha": "novaSenhaSupabase99"
    })
    assert res.status_code == 200
    assert len(chamadas_update) == 1
    assert chamadas_update[0][1] == "novaSenhaSupabase99"
