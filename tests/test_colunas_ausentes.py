"""Regressao: bancos criados antes de uma coluna nova ficavam sem ela.

create_all() nao altera tabelas existentes, entao o endpoint /api/v1/perfis-regras
respondia 500 com "column perfis_regras.configuracoes_extras does not exist".
As demais suites usam SQLite novo via create_all e nunca reproduzem esse drift.
"""
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app.main import garantir_colunas_ausentes


@pytest.fixture
def engine_legado():
    """Banco no estado antigo: perfis_regras sem configuracoes_extras."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE perfis_regras ("
            " id INTEGER PRIMARY KEY,"
            " nome VARCHAR(100) NOT NULL,"
            " descricao TEXT)"
        ))
        conn.execute(text("INSERT INTO perfis_regras (id, nome) VALUES (1, 'Padrao Geral')"))
    return engine


def test_adiciona_coluna_ausente_em_banco_antigo(engine_legado):
    assert "configuracoes_extras" not in {
        c["name"] for c in inspect(engine_legado).get_columns("perfis_regras")
    }

    garantir_colunas_ausentes(engine_legado)

    assert "configuracoes_extras" in {
        c["name"] for c in inspect(engine_legado).get_columns("perfis_regras")
    }


def test_linhas_existentes_recebem_default_nao_nulo(engine_legado):
    garantir_colunas_ausentes(engine_legado)

    with engine_legado.connect() as conn:
        valor = conn.execute(
            text("SELECT configuracoes_extras FROM perfis_regras WHERE id = 1")
        ).scalar()

    assert valor == "{}"


def test_e_idempotente_quando_a_coluna_ja_existe(engine_legado):
    garantir_colunas_ausentes(engine_legado)
    garantir_colunas_ausentes(engine_legado)

    colunas = [c["name"] for c in inspect(engine_legado).get_columns("perfis_regras")]
    assert colunas.count("configuracoes_extras") == 1


def test_ignora_tabelas_que_nao_existem():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    garantir_colunas_ausentes(engine)  # nao deve levantar
