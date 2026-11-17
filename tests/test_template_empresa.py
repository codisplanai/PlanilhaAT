import io
import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.core.exceptions import NotFoundException, ValidationException
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.template_xlsx import TemplateXlsx
from app.services.templates_admin.template_manager import TemplateManager


def _make_xlsx_bytes(marker: str = "MODELO") -> bytes:
    buffer = io.BytesIO()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Planilha AT"
    ws["A1"] = marker
    ws["D4"] = ""
    wb.save(buffer)
    wb.close()
    return buffer.getvalue()


def _create_empresa(db_session, nome: str, cnpj: str, perfil_id: int) -> Empresa:
    empresa = Empresa(
        razao_social=nome,
        cnpj=cnpj,
        uf="BA",
        perfil_regras_id=perfil_id,
        ativo=True,
    )
    db_session.add(empresa)
    db_session.commit()
    db_session.refresh(empresa)
    return empresa


@pytest.fixture
def perfil_basico(db_session):
    perfil = PerfilRegras(nome="Perfil Modelos Empresa")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(
        RegraAliquotaDestino(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm=None,
            aliquota=Decimal("0.2050"),
        )
    )
    db_session.commit()
    return perfil


def test_upload_versionamento_independente_e_prioridade_por_empresa(db_session, perfil_basico):
    emp_a = _create_empresa(db_session, "Empresa A LTDA", "12345678000195", perfil_basico.id)
    emp_b = _create_empresa(db_session, "Empresa B LTDA", "98765432000180", perfil_basico.id)

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {"numero_nota": "A", "v_total": "D"},
    }

    global_100 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("GLOBAL-100"),
        filename="global_100.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
    )
    global_300 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("GLOBAL-300"),
        filename="global_300.xlsx",
        mapeamento=mapping,
        capacidade_linhas=300,
        promover_ativo=True,
    )
    emp_a_100 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("EMP-A-100"),
        filename="emp_a_100.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
        empresa_id=emp_a.id,
    )
    emp_a_100_v2 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("EMP-A-100-V2"),
        filename="emp_a_100_v2.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=False,
        empresa_id=emp_a.id,
    )

    assert global_100.versao == 1
    assert global_300.versao == 2
    assert emp_a_100.versao == 1
    assert emp_a_100.empresa_id == emp_a.id
    assert emp_a_100_v2.versao == 2
    assert emp_a_100_v2.ativo is False

    # Empresa A prioriza o modelo proprio quando comporta as linhas
    assert (
        TemplateManager.get_active_template(
            db_session, "antecipacao_parcial", required_rows=80, empresa_id=emp_a.id
        ).id
        == emp_a_100.id
    )

    # Empresa A faz fallback para o global quando excede a capacidade do modelo da empresa
    assert (
        TemplateManager.get_active_template(
            db_session, "antecipacao_parcial", required_rows=150, empresa_id=emp_a.id
        ).id
        == global_300.id
    )

    # Empresa B sem modelo proprio usa o global adequado
    assert (
        TemplateManager.get_active_template(
            db_session, "antecipacao_parcial", required_rows=80, empresa_id=emp_b.id
        ).id
        == global_100.id
    )

    # Global permanece intacto e isolado
    assert (
        TemplateManager.get_active_template(
            db_session, "antecipacao_parcial", required_rows=80
        ).id
        == global_100.id
    )

    # Promover v2 da empresa A nao desativa o global_100
    TemplateManager.promote_version(db_session, emp_a_100_v2.id)
    db_session.refresh(global_100)
    db_session.refresh(emp_a_100)
    db_session.refresh(emp_a_100_v2)
    assert global_100.ativo is True
    assert emp_a_100.ativo is False
    assert emp_a_100_v2.ativo is True

    # Capacidade acima do maior modelo entre empresa e global continua falhando corretamente
    with pytest.raises(ValidationException, match="suporta 300 linhas"):
        TemplateManager.get_active_template(
            db_session, "antecipacao_parcial", required_rows=301, empresa_id=emp_a.id
        )


