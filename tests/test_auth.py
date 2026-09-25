import pytest
from sqlalchemy import Uuid, select
from sqlalchemy.dialects import postgresql

from app.models.profile import Profile
from app.models.solicitacao import Solicitacao


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


# --- Provisionamento de contas conhecidas via Supabase Auth -------------------
# Regressão: contas institucionais autenticadas pelo Supabase eram provisionadas
# com cargo/role padrão de operador, ignorando o mapa de contas conhecidas.

SUPABASE_UID_CODISPLAN = "d7a327b5-7959-47ac-afc8-1850430f0b12"


class _FakeSupabaseResponse:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeSupabaseClient:
    """Simula o Supabase Auth aceitando as credenciais enviadas."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, json=None, headers=None):
        return _FakeSupabaseResponse({
            "access_token": "sb_access_token_fake",
            "user": {
                "id": SUPABASE_UID_CODISPLAN,
                "email": json["email"],
                "user_metadata": {},
            },
        })


@pytest.fixture
def supabase_auth_ativo(monkeypatch):
    from app.api.endpoints import auth as auth_module
    from app.core.config import settings

    monkeypatch.setattr(settings, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "fake-anon-key")
    monkeypatch.setattr(auth_module.httpx, "Client", _FakeSupabaseClient)


def test_login_supabase_provisiona_conta_conhecida_como_contador_senior(
    client, db_session, supabase_auth_ativo
):
    res = client.post("/api/v1/auth/login", json={
        "email": "admin@codisplan.com",
        "password": "qualquer-senha-validada-pelo-supabase",
    })

    assert res.status_code == 200, res.text
    user = res.json()["user"]
    assert user["cargo"] == "Contador Sênior"
    assert user["role"] == "admin"

    perfil = db_session.query(Profile).filter(
        Profile.id == SUPABASE_UID_CODISPLAN
    ).first()
    assert perfil is not None
    assert perfil.cargo == "Contador Sênior"
    assert perfil.role == "admin"


def test_login_supabase_corrige_perfil_conhecido_provisionado_errado(
    client, db_session, supabase_auth_ativo
):
    # Estado exato encontrado em produção: perfil já gravado como operador.
    db_session.add(Profile(
        id=SUPABASE_UID_CODISPLAN,
        email="admin@codisplan.com",
        nome="admin",
        cargo="Analista Fiscal",
        role="operador",
        ativo=True,
    ))
    db_session.commit()

    res = client.post("/api/v1/auth/login", json={
        "email": "admin@codisplan.com",
        "password": "qualquer-senha-validada-pelo-supabase",
    })

    assert res.status_code == 200, res.text
    user = res.json()["user"]
    assert user["cargo"] == "Contador Sênior"
    assert user["role"] == "admin"

    perfil = db_session.query(Profile).filter(
        Profile.id == SUPABASE_UID_CODISPLAN
    ).first()
    assert perfil.cargo == "Contador Sênior"
    assert perfil.role == "admin"
    # O nome placeholder derivado do e-mail também é substituído.
    assert perfil.nome == "Contador Responsável"


def test_login_supabase_conta_desconhecida_continua_operador(
    client, db_session, supabase_auth_ativo
):
    res = client.post("/api/v1/auth/login", json={
        "email": "novato@codisplan.com",
        "password": "qualquer-senha-validada-pelo-supabase",
    })

    assert res.status_code == 200, res.text
    user = res.json()["user"]
    assert user["cargo"] == "Analista Fiscal"
    assert user["role"] == "operador"


def test_ids_de_autenticacao_usam_uuid_no_postgresql():
    """Evita regressão uuid = varchar ao consultar perfis no Supabase/Postgres."""
    assert isinstance(Profile.__table__.c.id.type, Uuid)
    assert Profile.__table__.c.id.type.as_uuid is False
    assert isinstance(Solicitacao.__table__.c.usuario_id.type, Uuid)
    assert Solicitacao.__table__.c.usuario_id.type.as_uuid is False

    stmt = select(Profile).where(Profile.id == SUPABASE_UID_CODISPLAN)
    compiled = stmt.compile(dialect=postgresql.dialect())
    typed_binds = [bind.type for bind in compiled.binds.values()]
    assert any(isinstance(bind_type, Uuid) for bind_type in typed_binds)
