import pytest
from decimal import Decimal
from app.models.perfil_regras import PerfilRegras
from app.models.empresa import Empresa
from app.models.regra_aliquota import RegraAliquotaDestino

def test_criar_perfil_e_empresa(db_session):
    perfil = PerfilRegras(
        nome="Perfil Comércio BA",
        descricao="Perfil padrão para empresas baianas",
        configuracoes_extras={"regime": "lucro_presumido"}
    )
    db_session.add(perfil)
    db_session.commit()
    db_session.refresh(perfil)

    assert perfil.id is not None
    assert perfil.nome == "Perfil Comércio BA"

    # Criar empresa vinculada
    empresa = Empresa(
        razao_social="Alpha Comercial LTDA",
        cnpj="12345678000195",
        uf="BA",
        perfil_regras_id=perfil.id
    )
    db_session.add(empresa)
    db_session.commit()
    db_session.refresh(empresa)

    assert empresa.id is not None
    assert empresa.perfil_regras.nome == "Perfil Comércio BA"

def test_criar_regras_aliquotas_padrao_e_excecao(db_session):
    perfil = PerfilRegras(nome="Perfil Padrão")
    db_session.add(perfil)
    db_session.commit()

    # Regra padrão estadual BA (NCM = None) -> 18%
    regra_padrao = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.1800"),
        descricao="Alíquota interna padrão BA"
    )
    # Regra exceção informática BA (NCM = 84713012) -> 12% ou 20.5%
    regra_excecao = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="84713012",
        aliquota=Decimal("0.2050"),
        descricao="Alíquota com FECOP BA"
    )
    db_session.add_all([regra_padrao, regra_excecao])
    db_session.commit()

    regras = db_session.query(RegraAliquotaDestino).filter_by(perfil_regras_id=perfil.id).all()
    assert len(regras) == 2


def test_mesmo_ncm_aceita_mais_de_uma_regra_de_reducao(db_session):
    """O mesmo NCM comporta produtos que se enquadram e produtos que não:
    7214.20 tem vergalhão a 12% e barra chata a 18%."""
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Reducao")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"), descricao="Vergalhoes"))
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["barra chata"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas"))
    db_session.commit()

    regras = db_session.query(RegraReducaoProduto).filter(
        RegraReducaoProduto.ncm == "72142000").all()
    assert len(regras) == 2


def test_excecao_nao_aceita_descricao_duplicada_na_mesma_regra(db_session):
    from decimal import Decimal
    from sqlalchemy.exc import IntegrityError
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Excecao")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"))
    db_session.add(regra)
    db_session.commit()

    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.commit()

    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=True))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_empresa_tem_no_maximo_um_termo_de_acordo(db_session):
    from decimal import Decimal
    from sqlalchemy.exc import IntegrityError
    from app.models.empresa import Empresa
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa

    perfil = PerfilRegras(nome="Perfil Acordo")
    db_session.add(perfil)
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195",
                      uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()

    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1000")))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_excluir_regra_de_reducao_leva_as_excecoes_junto(db_session):
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Cascade")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"))
    regra.excecoes.append(ExcecaoReducaoProduto(
        descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.add(regra)
    db_session.commit()

    db_session.delete(regra)
    db_session.commit()
    assert db_session.query(ExcecaoReducaoProduto).count() == 0


def test_schema_converte_aliquota_percentual_para_decimal():
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    payload = RegraReducaoCreate(
        perfil_regras_id=1, ncm="72142000", termos_inclusao=["vergalh*"], aliquota=Decimal("12.00"))
    assert payload.aliquota == Decimal("0.12")


def test_schema_rejeita_ncm_sentinela_do_sped():
    import pytest as _pytest
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    with _pytest.raises(ValueError):
        RegraReducaoCreate(
            perfil_regras_id=1, ncm="00000000",
            termos_inclusao=["vergalh*"], aliquota=Decimal("0.12"))


def test_schema_rejeita_lista_de_termos_vazia():
    import pytest as _pytest
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    with _pytest.raises(ValueError):
        RegraReducaoCreate(
            perfil_regras_id=1, ncm="72142000", termos_inclusao=[], aliquota=Decimal("0.12"))


def test_schema_normaliza_termos_e_descarta_vazios():
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    payload = RegraReducaoCreate(
        perfil_regras_id=1, ncm="72142000",
        termos_inclusao=["  Vergalhão*  ", "", "  "], aliquota=Decimal("0.12"))
    assert payload.termos_inclusao == ["VERGALHAO*"]


def test_schema_de_excecao_normaliza_a_descricao():
    from app.schemas.regra_reducao_produto import ExcecaoReducaoCreate

    payload = ExcecaoReducaoCreate(descricao_exata="Vergalhão de Cobre", enquadrado=False)
    assert payload.descricao_exata == "VERGALHAO DE COBRE"


def test_schema_de_termo_de_acordo_converte_percentual():
    from decimal import Decimal
    from app.schemas.regra_aliquota_empresa import TermoAcordoUpsert

    payload = TermoAcordoUpsert(aliquota=Decimal("12.06"), descricao="Termo 123/2025")
    assert payload.aliquota == Decimal("0.1206")


def _criar_perfil(client):
    res = client.post("/api/v1/perfis-regras", json={"nome": "Perfil API Reducao"})
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def test_api_cria_e_lista_regra_de_reducao(client):
    perfil_id = _criar_perfil(client)

    res = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "7214.20.00",
        "termos_inclusao": ["vergalh*"], "termos_exclusao": ["cobre"],
        "aliquota": 12.00, "descricao": "Vergalhoes"})
    assert res.status_code == 201, res.text
    criada = res.json()
    assert criada["ncm"] == "72142000"
    assert criada["termos_inclusao"] == ["VERGALH*"]
    assert float(criada["aliquota"]) == 0.12

    listagem = client.get(f"/api/v1/regras-reducao-produto?perfil_id={perfil_id}")
    assert listagem.status_code == 200
    assert len(listagem.json()) == 1


