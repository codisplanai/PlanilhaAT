"""A.ORI fixa da Antecipação Parcial por empresa (acordo com a SEFAZ)."""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config


def _criar_empresa(client, **extra):
    perfil = client.post("/api/v1/perfis-regras", json={"nome": "Perfil DIX"})
    assert perfil.status_code in (200, 201), perfil.text
    res = client.post("/api/v1/empresas", json={
        "razao_social": "DIX ESTILO LTDA", "cnpj": "12345678000195",
        "uf": "BA", "perfil_regras_id": perfil.json()["id"], **extra})
    assert res.status_code == 201, res.text
    return res.json()


def test_empresa_nasce_sem_a_ori_fixa(client):
    assert _criar_empresa(client)["a_ori_fixa_parcial"] is None


def test_cadastro_converte_percentual_da_a_ori_fixa(client):
    empresa = _criar_empresa(client, a_ori_fixa_parcial=12)
    assert float(empresa["a_ori_fixa_parcial"]) == 0.12


def test_edicao_define_mantem_e_limpa_a_ori_fixa(client):
    url = f"/api/v1/empresas/{_criar_empresa(client)['id']}"

    definida = client.put(url, json={"a_ori_fixa_parcial": 0.12})
    assert definida.status_code == 200, definida.text
    assert float(definida.json()["a_ori_fixa_parcial"]) == 0.12

    # Editar outro campo não pode apagar o acordo.
    outra = client.put(url, json={"razao_social": "DIX ESTILO COMERCIO LTDA"})
    assert outra.status_code == 200, outra.text
    assert float(outra.json()["a_ori_fixa_parcial"]) == 0.12

    limpa = client.put(url, json={"a_ori_fixa_parcial": None})
    assert limpa.status_code == 200, limpa.text
    assert limpa.json()["a_ori_fixa_parcial"] is None


@pytest.mark.parametrize("valor", [-1, 150])
def test_rejeita_a_ori_fixa_fora_da_faixa(client, valor):
    url = f"/api/v1/empresas/{_criar_empresa(client)['id']}"
    res = client.put(url, json={"a_ori_fixa_parcial": valor})
    assert res.status_code == 422, res.text


def test_contexto_local_envia_a_ori_fixa(client):
    empresa_id = _criar_empresa(client, a_ori_fixa_parcial=0.12)["id"]
    res = client.get("/api/v1/processamento-local/contexto", params={"empresa_id": empresa_id})
    assert res.status_code == 200, res.text
    assert res.json()["empresa"]["a_ori_fixa_parcial"] == 0.12


def _inserir_empresa(conn, cnpj, a_ori_fixa_parcial):
    conn.execute(
        sa.text(
            "INSERT INTO empresas (razao_social, cnpj, uf, perfil_regras_id, ativo, "
            "criado_em, atualizado_em, a_ori_fixa_parcial) "
            "VALUES ('DIX', :cnpj, 'BA', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :a_ori)"
        ),
        {"cnpj": cnpj, "a_ori": a_ori_fixa_parcial},
    )


# As migrações antigas usam datetime.utcnow(); a troca de fuso foi adiada de propósito.
@pytest.mark.filterwarnings("ignore:datetime.datetime.utcnow:DeprecationWarning")
def test_migracao_cria_coluna_com_faixa_valida_e_reverte(tmp_path):
    url = f"sqlite:///{(tmp_path / 'migracao.db').as_posix()}"
    # Sem alembic.ini: o fileConfig do env.py desligaria os loggers da aplicação.
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    engine = sa.create_engine(url)
    try:
        command.upgrade(cfg, "019_a_ori_fixa_parcial")
        colunas = {c["name"]: c for c in sa.inspect(engine).get_columns("empresas")}
        assert colunas["a_ori_fixa_parcial"]["nullable"] is True

        with engine.begin() as conn:
            _inserir_empresa(conn, "12345678000195", 0.12)
        with pytest.raises(sa.exc.IntegrityError):
            with engine.begin() as conn:
                _inserir_empresa(conn, "04252011000110", 1.5)

        command.downgrade(cfg, "018_convenio_52_91")
        colunas = {c["name"] for c in sa.inspect(engine).get_columns("empresas")}
        assert "a_ori_fixa_parcial" not in colunas
    finally:
        engine.dispose()
