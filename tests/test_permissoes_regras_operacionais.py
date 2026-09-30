from decimal import Decimal

from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.models.regra_reclassificacao_cfop import (
    ExcecaoReclassificacaoCfop,
    RegraReclassificacaoCfop,
)
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto


def _autenticar_como_analista(client):
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "operador@contabilidade.com", "password": "fiscal"},
    )
    assert login.status_code == 200, login.text
    assert login.json()["user"]["cargo"] == "Analista Fiscal"
    assert login.json()["user"]["role"] == "operador"
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"


def test_analista_pode_excluir_regras_operacionais_mas_nao_perfil(client, db_session):
    perfil = PerfilRegras(nome="Perfil permissao exclusao analista")
    db_session.add(perfil)
    db_session.flush()

    regra_reclassificacao = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
        termos_exclusao=[],
    )
    regra_reducao = RegraReducaoProduto(
        perfil_regras_id=perfil.id,
        ncm="72142000",
        termos_inclusao=["VERGALHAO*"],
        termos_exclusao=[],
        aliquota=Decimal("0.0400"),
    )
    regra_exclusao = RegraExclusaoParcial(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="02102000",
        termos_obrigatorios=["CHARQUE"],
        motivo="isencao",
        ativo=True,
    )
    regra_aliquota = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="SE",
        ncm="99999999",
        aliquota=Decimal("0.1700"),
        parametros_extras={},
    )
    regra_cfop = RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="999",
        destino="ignorar",
        descricao="Regra de teste de permissao",
    )
    db_session.add_all(
        [
            regra_reclassificacao,
            regra_reducao,
            regra_exclusao,
            regra_aliquota,
            regra_cfop,
        ]
    )
    db_session.flush()

    excecao_reclassificacao = ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra_reclassificacao.id,
        descricao_exata="GRAMPO ESPECIAL",
        aplicar=False,
    )
    excecao_reducao = ExcecaoReducaoProduto(
        regra_reducao_id=regra_reducao.id,
        descricao_exata="VERGALHAO ESPECIAL",
        enquadrado=False,
    )
    db_session.add_all([excecao_reclassificacao, excecao_reducao])
    db_session.commit()

    ids = {
        "perfil": perfil.id,
        "reclassificacao": regra_reclassificacao.id,
        "excecao_reclassificacao": excecao_reclassificacao.id,
        "reducao": regra_reducao.id,
        "excecao_reducao": excecao_reducao.id,
        "exclusao": regra_exclusao.id,
        "aliquota": regra_aliquota.id,
        "cfop": regra_cfop.id,
    }

    _autenticar_como_analista(client)

    res = client.delete(
        f"/api/v1/regras-reclassificacao-cfop/{ids['reclassificacao']}/excecoes/"
        f"{ids['excecao_reclassificacao']}"
    )
    assert res.status_code == 204, res.text

    res = client.delete(
        f"/api/v1/regras-reducao-produto/{ids['reducao']}/excecoes/{ids['excecao_reducao']}"
    )
    assert res.status_code == 204, res.text

    endpoints = [
        f"/api/v1/regras-reclassificacao-cfop/{ids['reclassificacao']}",
        f"/api/v1/regras-reducao-produto/{ids['reducao']}",
        f"/api/v1/regras-exclusao-parcial/{ids['exclusao']}",
        f"/api/v1/regras-aliquotas/{ids['aliquota']}",
        f"/api/v1/regras-cfop/{ids['cfop']}",
    ]
    for endpoint in endpoints:
        res = client.delete(endpoint)
        assert res.status_code == 204, f"{endpoint}: {res.text}"

    # A ampliação é restrita às regras operacionais. O perfil continua sendo
    # uma entidade administrativa e não pode ser removido por Analista Fiscal.
    res = client.delete(f"/api/v1/perfis-regras/{ids['perfil']}")
    assert res.status_code == 403, res.text
