import pytest

from app.models.profile import Profile

NOVO_UUID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def supabase_admin_fake(monkeypatch):
    """Substitui a Admin API. Registra as chamadas para as asserções."""
    from app.api.endpoints import usuarios as usuarios_module

    chamadas = {"create": [], "delete": [], "remove": []}

    def fake_create(email, password, nome):
        chamadas["create"].append({"email": email, "password": password, "nome": nome})
        return NOVO_UUID

    def fake_delete(user_id):
        chamadas["delete"].append(user_id)

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "create_user", staticmethod(fake_create)
    )
    def fake_remove(user_id):
        chamadas["remove"].append(user_id)

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "delete_user", staticmethod(fake_delete)
    )
    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "remove_user", staticmethod(fake_remove)
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


# --------------------------------------------------------------------------
# Exclusão definitiva de usuário
# --------------------------------------------------------------------------


def test_admin_exclui_usuario(client, db_session, supabase_admin_fake):
    criar = client.post("/api/v1/usuarios", json={
        "nome": "Maria", "email": "maria@codisplan.com",
        "password": "senhaforte1", "role": "operador",
    })
    assert criar.status_code == 201, criar.text

    res = client.delete(f"/api/v1/usuarios/{NOVO_UUID}")

    assert res.status_code == 204, res.text
    assert supabase_admin_fake["remove"] == [NOVO_UUID]
    assert db_session.query(Profile).filter(Profile.id == NOVO_UUID).first() is None


def test_operador_nao_exclui_usuario(client_operador, db_session, supabase_admin_fake):
    db_session.add(Profile(
        id=NOVO_UUID, email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    db_session.commit()

    res = client_operador.delete(f"/api/v1/usuarios/{NOVO_UUID}")

    assert res.status_code == 403
    assert supabase_admin_fake["remove"] == []
    assert db_session.query(Profile).filter(Profile.id == NOVO_UUID).first() is not None


def test_admin_nao_exclui_a_si_mesmo(client, db_session, supabase_admin_fake):
    me = client.get("/api/v1/auth/me").json()

    res = client.delete(f"/api/v1/usuarios/{me['id']}")

    assert res.status_code == 400
    assert "própria conta" in res.json()["detail"]
    assert supabase_admin_fake["remove"] == []


def test_conta_institucional_fixa_nao_e_excluida(client, db_session, supabase_admin_fake):
    """O e-mail do mapa fixo volta a existir no próximo login, então excluí-lo
    removeria a conta do Auth sem tirar o acesso de fato."""
    db_session.add(Profile(
        id=NOVO_UUID, email="operador@contabilidade.com",
        nome="Operador Institucional", cargo="Analista Fiscal",
        role="operador", ativo=True,
    ))
    db_session.commit()

    res = client.delete(f"/api/v1/usuarios/{NOVO_UUID}")

    assert res.status_code == 400
    assert supabase_admin_fake["remove"] == []
    assert db_session.query(Profile).filter(Profile.id == NOVO_UUID).first() is not None


def test_exclusao_de_id_inexistente_da_404(client, supabase_admin_fake):
    res = client.delete("/api/v1/usuarios/00000000-0000-0000-0000-000000000404")

    assert res.status_code == 404
    assert supabase_admin_fake["remove"] == []


def test_auth_que_recusa_remocao_mantem_o_perfil(client, db_session, monkeypatch):
    """Sem o rollback, o usuário sumiria da lista e continuaria entrando."""
    from fastapi import HTTPException

    from app.api.endpoints import usuarios as usuarios_module

    db_session.add(Profile(
        id=NOVO_UUID, email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    db_session.commit()

    def recusa(user_id):
        raise HTTPException(status_code=502, detail="Auth recusou")

    monkeypatch.setattr(
        usuarios_module.SupabaseAdminService, "remove_user", staticmethod(recusa)
    )

    res = client.delete(f"/api/v1/usuarios/{NOVO_UUID}")

    assert res.status_code == 502
    assert db_session.query(Profile).filter(Profile.id == NOVO_UUID).first() is not None


def test_exclusao_preserva_solicitacoes_sem_autor(client, db_session, supabase_admin_fake):
    """O histórico é o registro fiscal do que foi gerado: some o autor, não a
    solicitação."""
    import datetime

    from app.models.empresa import Empresa
    from app.models.perfil_regras import PerfilRegras
    from app.models.solicitacao import Solicitacao

    db_session.add(Profile(
        id=NOVO_UUID, email="maria@codisplan.com",
        nome="Maria", cargo="Analista Fiscal", role="operador", ativo=True,
    ))
    perfil = PerfilRegras(nome="Perfil exclusão de usuário")
    db_session.add(perfil)
    db_session.flush()
    empresa = Empresa(
        cnpj="12345678000195",
        razao_social="Empresa Teste",
        uf="BA",
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.flush()
    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        usuario_id=NOVO_UUID,
        periodo_inicio=datetime.date(2026, 7, 1),
        periodo_fim=datetime.date(2026, 7, 31),
        tipo_planilha="multi",
        status="concluido",
        total_notas_processadas=3,
    )
    db_session.add(solicitacao)
    db_session.commit()
    solicitacao_id = solicitacao.id

    res = client.delete(f"/api/v1/usuarios/{NOVO_UUID}")

    assert res.status_code == 204, res.text
    db_session.expire_all()
    persistida = db_session.query(Solicitacao).filter(
        Solicitacao.id == solicitacao_id
    ).first()
    assert persistida is not None
    assert persistida.usuario_id is None
    assert persistida.total_notas_processadas == 3