def test_api_rejeita_regra_duplicada_com_os_mesmos_termos(client):
    perfil_id = _criar_perfil(client)
    corpo = {"perfil_regras_id": perfil_id, "ncm": "72142000",
             "termos_inclusao": ["vergalh*"], "aliquota": 0.12}

    assert client.post("/api/v1/regras-reducao-produto", json=corpo).status_code == 201
    repetida = client.post("/api/v1/regras-reducao-produto", json=corpo)
    assert repetida.status_code == 409, repetida.text


def test_api_aceita_segundo_termo_para_o_mesmo_ncm(client):
    perfil_id = _criar_perfil(client)
    assert client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "72142000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12}).status_code == 201
    assert client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "72142000",
        "termos_inclusao": ["barra chata"], "aliquota": 0.18}).status_code == 201


def test_api_rejeita_ncm_sentinela(client):
    perfil_id = _criar_perfil(client)
    res = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "00000000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12})
    assert res.status_code == 422, res.text


def test_api_cria_e_remove_excecao(client):
    perfil_id = _criar_perfil(client)
    regra_id = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "72142000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12}).json()["id"]

    res = client.post(f"/api/v1/regras-reducao-produto/{regra_id}/excecoes", json={
        "descricao_exata": "Vergalhão de Cobre", "enquadrado": False,
        "observacao": "Cobre nao entra no decreto"})
    assert res.status_code == 201, res.text
    excecao = res.json()
    assert excecao["descricao_exata"] == "VERGALHAO DE COBRE"

    detalhe = client.get(f"/api/v1/regras-reducao-produto/{regra_id}")
    assert len(detalhe.json()["excecoes"]) == 1

    apagar = client.delete(
        f"/api/v1/regras-reducao-produto/{regra_id}/excecoes/{excecao['id']}")
    assert apagar.status_code == 204


def test_api_rejeita_perfil_inexistente(client):
    res = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": 9999, "ncm": "72142000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12})
    assert res.status_code == 404, res.text


def _criar_empresa(client):
    perfil_id = _criar_perfil(client)
    res = client.post("/api/v1/empresas", json={
        "razao_social": "Cliente BA LTDA", "cnpj": "12345678000195",
        "uf": "BA", "perfil_regras_id": perfil_id})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_api_empresa_nasce_sem_termo_de_acordo(client):
    empresa_id = _criar_empresa(client)
    res = client.get(f"/api/v1/empresas/{empresa_id}")
    assert res.status_code == 200
    assert res.json()["termo_acordo"] is None


def test_api_upsert_de_termo_de_acordo_nao_duplica(client):
    empresa_id = _criar_empresa(client)

    primeiro = client.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={
        "aliquota": 12.06, "descricao": "Termo 123/2025"})
    assert primeiro.status_code == 200, primeiro.text
    assert float(primeiro.json()["aliquota"]) == 0.1206

    segundo = client.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={
        "aliquota": 0.1000, "descricao": "Termo 456/2026"})
    assert segundo.status_code == 200
    assert segundo.json()["id"] == primeiro.json()["id"]
    assert float(segundo.json()["aliquota"]) == 0.10

    empresa = client.get(f"/api/v1/empresas/{empresa_id}").json()
    assert empresa["termo_acordo"]["descricao"] == "Termo 456/2026"


