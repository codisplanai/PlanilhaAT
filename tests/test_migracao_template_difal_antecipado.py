"""Migration 023: produção não roda o seed, então o template da DIFAL Antecipado
nasce como cópia do template DIFAL (RP-158) ativo."""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config


def _cfg(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def _inserir_template(conn, tipo, versao, ativo, blob=b"xlsx-bytes"):
    conn.execute(
        sa.text(
            "INSERT INTO templates_xlsx (tipo, versao, capacidade_linhas, arquivo_path, arquivo_hash, "
            "arquivo_blob, mapeamento_campos, ativo, observacoes, criado_em) VALUES "
            "(:tipo, :versao, 100, '/t/difal.xlsx', 'hash-difal', :blob, "
            "'{\"start_row\": 4, \"columns\": {\"numero_nota\": \"D\"}}', :ativo, 'RP-158', CURRENT_TIMESTAMP)"
        ),
        {"tipo": tipo, "versao": versao, "ativo": ativo, "blob": blob},
    )


def _antecipados(engine):
    with engine.begin() as conn:
        return conn.execute(sa.text(
            "SELECT versao, ativo, arquivo_hash, arquivo_blob, mapeamento_campos, capacidade_linhas "
            "FROM templates_xlsx WHERE tipo = 'difal_antecipado'"
        )).fetchall()


@pytest.mark.filterwarnings("ignore:datetime.datetime.utcnow:DeprecationWarning")
def test_migracao_copia_template_difal_ativo_para_difal_antecipado(tmp_path):
    url = f"sqlite:///{(tmp_path / 'm.db').as_posix()}"
    cfg = _cfg(url)
    engine = sa.create_engine(url)
    try:
        command.upgrade(cfg, "022_empresa_atividade")
        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM templates_xlsx"))
            _inserir_template(conn, "difal", 1, False, blob=b"antigo")
            _inserir_template(conn, "difal", 2, True)

        command.upgrade(cfg, "023_template_difal_antecipado")
        linhas = _antecipados(engine)
        assert len(linhas) == 1
        versao, ativo, arquivo_hash, blob, mapeamento, capacidade = linhas[0]
        assert (versao, bool(ativo), arquivo_hash, bytes(blob), capacidade) == (
            1, True, "hash-difal", b"xlsx-bytes", 100)
        assert "numero_nota" in str(mapeamento)

        command.downgrade(cfg, "022_empresa_atividade")
        assert _antecipados(engine) == []
    finally:
        engine.dispose()


@pytest.mark.filterwarnings("ignore:datetime.datetime.utcnow:DeprecationWarning")
def test_migracao_nao_duplica_quando_ja_existe_difal_antecipado_ativo(tmp_path):
    url = f"sqlite:///{(tmp_path / 'm.db').as_posix()}"
    cfg = _cfg(url)
    engine = sa.create_engine(url)
    try:
        command.upgrade(cfg, "022_empresa_atividade")
        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM templates_xlsx"))
            _inserir_template(conn, "difal", 1, True)
            _inserir_template(conn, "difal_antecipado", 1, True, blob=b"proprio")

        command.upgrade(cfg, "023_template_difal_antecipado")
        linhas = _antecipados(engine)
        assert len(linhas) == 1
        assert bytes(linhas[0][3]) == b"proprio"
    finally:
        engine.dispose()
