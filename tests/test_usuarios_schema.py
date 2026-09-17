import pytest
from pydantic import ValidationError

from app.schemas.usuario import UsuarioCreate
from app.services.supabase_admin import SupabaseAdminService


def test_email_e_normalizado():
    payload = UsuarioCreate(
        nome="Maria Souza", email="  Maria@Codisplan.COM ",
        password="senhaforte1", role="operador",
    )
    assert payload.email == "maria@codisplan.com"


def test_cargo_derivado_do_papel():
    admin = UsuarioCreate(nome="A", email="a@x.com", password="senhaforte1", role="admin")
    operador = UsuarioCreate(nome="O", email="o@x.com", password="senhaforte1", role="operador")
    assert admin.cargo == "Contador Sênior"
    assert operador.cargo == "Analista Fiscal"


def test_senha_curta_e_rejeitada():
    with pytest.raises(ValidationError):
        UsuarioCreate(nome="A", email="a@x.com", password="curta1", role="operador")


def test_nome_acima_de_255_e_rejeitado():
    with pytest.raises(ValidationError):
        UsuarioCreate(nome="x" * 256, email="a@x.com", password="senhaforte1", role="operador")


def test_papel_invalido_e_rejeitado():
    with pytest.raises(ValidationError):
        UsuarioCreate(nome="A", email="a@x.com", password="senhaforte1", role="superadmin")


def test_is_configured_falso_sem_chave(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None)
    assert SupabaseAdminService.is_configured() is False
