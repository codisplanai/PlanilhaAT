from decimal import Decimal

from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_fcp_produto import ExcecaoFcpProduto, RegraFcpProduto
from app.schemas.validators import normalizar_termos

URL_FCP = "/api/v1/regras-fcp"
URL_PERFIS = "/api/v1/perfis-regras"


def _criar_perfil(db_session, nome: str = "Perfil FCP") -> PerfilRegras:
    perfil = PerfilRegras(nome=nome)
    db_session.add(perfil)
    db_session.commit()
    return perfil


def test_crud_regra_fcp_e_conflito_literal(client, db_session):
    perfil = _criar_perfil(db_session, "Perfil CRUD FCP")

    # POST normaliza uf, aliquota percentual, termos_inclusao e termos_exclusao
    resp = client.post(
        URL_FCP,
        json={
            "perfil_regras_id": perfil.id,
            "uf": "ba",
            "ncm": "2203",
            "termos_inclusao": ["  cerveja*  ", ""],
            "termos_exclusao": ["sem álcool"],
            "aliquota": 2,
            "aplicar_com_termo_acordo": True,
            "descricao": "Cervejas BA",
        },
    )
    assert resp.status_code == 201, resp.text
    criada = resp.json()
    assert criada["uf"] == "BA"
    assert criada["ncm"] == "2203"
    assert Decimal(str(criada["aliquota"])) == Decimal("0.02")
    assert criada["termos_inclusao"] == ["CERVEJA*"]
    assert criada["termos_exclusao"] == ["SEM ALCOOL"]
    assert criada["aplicar_com_termo_acordo"] is True

    # Duplicata literal -> 409
    dup = client.post(
        URL_FCP,
        json={
            "perfil_regras_id": perfil.id,
            "uf": "BA",
            "ncm": "2203",
            "termos_inclusao": ["cerveja*"],
            "aliquota": 0.02,
        },
    )
    assert dup.status_code == 409, dup.text

    # Aliquota 0 -> 422
    invalida = client.post(
        URL_FCP,
        json={
            "perfil_regras_id": perfil.id,
            "uf": "BA",
            "ncm": "2204",
            "aliquota": 0,
        },
    )
    assert invalida.status_code == 422, invalida.text

    # Segunda regra distinta no mesmo NCM e perfil (permitida)
    outra = client.post(
        URL_FCP,
        json={
            "perfil_regras_id": perfil.id,
            "uf": "BA",
            "ncm": "2203",
            "termos_inclusao": ["chope"],
            "aliquota": 0.02,
        },
    )
    assert outra.status_code == 201, outra.text
    outra_id = outra.json()["id"]

    # GET lista por perfil e GET por id
    list_resp = client.get(URL_FCP, params={"perfil_id": perfil.id})
    assert list_resp.status_code == 200, list_resp.text
    assert {r["id"] for r in list_resp.json()} == {criada["id"], outra_id}

    get_resp = client.get(f"{URL_FCP}/{criada['id']}")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["id"] == criada["id"]

    # PUT conflitando com outra regra -> 409
    upd_conflito = client.put(
        f"{URL_FCP}/{outra_id}",
        json={"termos_inclusao": ["CERVEJA*"]},
    )
    assert upd_conflito.status_code == 409, upd_conflito.text

    # PUT valido
    upd_ok = client.put(
        f"{URL_FCP}/{criada['id']}",
        json={"aliquota": 3, "aplicar_com_termo_acordo": False, "descricao": "Atualizada"},
    )
    assert upd_ok.status_code == 200, upd_ok.text
    assert Decimal(str(upd_ok.json()["aliquota"])) == Decimal("0.03")
    assert upd_ok.json()["aplicar_com_termo_acordo"] is False
    assert upd_ok.json()["descricao"] == "Atualizada"

    # DELETE
    del_resp = client.delete(f"{URL_FCP}/{criada['id']}")
    assert del_resp.status_code == 204, del_resp.text
    assert client.get(f"{URL_FCP}/{criada['id']}").status_code == 404

    # Sem token -> 401
    client.headers.pop("Authorization", None)
    assert client.get(URL_FCP).status_code == 401


