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


def test_listagem_inclui_inativos(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="88888888-8888-8888-8888-888888888888", email="inativo@codisplan.com",
        nome="Ana Inativa", cargo="Analista Fiscal", role="operador", ativo=False,
    ))
    db_session.commit()

    res = client.get("/api/v1/usuarios")
    assert res.status_code == 200, res.text
    emails = [u["email"] for u in res.json()]
    assert "inativo@codisplan.com" in emails


def test_operador_nao_lista_usuarios(client_operador):
    assert client_operador.get("/api/v1/usuarios").status_code == 403


def test_perfil_inativo_e_bloqueado_no_acesso(client, db_session, supabase_admin_fake):
    """A desativação é aplicada em _load_active_profile, por onde passa toda
    requisição autenticada. Conferir só a flag no banco não provaria nada."""
    from fastapi import HTTPException

    from app.core.security import _load_active_profile

    criar = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert criar.status_code == 201, criar.text

    res = client.patch(f"/api/v1/usuarios/{NOVO_UUID}/status", json={"ativo": False})
    assert res.status_code == 200, res.text
    assert res.json()["ativo"] is False

    with pytest.raises(HTTPException) as exc:
        _load_active_profile(db_session, NOVO_UUID)
    assert exc.value.status_code == 403


def test_reativar_usuario(client, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id="88888888-8888-8888-8888-888888888888", email="inativo@codisplan.com",
        nome="Ana Inativa", cargo="Analista Fiscal", role="operador", ativo=False,
    ))
    db_session.commit()

    res = client.patch(
        "/api/v1/usuarios/88888888-8888-8888-8888-888888888888/status",
        json={"ativo": True},
    )
    assert res.status_code == 200, res.text
    assert res.json()["ativo"] is True


def test_admin_nao_desativa_a_si_mesmo(client, db_session):
    me = client.get("/api/v1/auth/me").json()
    res = client.patch(f"/api/v1/usuarios/{me['id']}/status", json={"ativo": False})
    assert res.status_code == 400
    assert "própria conta" in res.json()["detail"]


def test_patch_id_inexistente_da_404(client):
    res = client.patch(
        "/api/v1/usuarios/00000000-0000-0000-0000-000000000404/status",
        json={"ativo": False},
    )
    assert res.status_code == 404



def test_guarda_de_autodesativacao_usa_o_perfil_carregado(
    client, db_session, monkeypatch
):
    """A guarda precisa comparar o perfil carregado, não o texto cru da URL.

    Em produção ``profiles.id`` é ``UUID`` (docs/supabase_schema.sql), e o
    Postgres normaliza o parâmetro: ``/usuarios/<UUID EM MAIÚSCULAS>/status``
    resolve para a mesma linha. Comparando strings antes do lookup, o admin
    escapa da guarda, desativa a própria conta e perde o acesso — sem ninguém
    para reativá-lo se for o único admin. O SQLite dos testes compara texto de
    forma binária, então a normalização do Postgres é simulada no lookup.
    """
    from app.api.endpoints import usuarios as usuarios_module

    me = client.get("/api/v1/auth/me").json()
    db_session.merge(Profile(
        id=me["id"], email=me["email"], nome=me["nome"],
        cargo=me["cargo"], role="admin", ativo=True,
    ))
    db_session.commit()

    def resolve_como_no_postgres(db, model, entity_id, detail):
        return db.query(Profile).filter(Profile.id == str(entity_id).lower()).one()

    monkeypatch.setattr(usuarios_module, "get_by_id_or_404", resolve_como_no_postgres)

    res = client.patch(
        f"/api/v1/usuarios/{me['id'].upper()}/status", json={"ativo": False}
    )

    assert res.status_code == 400, res.text
    assert "própria conta" in res.json()["detail"]
    assert db_session.query(Profile).filter(Profile.id == me["id"]).one().ativo is True
