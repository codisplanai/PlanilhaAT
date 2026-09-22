"""Renovação de sessão: o refresh token vive em cookie httpOnly, nunca no corpo.

O access token do Supabase expira em 1h e nada o renovava: o usuário caía na
tela de login no meio do trabalho. Estes testes fixam o contrato do ciclo
login → refresh → logout.
"""

import pytest

from app.models.profile import Profile


SUPABASE_UID = "d7a327b5-7959-47ac-afc8-1850430f0b12"
REFRESH_COOKIE = "planaut_refresh"


class _FakeSupabaseResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeSupabaseAuth:
    """Simula o Supabase Auth nos dois grant types, com rotação do refresh."""

    recusar_refresh = False

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    revogados = []

    def post(self, url, json=None, headers=None):
        if url.endswith("/auth/v1/logout"):
            type(self).revogados.append(json["refresh_token"])
            return _FakeSupabaseResponse({}, status_code=204)

        if "grant_type=refresh_token" in url:
            if type(self).recusar_refresh:
                return _FakeSupabaseResponse({"error": "invalid_grant"}, status_code=400)
            recebido = json["refresh_token"]
            return _FakeSupabaseResponse({
                "access_token": f"access_apos_{recebido}",
                "refresh_token": f"rotacionado_de_{recebido}",
                "expires_in": 3600,
                "user": {"id": SUPABASE_UID, "email": "admin@codisplan.com"},
            })

        return _FakeSupabaseResponse({
            "access_token": "access_do_login",
            "refresh_token": "refresh_do_login",
            "expires_in": 3600,
            "user": {
                "id": SUPABASE_UID,
                "email": json["email"],
                "user_metadata": {},
            },
        })


@pytest.fixture
def supabase_auth(monkeypatch):
    from app.api.endpoints import auth as auth_module
    from app.core.config import settings

    monkeypatch.setattr(settings, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "fake-anon-key")
    monkeypatch.setattr(auth_module.httpx, "Client", _FakeSupabaseAuth)
    _FakeSupabaseAuth.recusar_refresh = False
    _FakeSupabaseAuth.revogados = []
    yield
    _FakeSupabaseAuth.recusar_refresh = False


def _login(client):
    return client.post("/api/v1/auth/login", json={
        "email": "admin@codisplan.com",
        "password": "senha-validada-pelo-supabase",
    })


def test_login_entrega_o_refresh_token_em_cookie_e_nunca_no_corpo(client, supabase_auth):
    res = _login(client)

    assert res.status_code == 200, res.text
    corpo = res.json()
    assert corpo["access_token"] == "access_do_login"
    assert corpo["expires_in"] == 3600
    # O refresh token é a credencial de longa duração: se ele chega ao corpo,
    # chega ao JavaScript, e o cookie httpOnly perde a razão de existir.
    assert "refresh_token" not in corpo

    cookie = res.cookies.get(REFRESH_COOKIE)
    assert cookie == "refresh_do_login"


def test_cookie_de_sessao_e_httponly_e_restrito_as_rotas_de_auth(client, supabase_auth):
    res = _login(client)

    set_cookie = res.headers["set-cookie"]
    # httpOnly é o que tira a credencial do alcance de um XSS.
    assert "HttpOnly" in set_cookie
    # SameSite=Lax bloqueia POST cross-site, que é o que dispensa token CSRF.
    assert "SameSite=lax" in set_cookie.replace("samesite=lax", "SameSite=lax")
    # Path restrito: o cookie não viaja junto das ~100 rotas de negócio.
    assert "Path=/api/v1/auth" in set_cookie


def test_cookie_e_marcado_secure_sob_https(db_session, supabase_auth):
    from fastapi.testclient import TestClient

    from app.core.database import get_db
    from app.main import app

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, base_url="https://testserver") as https_client:
            res = _login(https_client)
    finally:
        app.dependency_overrides.clear()

    # Em http (testes e dev) o atributo é omitido, senão o cookie nunca
    # retornaria; sob https ele é obrigatório.
    assert "Secure" in res.headers["set-cookie"]


def test_refresh_troca_o_cookie_por_um_access_token_novo(client, supabase_auth):
    _login(client)

    res = client.post("/api/v1/auth/refresh")

    assert res.status_code == 200, res.text
    corpo = res.json()
    assert corpo["access_token"] == "access_apos_refresh_do_login"
    assert corpo["user"]["email"] == "admin@codisplan.com"
    assert "refresh_token" not in corpo


def test_refresh_grava_o_token_rotacionado_no_cookie(client, supabase_auth):
    _login(client)

    res = client.post("/api/v1/auth/refresh")

    # O Supabase rotaciona o refresh a cada uso e invalida o anterior. Guardar o
    # token antigo faria a renovação seguinte ser recusada como reuso.
    assert res.cookies.get(REFRESH_COOKIE) == "rotacionado_de_refresh_do_login"


def test_refresh_sem_cookie_responde_401(client, supabase_auth):
    client.cookies.clear()

    res = client.post("/api/v1/auth/refresh")

    assert res.status_code == 401, res.text


def test_refresh_recusado_pelo_supabase_responde_401_e_limpa_o_cookie(client, supabase_auth):
    _login(client)
    _FakeSupabaseAuth.recusar_refresh = True

    res = client.post("/api/v1/auth/refresh")

    assert res.status_code == 401, res.text
    # Sem limpar, o navegador reenviaria para sempre um cookie já inválido.
    assert client.cookies.get(REFRESH_COOKIE) in (None, "")


def test_usuario_desativado_para_de_renovar_na_hora(client, db_session, supabase_auth):
    _login(client)
    perfil = db_session.query(Profile).filter(Profile.id == SUPABASE_UID).first()
    perfil.ativo = False
    db_session.commit()

    res = client.post("/api/v1/auth/refresh")

    # O perfil é relido do banco a cada renovação: quem foi desativado perde o
    # acesso imediatamente, em vez de sobreviver até o access token vencer.
    assert res.status_code == 403, res.text


def test_logout_limpa_o_cookie_de_sessao(client, supabase_auth):
    _login(client)
    # Sem esta âncora o teste passaria de forma vazia: antes da implementação
    # não existe cookie algum, e "não há cookie após o logout" seria trivial.
    assert client.cookies.get(REFRESH_COOKIE) == "refresh_do_login"

    res = client.post("/api/v1/auth/logout")

    assert res.status_code == 204, res.text
    assert client.cookies.get(REFRESH_COOKIE) in (None, "")

    # E a sessão precisa estar realmente encerrada, não só o cookie sumido:
    # o refresh token é revogado no Supabase, então uma cópia dele não serve.
    assert _FakeSupabaseAuth.revogados == ["refresh_do_login"]
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_fallback_local_tambem_renova_pelo_cookie(client):
    """O caminho de desenvolvimento mantém um único fluxo no frontend."""
    res = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "admin",
    })
    assert res.status_code == 200, res.text
    assert res.cookies.get(REFRESH_COOKIE)

    renovado = client.post("/api/v1/auth/refresh")

    assert renovado.status_code == 200, renovado.text
    assert renovado.json()["access_token"].startswith("pat_")
    assert renovado.json()["user"]["email"] == "admin@contabilidade.com"