def test_excecoes_fcp_crud_e_duplicata(client, db_session):
    perfil = _criar_perfil(db_session, "Perfil Excecoes FCP")
    r1 = RegraFcpProduto(
        perfil_regras_id=perfil.id, uf="BA", ncm="22021000", aliquota=Decimal("0.0200")
    )
    r2 = RegraFcpProduto(
        perfil_regras_id=perfil.id, uf="BA", ncm="22029900", aliquota=Decimal("0.0200")
    )
    db_session.add_all([r1, r2])
    db_session.commit()

    exc_resp = client.post(
        f"{URL_FCP}/{r1.id}/excecoes",
        json={
            "descricao_exata": "  Água Mineral c/ Gás  ",
            "enquadrado": False,
            "observacao": "Nao incide",
        },
    )
    assert exc_resp.status_code == 201, exc_resp.text
    exc = exc_resp.json()
    assert exc["descricao_exata"] == "AGUA MINERAL C GAS"
    assert exc["enquadrado"] is False

    # Duplicata na mesma regra -> 409
    dup_resp = client.post(
        f"{URL_FCP}/{r1.id}/excecoes",
        json={"descricao_exata": "agua mineral c/ gas", "enquadrado": True},
    )
    assert dup_resp.status_code == 409, dup_resp.text

    # DELETE com regra_id errado -> 404
    err_del = client.delete(f"{URL_FCP}/{r2.id}/excecoes/{exc['id']}")
    assert err_del.status_code == 404, err_del.text

    # DELETE correto -> 204
    ok_del = client.delete(f"{URL_FCP}/{r1.id}/excecoes/{exc['id']}")
    assert ok_del.status_code == 204, ok_del.text


def test_preset_bebidas_ba_idempotente(client, db_session):
    perfil = _criar_perfil(db_session, "Perfil Preset Bebidas BA")

    r1 = client.post(f"{URL_FCP}/preset-bebidas-ba", params={"perfil_regras_id": perfil.id})
    assert r1.status_code == 200, r1.text
    assert r1.json() == {
        "fcp_criadas": 8,
        "fcp_ignoradas": 0,
        "aliquotas_criadas": 5,
        "aliquotas_ignoradas": 0,
    }

    regras_fcp = (
        db_session.query(RegraFcpProduto)
        .filter(RegraFcpProduto.perfil_regras_id == perfil.id)
        .all()
    )
    por_ncm = {r.ncm: r for r in regras_fcp}
    assert set(por_ncm) == {
        "2203",
        "2204",
        "2205",
        "2206",
        "2208",
        "22029100",
        "22021000",
        "22029900",
    }
    for regra in regras_fcp:
        assert regra.uf == "BA"
        assert regra.aliquota == Decimal("0.0200")
        assert regra.aplicar_com_termo_acordo is True

    assert por_ncm["22021000"].termos_inclusao == normalizar_termos([
        "refrigerant*", "refri", "cola", "guarana", "soda", "tonica", "isoton*",
        "energetic*", "energy", "gatorade", "powerade", "red bull", "monster",
        "tnt", "fanta", "sprite", "pepsi", "coca", "schweppes",
    ])
    assert por_ncm["22021000"].termos_exclusao == normalizar_termos(["agua mineral"])
    assert por_ncm["22029900"].termos_inclusao == normalizar_termos([
        "refrigerant*", "isoton*", "hidroeletrolit*", "energetic*", "energy",
        "gatorade", "powerade", "red bull", "monster", "tnt",
        "chopp sem alcool", "chope sem alcool",
    ])
    assert por_ncm["22029900"].termos_exclusao == normalizar_termos([
        "agua mineral", "suco natural", "polpa", "agua de coco",
    ])

    aliquotas = (
        db_session.query(RegraAliquotaDestino)
        .filter(RegraAliquotaDestino.perfil_regras_id == perfil.id, RegraAliquotaDestino.uf == "BA")
        .all()
    )
    assert {a.ncm: a.aliquota for a in aliquotas} == {
        ncm: Decimal("0.2500") for ncm in ("2203", "2204", "2205", "2206", "2208")
    }

    # Segunda chamada idempotente
    r2 = client.post(f"{URL_FCP}/preset-bebidas-ba", params={"perfil_regras_id": perfil.id})
    assert r2.status_code == 200, r2.text
    assert r2.json() == {
        "fcp_criadas": 0,
        "fcp_ignoradas": 8,
        "aliquotas_criadas": 0,
        "aliquotas_ignoradas": 5,
    }