def test_api_remove_termo_de_acordo(client):
    empresa_id = _criar_empresa(client)
    client.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={"aliquota": 12.06})

    assert client.delete(f"/api/v1/empresas/{empresa_id}/termo-acordo").status_code == 204
    assert client.get(f"/api/v1/empresas/{empresa_id}").json()["termo_acordo"] is None


def test_api_remover_termo_inexistente_e_404(client):
    empresa_id = _criar_empresa(client)
    assert client.delete(f"/api/v1/empresas/{empresa_id}/termo-acordo").status_code == 404


def test_api_empresa_optante_simples_nacional_create_and_update(client):
    perfil_id = _criar_perfil(client)
    # 1. Cria empresa com optante_simples_nacional=True
    res = client.post("/api/v1/empresas", json={
        "razao_social": "Empresa Simples LTDA",
        "cnpj": "04252011000110",
        "uf": "BA",
        "perfil_regras_id": perfil_id,
        "optante_simples_nacional": True,
    })
    assert res.status_code == 201, res.text
    empresa_id = res.json()["id"]
    assert res.json()["optante_simples_nacional"] is True

    # 2. Get confirma que persistiu True
    res_get = client.get(f"/api/v1/empresas/{empresa_id}")
    assert res_get.status_code == 200
    assert res_get.json()["optante_simples_nacional"] is True

    # 3. Atualiza para False
    res_put_false = client.put(f"/api/v1/empresas/{empresa_id}", json={
        "optante_simples_nacional": False,
    })
    assert res_put_false.status_code == 200
    assert res_put_false.json()["optante_simples_nacional"] is False

    # Get confirma que persistiu False
    res_get2 = client.get(f"/api/v1/empresas/{empresa_id}")
    assert res_get2.json()["optante_simples_nacional"] is False

    # 4. Atualiza de volta para True
    res_put_true = client.put(f"/api/v1/empresas/{empresa_id}", json={
        "optante_simples_nacional": True,
    })
    assert res_put_true.status_code == 200
    assert res_put_true.json()["optante_simples_nacional"] is True

    # Get confirma que persistiu True
    res_get3 = client.get(f"/api/v1/empresas/{empresa_id}")
    assert res_get3.json()["optante_simples_nacional"] is True


def test_criar_regra_reclassificacao_cfop_e_excecao(db_session):
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop, ExcecaoReclassificacaoCfop

    perfil = PerfilRegras(nome="Perfil Reclassificacao Teste")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_origem_sufixo="102",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
        termos_exclusao=["PLASTICO"],
        descricao="Grampos sujeitos a ST",
    )
    db_session.add(regra)
    db_session.commit()

    excecao = ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra.id,
        descricao_exata="GRAMPO ESPECIAL INOX",
        aplicar=False,
        observacao="Inox nao entra",
    )
    db_session.add(excecao)
    db_session.commit()

    assert regra.id is not None
    assert len(regra.excecoes) == 1
    assert regra.excecoes[0].descricao_exata == "GRAMPO ESPECIAL INOX"
    assert regra.excecoes[0].aplicar is False


def test_excecao_reclassificacao_cfop_nao_aceita_descricao_duplicada(db_session):
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop, ExcecaoReclassificacaoCfop

    perfil = PerfilRegras(nome="Perfil Reclassificacao Duplicada")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
    )
    db_session.add(regra)
    db_session.commit()

    db_session.add(ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra.id, descricao_exata="GRAMPO A", aplicar=False
    ))
    db_session.commit()

    db_session.add(ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra.id, descricao_exata="GRAMPO A", aplicar=True
    ))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_excluir_regra_reclassificacao_cfop_leva_as_excecoes_junto(db_session):
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop, ExcecaoReclassificacaoCfop

    perfil = PerfilRegras(nome="Perfil Reclassificacao Cascade")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
    )
    db_session.add(regra)
    db_session.commit()

    db_session.add(ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra.id, descricao_exata="GRAMPO B", aplicar=False
    ))
    db_session.commit()

    regra_id = regra.id
    db_session.delete(regra)
    db_session.commit()

    sobras = db_session.query(ExcecaoReclassificacaoCfop).filter_by(regra_reclassificacao_id=regra_id).all()
    assert len(sobras) == 0


