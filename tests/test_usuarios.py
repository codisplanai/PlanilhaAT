import pytest

from app.models.profile import Profile

NOVO_UUID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def supabase_admin_fake(monkeypatch):
    """Substitui a Admin API. Registra as chamadas para as asserções."""
    from app.api.endpoints import usuarios as usuarios_module

    chamadas = {"create": [], "delete": []}

    def fake_create(email, password, nome):
        chamadas["create"].append({"email": email, "password": password, "nome": nome})
        return NOVO_UUID

    def fake_delete(user_id):
        chamadas["delete"].append(user_id)

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "create_user", staticmethod(fake_create)
    )
    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "delete_user", staticmethod(fake_delete)
    )
    return chamadas


@pytest.fixture
def client_operador(client):
    """Mesmo TestClient, autenticado como operador."""
    res = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com", "password": "fiscal",
    })
    assert res.status_code == 200, res.text
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    return client


def test_operador_nao_cria_usuario(client_operador, supabase_admin_fake):
    res = client_operador.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 403
    assert supabase_admin_fake["create"] == []


def test_admin_cria_operador(client, db_session, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria Souza", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 201, res.text
    corpo = res.json()
    assert corpo["cargo"] == "Analista Fiscal"
    assert corpo["role"] == "operador"
    assert corpo["ativo"] is True
    assert "password" not in corpo

    perfil = db_session.query(Profile).filter(Profile.id == NOVO_UUID).first()
    assert perfil is not None
    assert perfil.nome == "Maria Souza"
    assert perfil.cargo == "Analista Fiscal"


def test_admin_cria_admin(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Joana", "email": "joana@codisplan.com",
        "password": "senhaforte1", "role": "admin",
    })
    assert res.status_code == 201, res.text
    assert res.json()["cargo"] == "Contador Sênior"
    assert res.json()["role"] == "admin"


def test_email_duplicado_nao_chama_supabase(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="99999999-9999-9999-9999-999999999999", email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    db_session.commit()

    res = client.post("/api/v1/usuarios", json={
        "nome": "Outra Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 400
    assert supabase_admin_fake["create"] == []


def test_email_maiusculo_colide_com_registro_existente(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="99999999-9999-9999-9999-999999999999", email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    db_session.commit()

    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "Maria@Codisplan.COM",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 400
    assert supabase_admin_fake["create"] == []


def test_email_do_mapa_fixo_e_recusado(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Falso Operador", "email": "operador@contabilidade.com",
        "password": "senhaforte1", "role": "admin",
    })
    assert res.status_code == 400
    assert supabase_admin_fake["create"] == []


def test_senha_curta_e_recusada(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "curta1", "role": "operador",
    })
    assert res.status_code == 422
    assert supabase_admin_fake["create"] == []


def test_nome_longo_e_recusado(client, supabase_admin_fake):
    res = client.post("/api/v1/usuarios", json={
        "nome": "x" * 256, "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 422
    assert supabase_admin_fake["create"] == []


def test_falha_ao_gravar_perfil_desfaz_criacao(client, db_session, supabase_admin_fake, monkeypatch):
    from app.api.endpoints import usuarios as usuarios_module

    def explode(*args, **kwargs):
        raise RuntimeError("falha simulada ao gravar")

    monkeypatch.setattr(usuarios_module, "_gravar_perfil", explode)

    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 500
    assert supabase_admin_fake["delete"] == [NOVO_UUID]
    assert db_session.query(Profile).filter(Profile.id == NOVO_UUID).first() is None


def test_service_role_ausente_da_erro_de_configuracao(client, monkeypatch):
    from app.api.endpoints import usuarios as usuarios_module
    from app.services.supabase_admin import SupabaseAdminNaoConfigurado

    def sem_config(*args, **kwargs):
        raise SupabaseAdminNaoConfigurado()

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "create_user", staticmethod(sem_config)
    )

    res = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert res.status_code == 500
    assert "SUPABASE_SERVICE_ROLE_KEY" in res.json()["detail"]
