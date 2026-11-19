from decimal import Decimal
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import IntegrityError

from app.models.perfil_regras import PerfilRegras


def _alembic_config(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def test_migration_028_upgrade_e_downgrade(tmp_path):
    url = f"sqlite:///{(tmp_path / 'fcp_migracao.db').as_posix()}"
    cfg = _alembic_config(url)
    engine = sa.create_engine(url)
    try:
        command.upgrade(cfg, "head")
        inspector = sa.inspect(engine)
        tables = set(inspector.get_table_names())
        assert "regras_fcp_produto" in tables
        assert "excecoes_fcp_produto" in tables

        indexes = {idx["name"] for idx in inspector.get_indexes("regras_fcp_produto")}
        assert "ix_fcp_perfil_uf_ncm" in indexes

        command.downgrade(cfg, "027_template_empresa_id")
        tables_after = set(sa.inspect(engine).get_table_names())
        assert "regras_fcp_produto" not in tables_after
        assert "excecoes_fcp_produto" not in tables_after
    finally:
        engine.dispose()


def test_constraints_regras_e_excecoes_fcp(db_session):
    from app.models.regra_fcp_produto import ExcecaoFcpProduto, RegraFcpProduto

    perfil = PerfilRegras(nome="Perfil FCP Constraints")
    db_session.add(perfil)
    db_session.commit()

    regra_aliquota_zero = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22030000",
        aliquota=Decimal("0"),
    )
    db_session.add(regra_aliquota_zero)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    regra_uf_minuscula = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="ba",
        ncm="22030000",
        aliquota=Decimal("0.0200"),
    )
    db_session.add(regra_uf_minuscula)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    regra_valida = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        ncm="22030000",
        termos_inclusao=["cerveja"],
        termos_exclusao=["sem alcool"],
        aliquota=Decimal("0.0200"),
        descricao="Cervejas",
    )
    db_session.add(regra_valida)
    db_session.commit()
    db_session.refresh(regra_valida)
    assert regra_valida.uf == "BA"
    assert regra_valida.aplicar_com_termo_acordo is True

    exc1 = ExcecaoFcpProduto(
        regra_fcp_id=regra_valida.id,
        descricao_exata="CERVEJA ARTESANAL X",
        enquadrado=True,
    )
    db_session.add(exc1)
    db_session.commit()

    exc2 = ExcecaoFcpProduto(
        regra_fcp_id=regra_valida.id,
        descricao_exata="CERVEJA ARTESANAL X",
        enquadrado=False,
    )
    db_session.add(exc2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_api_regras_aliquotas_aceita_prefixo_4_a_8_digitos_e_rejeita_invalido(client, db_session):
    perfil = PerfilRegras(nome="Perfil Aliquota Prefixo")
    db_session.add(perfil)
    db_session.commit()

    for ncm_in, ncm_esperado in [
        ("2203", "2203"),
        ("2202.91", "220291"),
        ("22029100", "22029100"),
        (None, None),
    ]:
        resp = client.post(
            "/api/v1/regras-aliquotas",
            json={
                "perfil_regras_id": perfil.id,
                "uf": "BA",
                "ncm": ncm_in,
                "aliquota": "0.2500",
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["ncm"] == ncm_esperado

    regra_id = client.get("/api/v1/regras-aliquotas", params={"perfil_id": perfil.id}).json()[0]["id"]
    upd_ok = client.put(f"/api/v1/regras-aliquotas/{regra_id}", json={"ncm": "2204.10"})
    assert upd_ok.status_code == 200, upd_ok.text
    assert upd_ok.json()["ncm"] == "220410"

    for ncm_invalido in ("220", "00000000"):
        resp = client.post(
            "/api/v1/regras-aliquotas",
            json={
                "perfil_regras_id": perfil.id,
                "uf": "BA",
                "ncm": ncm_invalido,
                "aliquota": "0.2500",
            },
        )
        assert resp.status_code == 422, resp.text
        upd_err = client.put(f"/api/v1/regras-aliquotas/{regra_id}", json={"ncm": ncm_invalido})
        assert upd_err.status_code == 422, upd_err.text
