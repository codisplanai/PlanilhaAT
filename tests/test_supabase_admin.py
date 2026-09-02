"""Testes do wrapper da Admin API do Supabase Auth.

Cobrem os caminhos em que a API responde de forma inesperada. Eles importam
porque `criar_usuario` só compensa a criação quando o wrapper sinaliza a falha:
um erro engolido aqui deixa uma conta no Auth sem linha em `profiles`, e como
`profiles.email` é UNIQUE aquele e-mail fica inutilizável para sempre.
"""

import logging

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.services import supabase_admin as admin_module
from app.services.supabase_admin import SupabaseAdminService

USER_ID = "11111111-2222-3333-4444-555555555555"


class _FakeResponse:
    def __init__(self, status_code, payload=None, corpo_invalido=False):
        self.status_code = status_code
        self._payload = payload
        self._corpo_invalido = corpo_invalido
        self.text = "" if payload is None else str(payload)

    def json(self):
        if self._corpo_invalido:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._payload


def _fake_client_factory(response, chamadas=None):
    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, json=None, headers=None):
            return response

        def delete(self, url, headers=None):
            if chamadas is not None:
                chamadas.append(url)
            return response

    return _FakeClient


@pytest.fixture
def admin_configurado(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://fake.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "fake-service-role-key")


def test_create_user_com_corpo_nao_json_retorna_502(monkeypatch, admin_configurado):
    """Um 200 com corpo não-JSON (gateway interpondo HTML) não pode escapar cru.

    O ValueError passaria por fora do `except SupabaseAdminNaoConfigurado` do
    endpoint, virando 500 sem compensação — conta criada e e-mail queimado.
    """
    monkeypatch.setattr(
        admin_module.httpx,
        "Client",
        _fake_client_factory(_FakeResponse(200, corpo_invalido=True)),
    )

    with pytest.raises(HTTPException) as exc:
        SupabaseAdminService.create_user(
            email="maria@codisplan.com", password="senhaforte1", nome="Maria"
        )

    assert exc.value.status_code == 502
    assert "Resposta inválida" in exc.value.detail


def test_delete_user_registra_resposta_de_erro(monkeypatch, admin_configurado, caplog):
    """Um 401 (service-role key rotacionada) devolve normalmente do httpx.

    Sem inspecionar o status, a compensação relataria sucesso e deixaria a conta
    órfã no Auth.
    """
    monkeypatch.setattr(
        admin_module.httpx, "Client", _fake_client_factory(_FakeResponse(401))
    )

    with caplog.at_level(logging.WARNING, logger="app.services.supabase_admin"):
        SupabaseAdminService.delete_user(USER_ID)

    assert USER_ID in caplog.text
    assert "401" in caplog.text


def test_delete_user_nao_registra_erro_em_sucesso(
    monkeypatch, admin_configurado, caplog
):
    monkeypatch.setattr(
        admin_module.httpx, "Client", _fake_client_factory(_FakeResponse(204))
    )

    with caplog.at_level(logging.WARNING, logger="app.services.supabase_admin"):
        SupabaseAdminService.delete_user(USER_ID)

    assert caplog.text == ""


def test_delete_user_aceita_404_como_ja_removido(
    monkeypatch, admin_configurado, caplog
):
    """A conta já não existe: o objetivo da compensação está cumprido."""
    monkeypatch.setattr(
        admin_module.httpx, "Client", _fake_client_factory(_FakeResponse(404))
    )

    with caplog.at_level(logging.WARNING, logger="app.services.supabase_admin"):
        SupabaseAdminService.delete_user(USER_ID)

    assert caplog.text == ""
