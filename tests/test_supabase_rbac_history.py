import pytest
import json
from app.models.profile import Profile
from app.models.solicitacao import Solicitacao

def test_login_retorna_cargo_e_role_corretos(client):
    # Admin
    res_admin = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "admin"
    })
    assert res_admin.status_code == 200
    data_admin = res_admin.json()
    assert data_admin["user"]["role"] == "admin"
    assert data_admin["user"]["cargo"] == "Contador Sênior"

    # Operador
    res_op = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com",
        "password": "fiscal"
    })
    assert res_op.status_code == 200
    data_op = res_op.json()
    assert data_op["user"]["role"] == "operador"
    assert data_op["user"]["cargo"] == "Analista Fiscal"


def test_operador_nao_pode_gerenciar_templates(client, create_sample_excel_template):
    # Login como operador
    login_res = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com",
        "password": "fiscal"
    })
    op_token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {op_token}"}

    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        template_bytes = f.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {"v_total": "A"}
    }

    # Tentativa de upload por operador deve retornar 403 Forbidden
    res_upload = client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "antecipacao_parcial",
            "mapeamento_json": json.dumps(mapping),
            "promover_ativo": True
        },
        files={"file": ("template.xlsx", template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers
    )
    assert res_upload.status_code == 403
    assert "exclusiva para o Contador Sênior" in res_upload.json()["detail"]


def test_admin_pode_gerenciar_templates(client, create_sample_excel_template):
    login_res = client.post("/api/v1/auth/login", json={
        "email": "admin@contabilidade.com",
        "password": "admin"
    })
    admin_token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        template_bytes = f.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        }
    }

    res_upload = client.post(
        "/api/v1/templates/upload",
        data={
            "tipo": "antecipacao_parcial",
            "mapeamento_json": json.dumps(mapping),
            "promover_ativo": True
        },
        files={"file": ("template_admin.xlsx", template_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=headers
    )
    assert res_upload.status_code == 201
    assert res_upload.json()["ativo"] is True


def test_historico_filtrado_por_usuario(client, db_session):
    # Obter tokens de admin e operador
    res_admin = client.post("/api/v1/auth/login", json={"email": "admin@contabilidade.com", "password": "admin"})
    admin_data = res_admin.json()
    admin_token = admin_data["access_token"]
    admin_id = admin_data["user"]["id"]

    res_op = client.post("/api/v1/auth/login", json={"email": "operador@contabilidade.com", "password": "fiscal"})
    op_data = res_op.json()
    op_token = op_data["access_token"]
    op_id = op_data["user"]["id"]

    # Cadastrar perfil e empresa
    res_perfil = client.post("/api/v1/perfis-regras", json={"nome": "Perfil Multi User Test", "configuracoes_extras": {}})
    perfil_id = res_perfil.json()["id"]

    res_empresa = client.post("/api/v1/empresas", json={
        "razao_social": "EMPRESA TESTE HISTORICO",
        "cnpj": "12.345.678/0001-95",
        "uf": "SP",
        "perfil_regras_id": perfil_id,
        "ativo": True
    })
    empresa_id = res_empresa.json()["id"]

    # 1. Operador cria uma solicitação
    res_solic_op = client.post(
        "/api/v1/solicitacoes",
        json={
            "empresa_id": empresa_id,
            "periodo_inicio": "2026-01-01",
            "periodo_fim": "2026-01-31"
        },
        headers={"Authorization": f"Bearer {op_token}"}
    )
    assert res_solic_op.status_code == 201
    solic_op_id = res_solic_op.json()["id"]

    # 2. Admin cria uma solicitação
    res_solic_admin = client.post(
        "/api/v1/solicitacoes",
        json={
            "empresa_id": empresa_id,
            "periodo_inicio": "2026-02-01",
            "periodo_fim": "2026-02-28"
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res_solic_admin.status_code == 201
    solic_admin_id = res_solic_admin.json()["id"]

    # 3. Operador lista -> SÓ pode ver a solicitação criada por ele, NÃO a do Admin
    res_list_op = client.get("/api/v1/solicitacoes", headers={"Authorization": f"Bearer {op_token}"})
    assert res_list_op.status_code == 200
    ids_op = [s["id"] for s in res_list_op.json()]
    assert solic_op_id in ids_op
    assert solic_admin_id not in ids_op

    # 4. Operador tenta burlar passando ?usuario_id={admin_id} -> Deve continuar vendo APENAS as suas
    res_tamper_op = client.get(f"/api/v1/solicitacoes?usuario_id={admin_id}", headers={"Authorization": f"Bearer {op_token}"})
    assert res_tamper_op.status_code == 200
    ids_tamper = [s["id"] for s in res_tamper_op.json()]
    assert solic_op_id in ids_tamper
    assert solic_admin_id not in ids_tamper

    # 5. Admin lista -> Deve ver TODAS as solicitações (tanto a do operador quanto a do admin)
    res_list_admin = client.get("/api/v1/solicitacoes", headers={"Authorization": f"Bearer {admin_token}"})
    assert res_list_admin.status_code == 200
    solics_admin = res_list_admin.json()
    ids_admin = [s["id"] for s in solics_admin]
    assert solic_op_id in ids_admin
    assert solic_admin_id in ids_admin

    # Verifica se usuario_nome e usuario_email vieram preenchidos
    solic_op_found = next(s for s in solics_admin if s["id"] == solic_op_id)
    assert solic_op_found["usuario_id"] == op_id
    assert solic_op_found["usuario_email"] == "operador@contabilidade.com"
    assert solic_op_found["usuario_nome"] is not None

    # 6. Admin filtra especificamente por usuario_id do operador
    res_filtered_admin = client.get(f"/api/v1/solicitacoes?usuario_id={op_id}", headers={"Authorization": f"Bearer {admin_token}"})
    assert res_filtered_admin.status_code == 200
    filtered_ids = [s["id"] for s in res_filtered_admin.json()]
    assert solic_op_id in filtered_ids
    assert solic_admin_id not in filtered_ids

    # 7. Usuário com cargo de Contador Sênior também visualiza todas as solicitações
    op_profile = db_session.query(Profile).filter(Profile.id == op_id).first()
    cargo_antigo = op_profile.cargo
    try:
        op_profile.cargo = "Contador Sênior"
        db_session.commit()

        res_senior = client.get("/api/v1/solicitacoes", headers={"Authorization": f"Bearer {op_token}"})
        assert res_senior.status_code == 200
        ids_senior = [s["id"] for s in res_senior.json()]
        assert solic_op_id in ids_senior
        assert solic_admin_id in ids_senior
    finally:
        op_profile.cargo = cargo_antigo
        db_session.commit()


def test_resumo_templates_ativos_acessivel_por_todos(client):
    res_op = client.post("/api/v1/auth/login", json={"email": "operador@contabilidade.com", "password": "fiscal"})
    op_token = res_op.json()["access_token"]

    res = client.get("/api/v1/templates/ativos-resumo", headers={"Authorization": f"Bearer {op_token}"})
    assert res.status_code == 200
    assert isinstance(res.json(), list)
