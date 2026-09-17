import pytest
from app.models.perfil_regras import PerfilRegras
from app.models.regra_exclusao_parcial import RegraExclusaoParcial


def test_crud_regra_exclusao_parcial(client, db_session):
    # Criar perfil
    perfil = PerfilRegras(nome="Perfil Teste Exclusão BA", descricao="Perfil para teste")
    db_session.add(perfil)
    db_session.commit()
    db_session.refresh(perfil)

    # 1. Criar regra
    res_create = client.post(
        "/api/v1/regras-exclusao-parcial",
        json={
            "perfil_regras_id": perfil.id,
            "uf": "ba",
            "ncm": "02102000",
            "descricao": "Charque Bovino",
            "termos_obrigatorios": ["charque", "bovino"],
            "motivo": "imposto_pago_entrada",
            "ativo": True,
        },
    )
    assert res_create.status_code == 201, res_create.text
    dados = res_create.json()
    assert dados["uf"] == "BA"
    assert dados["ncm"] == "02102000"
    assert dados["termos_obrigatorios"] == ["CHARQUE", "BOVINO"]
    assert dados["motivo"] == "imposto_pago_entrada"
    regra_id = dados["id"]

    # 2. Conflito por duplicata exata de termos
    res_duplicada = client.post(
        "/api/v1/regras-exclusao-parcial",
        json={
            "perfil_regras_id": perfil.id,
            "uf": "BA",
            "ncm": "02102000",
            "termos_obrigatorios": ["bovino", "charque"],  # mesma combinação em ordem diferente
            "motivo": "isencao",
        },
    )
    assert res_duplicada.status_code == 409

    # 3. Listar regras
    res_list = client.get(f"/api/v1/regras-exclusao-parcial?perfil_id={perfil.id}&uf=BA")
    assert res_list.status_code == 200
    lista = res_list.json()
    assert len(lista) == 1
    assert lista[0]["id"] == regra_id

    # 4. Obter por ID
    res_get = client.get(f"/api/v1/regras-exclusao-parcial/{regra_id}")
    assert res_get.status_code == 200
    assert res_get.json()["ncm"] == "02102000"

    # 5. Atualizar regra
    res_update = client.put(
        f"/api/v1/regras-exclusao-parcial/{regra_id}",
        json={
            "termos_obrigatorios": ["charque"],
            "descricao": "Charque Geral",
            "motivo": "isencao",
        },
    )
    assert res_update.status_code == 200
    atualizado = res_update.json()
    assert atualizado["termos_obrigatorios"] == ["CHARQUE"]
    assert atualizado["descricao"] == "Charque Geral"
    assert atualizado["motivo"] == "isencao"

    # 6. Deletar regra
    res_del = client.delete(f"/api/v1/regras-exclusao-parcial/{regra_id}")
    assert res_del.status_code == 204

    # Verificar que não existe mais
    res_get_deleted = client.get(f"/api/v1/regras-exclusao-parcial/{regra_id}")
    assert res_get_deleted.status_code == 404


def test_carga_padrao_bahia_idempotente(client, db_session):
    perfil = PerfilRegras(nome="Perfil Carga Bahia", descricao="Teste carga inicial")
    db_session.add(perfil)
    db_session.commit()
    db_session.refresh(perfil)

    # 1. Primeira carga: 8 regras inseridas
    res_carga1 = client.post(
        "/api/v1/regras-exclusao-parcial/carregar-padrao-ba",
        json={"perfil_regras_id": perfil.id},
    )
    assert res_carga1.status_code == 200, res_carga1.text
    dados1 = res_carga1.json()
    assert dados1["inseridas"] == 8
    assert dados1["existentes"] == 0
    assert dados1["total"] == 8

    ncms_esperados = {
        "02102000",  # Charque
        "19012090",  # Mistura para bolo
        "11041900",  # Flocão de milho
        "11022000",  # Farinha de milho
        "10059010",  # Milho de pipoca
        "07133399",  # Feijão
        "25010020",  # Sal
        "17019900",  # Açúcar
    }
    ncms_retornados = {r["ncm"] for r in dados1["regras"]}
    assert ncms_retornados == ncms_esperados

    # 2. Segunda carga imediata: 0 inseridas, 8 existentes
    res_carga2 = client.post(
        "/api/v1/regras-exclusao-parcial/carregar-padrao-ba",
        json={"perfil_regras_id": perfil.id},
    )
    assert res_carga2.status_code == 200
    dados2 = res_carga2.json()
    assert dados2["inseridas"] == 0
    assert dados2["existentes"] == 8
    assert dados2["total"] == 8


def test_reload_seed_preserves_edited_term_scope(client, db_session):
    perfil = PerfilRegras(nome="Review seed scope")
    db_session.add(perfil)
    db_session.commit()
    endpoint = "/api/v1/regras-exclusao-parcial"
    seed = client.post(endpoint + "/carregar-padrao-ba", json={"perfil_regras_id": perfil.id})
    assert seed.status_code == 200
    charque = next(r for r in seed.json()["regras"] if r["ncm"] == "02102000")
    edited = client.put(endpoint + f'/{charque["id"]}', json={"termos_obrigatorios": ["CHARQUE", "BOVINO"]})
    assert edited.status_code == 200
    reload = client.post(endpoint + "/carregar-padrao-ba", json={"perfil_regras_id": perfil.id})
    assert reload.status_code == 200
    assert reload.json()["inseridas"] == 0, reload.json()
    assert reload.json()["total"] == 8


def test_policy_rejects_non_boolean_values(client, db_session):
    perfil = PerfilRegras(nome="Review policy validation")
    db_session.add(perfil)
    db_session.commit()
    res = client.put(f"/api/v1/perfis-regras/{perfil.id}", json={
        "configuracoes_extras": {"politica_aliquotas_iguais_parcial": {"BA": "false"}}
    })
    assert res.status_code == 422, res.json()


def test_false_string_actually_activates_policy(client, db_session):
    from app.services.rules_engine.parcial_decision import ParcialExclusionService
    perfil = PerfilRegras(nome="Review false conversion", configuracoes_extras={
        "politica_aliquotas_iguais_parcial": {"BA": "false"}
    })
    db_session.add(perfil)
    db_session.commit()
    service = ParcialExclusionService(db_session)
    service.preload(perfil.id)
    assert service.is_politica_aliquotas_iguais_ativa(perfil.id, "BA") is False