def test_upload_empresa_inexistente_falha(db_session):
    mapping = {"start_row": 4, "sheet_name": "Planilha AT", "columns": {"numero_nota": "A"}}
    with pytest.raises(NotFoundException, match="Empresa não encontrada"):
        TemplateManager.upload_new_template_version(
            db=db_session,
            tipo="difal",
            file_bytes=_make_xlsx_bytes("DIFAL"),
            filename="difal.xlsx",
            mapeamento=mapping,
            capacidade_linhas=100,
            empresa_id=99999,
        )


def test_desativar_modelo_empresa_retorna_ao_global_e_bloqueia_global(
    client, db_session, perfil_basico
):
    emp = _create_empresa(db_session, "Empresa Desativar LTDA", "12345678000195", perfil_basico.id)
    mapping_json = json.dumps(
        {
            "start_row": 4,
            "sheet_name": "Planilha AT",
            "columns": {"numero_nota": "A", "v_total": "D"},
        }
    )

    res_global = client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "difal",
            "capacidade_linhas": "100",
            "mapeamento_json": mapping_json,
            "promover_ativo": "true",
        },
        files={"file": ("global.xlsx", _make_xlsx_bytes("GLOBAL"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res_global.status_code == 201, res_global.text
    global_id = res_global.json()["id"]

    res_emp = client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "difal",
            "capacidade_linhas": "100",
            "empresa_id": str(emp.id),
            "mapeamento_json": mapping_json,
            "promover_ativo": "true",
            "observacoes": "Layout exclusivo",
        },
        files={"file": ("emp.xlsx", _make_xlsx_bytes("EMPRESA"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res_emp.status_code == 201, res_emp.text
    emp_tpl = res_emp.json()
    assert emp_tpl["empresa_id"] == emp.id
    assert emp_tpl["ativo"] is True

    assert (
        TemplateManager.get_active_template(
            db_session, "difal", required_rows=10, empresa_id=emp.id
        ).id
        == emp_tpl["id"]
    )

    # Nao permite desativar modelo global diretamente
    res_fail_global = client.post(f"/api/v1/templates/{global_id}/desativar")
    assert res_fail_global.status_code == 422

    # Desativa modelo da empresa e volta a selecionar o global
    res_deact = client.post(f"/api/v1/templates/{emp_tpl['id']}/desativar")
    assert res_deact.status_code == 200, res_deact.text
    assert res_deact.json()["ativo"] is False

    db_session.expire_all()
    assert (
        TemplateManager.get_active_template(
            db_session, "difal", required_rows=10, empresa_id=emp.id
        ).id
        == global_id
    )

    # Historico preservado para auditoria e reativacao possivel
    res_list_emp = client.get("/api/v1/templates", params={"empresa_id": emp.id})
    assert res_list_emp.status_code == 200
    assert [t["id"] for t in res_list_emp.json()] == [emp_tpl["id"]]

    res_list_global = client.get("/api/v1/templates", params={"apenas_global": True})
    assert res_list_global.status_code == 200
    assert [t["id"] for t in res_list_global.json()] == [global_id]


def test_contexto_processamento_local_isola_templates_entre_empresas(
    client, db_session, perfil_basico
):
    emp_a = _create_empresa(db_session, "Alpha LTDA", "12345678000195", perfil_basico.id)
    emp_b = _create_empresa(db_session, "Beta LTDA", "98765432000180", perfil_basico.id)
    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {"numero_nota": "A", "v_total": "D"},
    }

    t_global = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("G"),
        filename="g.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
    )
    t_a = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("A"),
        filename="a.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
        empresa_id=emp_a.id,
    )
    t_b = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=_make_xlsx_bytes("B"),
        filename="b.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
        empresa_id=emp_b.id,
    )

    res_ctx_a = client.get("/api/v1/processamento-local/contexto", params={"empresa_id": emp_a.id})
    assert res_ctx_a.status_code == 200, res_ctx_a.text
    ids_a = {item["id"] for item in res_ctx_a.json()["templates_ativos"]}
    assert ids_a == {t_global.id, t_a.id}
    assert t_b.id not in ids_a

    # Criacao de solicitacao legada rejeita template de outra empresa
    res_sol_err = client.post(
        "/api/v1/solicitacoes",
        json={
            "empresa_id": emp_a.id,
            "periodo_inicio": "2026-01-01",
            "periodo_fim": "2026-01-31",
            "tipo_planilha": "antecipacao_parcial",
            "template_id": t_b.id,
        },
    )
    assert res_sol_err.status_code == 422

    # Sem template_id explicito, vincula automaticamente o modelo da empresa A
    res_sol_ok = client.post(
        "/api/v1/solicitacoes",
        json={
            "empresa_id": emp_a.id,
            "periodo_inicio": "2026-01-01",
            "periodo_fim": "2026-01-31",
            "tipo_planilha": "antecipacao_parcial",
        },
    )
    assert res_sol_ok.status_code == 201, res_sol_ok.text
    assert res_sol_ok.json()["template_id"] == t_a.id


def test_operador_nao_pode_desativar_ou_subir_template_empresa(client, db_session, perfil_basico):
    emp = _create_empresa(db_session, "Empresa RBAC", "12345678000195", perfil_basico.id)
    tpl = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="difal",
        file_bytes=_make_xlsx_bytes("RBAC"),
        filename="rbac.xlsx",
        mapeamento={"start_row": 4, "sheet_name": "Planilha AT", "columns": {"numero_nota": "A"}},
        capacidade_linhas=100,
        promover_ativo=True,
        empresa_id=emp.id,
    )

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "operador@contabilidade.com", "password": "fiscal"},
    )
    assert login.status_code == 200
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

    res_deact = client.post(f"/api/v1/templates/{tpl.id}/desativar")
    assert res_deact.status_code == 403


