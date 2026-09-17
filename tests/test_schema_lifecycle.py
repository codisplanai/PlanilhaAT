"""Regressões do ciclo de vida do esquema.

O processo da aplicação não deve executar ALTER TABLE ad-hoc. Toda mudança
persistente precisa existir na cadeia versionada do Alembic.
"""

from pathlib import Path

from app.core.config import settings


def test_mutacao_automatica_de_schema_e_desabilitada_por_padrao():
    # O ambiente de testes também o desabilita explicitamente em conftest.
    assert settings.AUTO_CREATE_SCHEMA is False


def test_schema_inicial_declara_configuracoes_extras():
    migration = Path("alembic/versions/001_initial_schema.py").read_text(encoding="utf-8")
    assert "configuracoes_extras" in migration


def test_historico_declara_usuario_da_solicitacao():
    migration = Path("alembic/versions/008_supabase_profiles_and_user_ownership.py").read_text(encoding="utf-8")
    assert "usuario_id" in migration
