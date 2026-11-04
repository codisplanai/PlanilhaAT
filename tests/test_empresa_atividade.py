"""Atividade da empresa (comércio/indústria): indústria gera apenas DIFAL."""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config


def _criar_empresa(client, cnpj="12345678000195", **extra):
    perfil = client.post("/api/v1/perfis-regras", json={"nome": f"Perfil {cnpj}"})
    assert perfil.status_code in (200, 201), perfil.text
    res = client.post("/api/v1/empresas", json={
        "razao_social": "INDUSTRIA EXEMPLO LTDA", "cnpj": cnpj,
        "uf": "BA", "perfil_regras_id": perfil.json()["id"], **extra})
    return res


def test_empresa_criada_sem_atividade_fica_comercio(client):
    res = _criar_empresa(client)
    assert res.status_code == 201, res.text
    assert res.json()["atividade"] == "comercio"


def test_empresa_industria_persistida_e_editavel(client):
    res = _criar_empresa(client, atividade="industria")
    assert res.status_code == 201, res.text
    assert res.json()["atividade"] == "industria"

    url = f"/api/v1/empresas/{res.json()['id']}"
    outra = client.put(url, json={"razao_social": "INDUSTRIA EXEMPLO SA"})
    assert outra.json()["atividade"] == "industria"

    editada = client.put(url, json={"atividade": "comercio"})
    assert editada.status_code == 200, editada.text
    assert editada.json()["atividade"] == "comercio"


def test_atividade_invalida_rejeitada(client):
    assert _criar_empresa(client, atividade="servico").status_code == 422
    empresa_id = _criar_empresa(client, cnpj="04252011000110").json()["id"]
    res = client.put(f"/api/v1/empresas/{empresa_id}", json={"atividade": "servico"})
    assert res.status_code == 422, res.text


def test_contexto_local_expoe_atividade(client):
    empresa_id = _criar_empresa(client, atividade="industria").json()["id"]
    res = client.get("/api/v1/processamento-local/contexto", params={"empresa_id": empresa_id})
    assert res.status_code == 200, res.text
    assert res.json()["empresa"]["atividade"] == "industria"


def _inserir_empresa(conn, cnpj, atividade=None):
    colunas = "razao_social, cnpj, uf, perfil_regras_id, ativo, criado_em, atualizado_em"
    valores = "'IND', :cnpj, 'BA', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP"
    if atividade is not None:
        colunas += ", atividade"
        valores += ", :atividade"
    conn.execute(
        sa.text(f"INSERT INTO empresas ({colunas}) VALUES ({valores})"),
        {"cnpj": cnpj, "atividade": atividade},
    )


@pytest.mark.filterwarnings("ignore:datetime.datetime.utcnow:DeprecationWarning")
def test_migracao_cria_atividade_com_padrao_comercio_e_reverte(tmp_path):
    url = f"sqlite:///{(tmp_path / 'migracao.db').as_posix()}"
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    engine = sa.create_engine(url)
    try:
        command.upgrade(cfg, "021_valor_pago_st")
        with engine.begin() as conn:
            _inserir_empresa(conn, "12345678000195")

        command.upgrade(cfg, "022_empresa_atividade")
        with engine.begin() as conn:
            existente = conn.execute(
                sa.text("SELECT atividade FROM empresas WHERE cnpj = '12345678000195'")
            ).scalar_one()
        assert existente == "comercio"

        with engine.begin() as conn:
            _inserir_empresa(conn, "04252011000110", "industria")
        with pytest.raises(sa.exc.IntegrityError):
            with engine.begin() as conn:
                _inserir_empresa(conn, "11222333000181", "servico")

        command.downgrade(cfg, "021_valor_pago_st")
        colunas = {c["name"] for c in sa.inspect(engine).get_columns("empresas")}
        assert "atividade" not in colunas
    finally:
        engine.dispose()