def test_schema_reclassificacao_converte_cfop_4_digitos_para_sufixo_3():
    from app.schemas.regra_reclassificacao_cfop import RegraReclassificacaoCreate

    payload = RegraReclassificacaoCreate(
        perfil_regras_id=1,
        ncm="7326.90.90",
        cfop_origem_sufixo="6102",
        cfop_destino_sufixo="6405",
        termos_inclusao=["  Grampo*  "],
    )
    assert payload.ncm == "73269090"
    assert payload.cfop_origem_sufixo == "102"
    assert payload.cfop_destino_sufixo == "405"
    assert payload.termos_inclusao == ["GRAMPO*"]


def test_schema_reclassificacao_normaliza_termos_e_excecoes():
    from app.schemas.regra_reclassificacao_cfop import ExcecaoReclassificacaoCreate

    exc = ExcecaoReclassificacaoCreate(
        descricao_exata="  Grampo cb.aço leve... ",
        aplicar=False,
    )
    assert exc.descricao_exata == "GRAMPO CB ACO LEVE"


def test_schema_reclassificacao_rejeita_cfop_invalido():
    import pytest
    from app.schemas.regra_reclassificacao_cfop import RegraReclassificacaoCreate

    with pytest.raises(ValueError, match="CFOP deve conter 3 ou 4 dígitos"):
        RegraReclassificacaoCreate(
            perfil_regras_id=1,
            ncm="73269090",
            cfop_destino_sufixo="99",  # 2 dígitos é inválido
        )


def test_api_cria_e_lista_regra_de_reclassificacao_cfop(client):
    perfil_id = _criar_perfil(client)

    res = client.post("/api/v1/regras-reclassificacao-cfop", json={
        "perfil_regras_id": perfil_id,
        "ncm": "7326.90.90",
        "cfop_origem_sufixo": "6102",
        "cfop_destino_sufixo": "6405",
        "termos_inclusao": ["grampo*"],
        "termos_exclusao": ["plastico"],
        "descricao": "Grampos sujeitos a ST",
    })
    assert res.status_code == 201, res.text
    criada = res.json()
    assert criada["ncm"] == "73269090"
    assert criada["cfop_origem_sufixo"] == "102"
    assert criada["cfop_destino_sufixo"] == "405"
    assert criada["termos_inclusao"] == ["GRAMPO*"]

    listagem = client.get(f"/api/v1/regras-reclassificacao-cfop?perfil_id={perfil_id}")
    assert listagem.status_code == 200
    assert len(listagem.json()) == 1


def test_api_rejeita_regra_reclassificacao_duplicada(client):
    perfil_id = _criar_perfil(client)
    corpo = {
        "perfil_regras_id": perfil_id,
        "ncm": "73269090",
        "cfop_origem_sufixo": "102",
        "cfop_destino_sufixo": "405",
        "termos_inclusao": ["grampo*"],
    }
    assert client.post("/api/v1/regras-reclassificacao-cfop", json=corpo).status_code == 201
    repetida = client.post("/api/v1/regras-reclassificacao-cfop", json=corpo)
    assert repetida.status_code == 409, repetida.text


def test_api_cria_e_remove_excecao_reclassificacao(client):
    perfil_id = _criar_perfil(client)
    regra_id = client.post("/api/v1/regras-reclassificacao-cfop", json={
        "perfil_regras_id": perfil_id,
        "ncm": "73269090",
        "cfop_destino_sufixo": "405",
        "termos_inclusao": ["grampo*"],
    }).json()["id"]

    res = client.post(f"/api/v1/regras-reclassificacao-cfop/{regra_id}/excecoes", json={
        "descricao_exata": "Grampo Especial Inox",
        "aplicar": False,
        "observacao": "Inox nao deve ir para ST",
    })
    assert res.status_code == 201, res.text
    excecao = res.json()
    assert excecao["descricao_exata"] == "GRAMPO ESPECIAL INOX"
    assert excecao["aplicar"] is False

    detalhe = client.get(f"/api/v1/regras-reclassificacao-cfop/{regra_id}")
    assert len(detalhe.json()["excecoes"]) == 1

    apagar = client.delete(
        f"/api/v1/regras-reclassificacao-cfop/{regra_id}/excecoes/{excecao['id']}"
    )
    assert apagar.status_code == 204


def test_api_reclassificacao_rejeita_perfil_inexistente(client):
    res = client.post("/api/v1/regras-reclassificacao-cfop", json={
        "perfil_regras_id": 99999,
        "ncm": "73269090",
        "cfop_destino_sufixo": "405",
    })
    assert res.status_code == 404, res.text