@pytest.mark.filterwarnings("ignore:datetime.datetime.utcnow:DeprecationWarning")
def test_migracao_027_suporta_versionamento_por_empresa_e_downgrade(tmp_path):
    url = f"sqlite:///{(tmp_path / 'm027.db').as_posix()}"
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)

    engine = sa.create_engine(url)
    try:
        command.upgrade(cfg, "026_template_reducao_col")
        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM templates_xlsx"))
            conn.execute(
                sa.text(
                    "INSERT INTO perfis_regras (nome, configuracoes_extras, criado_em, atualizado_em) "
                    "VALUES ('Perfil M027', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            perfil_id = conn.execute(
                sa.text("SELECT id FROM perfis_regras WHERE nome = 'Perfil M027'")
            ).scalar_one()
            conn.execute(
                sa.text(
                    "INSERT INTO empresas (razao_social, cnpj, uf, perfil_regras_id, ativo, criado_em, atualizado_em) "
                    "VALUES ('Empresa M027', '12345678000195', 'BA', :pid, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"pid": perfil_id},
            )
            conn.execute(
                sa.text(
                    "INSERT INTO templates_xlsx (tipo, versao, capacidade_linhas, arquivo_path, arquivo_hash, "
                    "mapeamento_campos, ativo, criado_em) VALUES "
                    "('difal', 1, 100, '/t/g.xlsx', 'hash-g', '{\"start_row\": 4, \"columns\": {\"numero_nota\": \"A\"}}', 1, CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(cfg, "027_template_empresa_id")
        with engine.begin() as conn:
            empresa_id = conn.execute(
                sa.text("SELECT id FROM empresas WHERE cnpj = '12345678000195'")
            ).scalar_one()
            # Permite mesma versao (1) e capacidade (100) ativa simultaneamente no global e na empresa
            conn.execute(
                sa.text(
                    "INSERT INTO templates_xlsx (empresa_id, tipo, versao, capacidade_linhas, arquivo_path, arquivo_hash, "
                    "mapeamento_campos, ativo, criado_em) VALUES "
                    "(:eid, 'difal', 1, 100, '/t/e.xlsx', 'hash-e', '{\"start_row\": 4, \"columns\": {\"numero_nota\": \"A\"}}', 1, CURRENT_TIMESTAMP)"
                ),
                {"eid": empresa_id},
            )
            count = conn.execute(
                sa.text("SELECT COUNT(*) FROM templates_xlsx WHERE tipo = 'difal' AND ativo = 1")
            ).scalar_one()
            assert count == 2

            conn.execute(sa.text("DELETE FROM templates_xlsx WHERE empresa_id IS NOT NULL"))

        command.downgrade(cfg, "026_template_reducao_col")
        cols = {c["name"] for c in sa.inspect(engine).get_columns("templates_xlsx")}
        assert "empresa_id" not in cols
    finally:
        engine.dispose()
