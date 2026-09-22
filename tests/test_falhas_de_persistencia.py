"""Falhas de banco precisam virar resposta HTTP tratada, não erro 500 cru.

Sem ``save_changes``/``delete_and_commit``, um ``db.commit()`` solto vazava o
erro interno do SQLAlchemy no corpo da resposta (com ``DEBUG`` ligado) e deixava
a sessão inutilizável para o resto da requisição.
"""

import datetime

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.solicitacao import Solicitacao


ADMIN_ID = "184e793c-50b7-4b57-ace1-c02b19649408"


@pytest.fixture
def solicitacao_pendente(db_session):
    perfil = PerfilRegras(nome="Perfil falhas")
    db_session.add(perfil)
    db_session.flush()
    empresa = Empresa(
        cnpj="12345678000195",
        razao_social="Empresa Falhas LTDA",
        uf="BA",
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.flush()

    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        usuario_id=ADMIN_ID,
        periodo_inicio=datetime.date(2026, 7, 1),
        periodo_fim=datetime.date(2026, 7, 31),
        tipo_planilha="multi",
        status="pendente",
    )
    db_session.add(solicitacao)
    db_session.commit()
    return solicitacao


def _quebrar_commit(monkeypatch, db_session, excecao):
    def commit_falho():
        raise excecao

    monkeypatch.setattr(db_session, "commit", commit_falho)


def test_registrar_resultado_traduz_conflito_em_409(
    client, db_session, solicitacao_pendente, monkeypatch
):
    _quebrar_commit(
        monkeypatch,
        db_session,
        IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed")),
    )

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{solicitacao_pendente.id}/resultado",
        json={
            "notas_processadas": [],
            "saidas": [],
            "notas_ignoradas": [],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
            "mensagem": None,
        },
    )

    assert response.status_code == 409, response.text
    assert "conflita" in response.json()["detail"].lower()


def test_registrar_resultado_nao_vaza_erro_interno_do_banco(
    client, db_session, solicitacao_pendente, monkeypatch
):
    _quebrar_commit(
        monkeypatch,
        db_session,
        OperationalError("INSERT", {}, Exception("database is locked")),
    )

    response = client.post(
        f"/api/v1/processamento-local/solicitacoes/{solicitacao_pendente.id}/resultado",
        json={
            "notas_processadas": [],
            "saidas": [],
            "notas_ignoradas": [],
            "itens_excluidos": [],
            "avisos_avaliacao": [],
            "cfops_sem_regra": {},
            "mensagem": None,
        },
    )

    assert response.status_code == 500, response.text
    detail = response.json()["detail"]
    assert detail == "Não foi possível registrar o resultado do processamento."
    assert "database is locked" not in detail


def test_excluir_solicitacao_em_lote_trata_falha_do_banco(
    client, db_session, solicitacao_pendente, monkeypatch
):
    _quebrar_commit(
        monkeypatch,
        db_session,
        OperationalError("DELETE", {}, Exception("database is locked")),
    )

    response = client.post(
        "/api/v1/solicitacoes/batch-delete",
        json={"ids": [solicitacao_pendente.id]},
    )

    assert response.status_code == 500, response.text
    assert response.json()["detail"] == "Não foi possível excluir as solicitações selecionadas."


def test_alterar_status_de_usuario_trata_falha_do_banco(client, db_session, monkeypatch):
    _quebrar_commit(
        monkeypatch,
        db_session,
        OperationalError("UPDATE", {}, Exception("database is locked")),
    )

    response = client.patch(
        f"/api/v1/usuarios/{ADMIN_ID}/status",
        json={"ativo": True},
    )

    assert response.status_code == 500, response.text
    assert response.json()["detail"] == "Não foi possível atualizar a situação do usuário."