def test_copiar_e_duplicar_regras_fcp_com_excecoes(client, db_session):
    origem = _criar_perfil(db_session, "Origem FCP")
    destino = _criar_perfil(db_session, "Destino FCP")

    origem.regras_fcp_produto = [
        RegraFcpProduto(
            uf="BA",
            ncm="2203",
            aliquota=Decimal("0.0200"),
            termos_inclusao=[],
            descricao="Cervejas",
            excecoes=[ExcecaoFcpProduto(descricao_exata="CERVEJA ZERO", enquadrado=True)],
        ),
        RegraFcpProduto(
            uf="BA",
            ncm="2204",
            aliquota=Decimal("0.0200"),
            termos_inclusao=[],
            descricao="Vinhos",
        ),
    ]
    destino.regras_fcp_produto = [
        RegraFcpProduto(
            uf="BA",
            ncm="2204",
            aliquota=Decimal("0.0200"),
            termos_inclusao=[],
            descricao="Vinhos destino",
        ),
    ]
    db_session.commit()

    copia_resp = client.post(
        f"{URL_PERFIS}/{origem.id}/copiar-regras",
        json={"secao": "fcp", "perfil_destino_ids": [destino.id]},
    )
    assert copia_resp.status_code == 200, copia_resp.text
    assert copia_resp.json()["resultados"] == [
        {
            "perfil_id": destino.id,
            "perfil_nome": "Destino FCP",
            "copiadas": 1,
            "ignoradas": 1,
        }
    ]

    db_session.expire_all()
    por_ncm_dest = {r.ncm: r for r in destino.regras_fcp_produto}
    assert set(por_ncm_dest) == {"2203", "2204"}
    assert [e.descricao_exata for e in por_ncm_dest["2203"].excecoes] == ["CERVEJA ZERO"]
    assert por_ncm_dest["2204"].descricao == "Vinhos destino"

    # Duplicar perfil preserva regras_fcp_produto e excecoes
    dup_resp = client.post(
        f"{URL_PERFIS}/{origem.id}/duplicar",
        json={"nome": "Perfil FCP Duplicado"},
    )
    assert dup_resp.status_code == 201, dup_resp.text
    duplicado = db_session.get(PerfilRegras, dup_resp.json()["id"])
    assert len(duplicado.regras_fcp_produto) == 2
    por_ncm_dup = {r.ncm: r for r in duplicado.regras_fcp_produto}
    assert por_ncm_dup["2203"].id != origem.regras_fcp_produto[0].id
    assert [e.descricao_exata for e in por_ncm_dup["2203"].excecoes] == ["CERVEJA ZERO"]
    assert por_ncm_dup["2203"].excecoes[0].id != origem.regras_fcp_produto[0].excecoes[0].id


def test_contexto_processamento_local_expoe_regras_fcp(client, db_session):
    perfil = _criar_perfil(db_session, "Perfil Contexto FCP")
    regra = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22021000",
        termos_inclusao=["REFRIGERANT*"],
        termos_exclusao=["AGUA MINERAL"],
        aliquota=Decimal("0.0200"),
        aplicar_com_termo_acordo=True,
        descricao="Refrigerantes",
        excecoes=[
            ExcecaoFcpProduto(
                descricao_exata="AGUA MINERAL NATURAL",
                enquadrado=False,
                observacao="Isenta",
            )
        ],
    )
    db_session.add(regra)
    db_session.flush()

    empresa = Empresa(
        razao_social="Bebidas BA Ltda",
        cnpj="12345678000195",
        uf="BA",
        perfil_regras_id=perfil.id,
        ativo=True,
    )
    db_session.add(empresa)
    db_session.commit()

    resp = client.get("/api/v1/processamento-local/contexto", params={"empresa_id": empresa.id})
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert "regras_fcp" in payload
    assert len(payload["regras_fcp"]) == 1
    item = payload["regras_fcp"][0]
    assert item["uf"] == "BA"
    assert item["ncm"] == "22021000"
    assert item["aliquota"] == 0.02
    assert item["aplicar_com_termo_acordo"] is True
    assert item["termos_inclusao"] == ["REFRIGERANT*"]
    assert item["termos_exclusao"] == ["AGUA MINERAL"]
    assert len(item["excecoes"]) == 1
    assert item["excecoes"][0]["descricao_exata"] == "AGUA MINERAL NATURAL"
    assert item["excecoes"][0]["enquadrado"] is False
