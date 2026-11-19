from decimal import Decimal

import pytest

from app.core.exceptions import RuleResolutionException
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_fcp_produto import ExcecaoFcpProduto, RegraFcpProduto
from app.services.rules_engine.aliquota_resolver import AliquotaResolver


@pytest.fixture
def perfil(db_session) -> PerfilRegras:
    p = PerfilRegras(nome="Perfil FCP Resolver")
    db_session.add(p)
    db_session.commit()
    return p


def test_nivel_padrao_casa_prefixo_ncm_mais_especifico(db_session, perfil):
    db_session.add_all(
        [
            RegraAliquotaDestino(
                perfil_regras_id=perfil.id,
                uf="BA",
                ncm=None,
                aliquota=Decimal("0.2050"),
            ),
            RegraAliquotaDestino(
                perfil_regras_id=perfil.id,
                uf="BA",
                ncm="2203",
                aliquota=Decimal("0.2500"),
            ),
            RegraAliquotaDestino(
                perfil_regras_id=perfil.id,
                uf="BA",
                ncm="22030000",
                aliquota=Decimal("0.2700"),
            ),
        ]
    )
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    res_exato = resolver.resolve_a_dst(perfil.id, "BA", "22030000")
    assert res_exato.aliquota == Decimal("0.2700")
    assert res_exato.origem.startswith("regra_ncm:")

    res_prefixo = resolver.resolve_a_dst(perfil.id, "BA", "22039900")
    assert res_prefixo.aliquota == Decimal("0.2500")
    assert res_prefixo.origem.startswith("regra_ncm:")

    res_formatado = resolver.resolve_a_dst(perfil.id, "BA", "2203.00.00")
    assert res_formatado.aliquota == Decimal("0.2700")

    res_padrao = resolver.resolve_a_dst(perfil.id, "BA", "22011000")
    assert res_padrao.aliquota == Decimal("0.2050")
    assert res_padrao.origem.startswith("padrao_uf:")

    res_zerado = resolver.resolve_a_dst(perfil.id, "BA", "00000000")
    assert res_zerado.aliquota == Decimal("0.2050")
    assert res_zerado.origem.startswith("padrao_uf:")


def test_fcp_precedencia_excecao_termos_generica_e_filtro_uf(db_session, perfil):
    regra_refri = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22021000",
        termos_inclusao=["REFRIGERANTE", "REFRI*"],
        termos_exclusao=["AGUA"],
        aliquota=Decimal("0.0200"),
        descricao="Refrigerantes BA",
    )
    regra_se = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="SE",
        ncm="22021000",
        termos_inclusao=[],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        descricao="Bebidas SE",
    )
    regra_cerveja_gen = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="2203",
        termos_inclusao=[],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        descricao="Cervejas genérica",
    )
    regra_cerveja_esp = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22030000",
        termos_inclusao=["CRAFT"],
        termos_exclusao=[],
        aliquota=Decimal("0.0400"),
        descricao="Cerveja artesanal",
    )
    db_session.add_all([regra_refri, regra_se, regra_cerveja_gen, regra_cerveja_esp])
    db_session.commit()

    exc_neg = ExcecaoFcpProduto(
        regra_fcp_id=regra_refri.id,
        descricao_exata="REFRIGERANTE DIET ESPECIAL",
        enquadrado=False,
    )
    exc_pos = ExcecaoFcpProduto(
        regra_fcp_id=regra_refri.id,
        descricao_exata="GUARANA DO NORTE",
        enquadrado=True,
    )
    db_session.add_all([exc_neg, exc_pos])
    db_session.commit()

    resolver = AliquotaResolver(db_session)
    resolver.preload(perfil.id)

    # Exceção negativa bloqueia mesmo casando termo de inclusão
    assert (
        resolver.resolve_fcp(
            perfil.id, "BA", "22021000", descricao="Refrigerante Diet Especial"
        )
        is None
    )

    # Exceção positiva aplica origem excecao_fcp:<id> mesmo sem casar termo
    res_pos = resolver.resolve_fcp(
        perfil.id, "BA", "22021000", descricao="Guaraná do Norte"
    )
    assert res_pos is not None
    assert res_pos.aliquota == Decimal("0.0200")
    assert res_pos.origem == f"excecao_fcp:{exc_pos.id}"

    # Termos inclusão/exclusão em 22021000
    res_refri = resolver.resolve_fcp(
        perfil.id, "BA", "22021000", descricao="REFRIGERANTE COLA 2L"
    )
    assert res_refri is not None
    assert res_refri.aliquota == Decimal("0.0200")
    assert res_refri.origem == f"fcp_produto:{regra_refri.id}"

    assert (
        resolver.resolve_fcp(
            perfil.id, "BA", "22021000", descricao="REFRIGERANTE COM AGUA MINERAL"
        )
        is None
    )
    assert (
        resolver.resolve_fcp(
            perfil.id, "BA", "22021000", descricao="AGUA MINERAL 500ML"
        )
        is None
    )

    # Regra com termos tem precedência sobre genérica, e regra de SE não casa BA
    res_craft = resolver.resolve_fcp(
        perfil.id, "BA", "22030000", descricao="CERVEJA CRAFT IPA"
    )
    assert res_craft is not None
    assert res_craft.aliquota == Decimal("0.0400")
    assert res_craft.origem == f"fcp_produto:{regra_cerveja_esp.id}"

    res_comum = resolver.resolve_fcp(
        perfil.id, "BA", "22030000", descricao="CERVEJA PILSEN"
    )
    assert res_comum is not None
    assert res_comum.aliquota == Decimal("0.0200")
    assert res_comum.origem == f"fcp_produto:{regra_cerveja_gen.id}"


def test_fcp_sem_descricao_confiavel_casa_generica_mas_nao_regra_com_termos(
    db_session, perfil
):
    regra_generica = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="2203",
        termos_inclusao=[],
        termos_exclusao=["SEM ALCOOL"],
        aliquota=Decimal("0.0200"),
        descricao="Cervejas",
    )
    regra_com_termos = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22021000",
        termos_inclusao=["REFRIGERANTE"],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        descricao="Refrigerantes",
    )
    db_session.add_all([regra_generica, regra_com_termos])
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    # Sem descrição confiável: regra genérica casa (inclusive quando possui termos_exclusao)
    res_gen = resolver.resolve_fcp(perfil.id, "BA", "22030000", descricao=None)
    assert res_gen is not None
    assert res_gen.aliquota == Decimal("0.0200")
    assert res_gen.origem == f"fcp_produto:{regra_generica.id}"

    res_gen_vazia = resolver.resolve_fcp(perfil.id, "BA", "22030000", descricao="")
    assert res_gen_vazia is not None
    assert res_gen_vazia.aliquota == Decimal("0.0200")

    # Com descrição confiável que casa exclusão da genérica, é excluída
    assert (
        resolver.resolve_fcp(
            perfil.id, "BA", "22030000", descricao="CERVEJA SEM ALCOOL 350ML"
        )
        is None
    )

    # Sem descrição confiável: regra apenas com termos_inclusao NÃO casa
    assert resolver.resolve_fcp(perfil.id, "BA", "22021000", descricao=None) is None


def test_fcp_respeita_aplicar_com_termo_acordo(db_session, perfil):
    regra_sem_acordo = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="2203",
        termos_inclusao=[],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        aplicar_com_termo_acordo=False,
        descricao="Sem termo de acordo",
    )
    regra_com_acordo = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="2204",
        termos_inclusao=[],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        aplicar_com_termo_acordo=True,
        descricao="Com ou sem termo de acordo",
    )
    db_session.add_all([regra_sem_acordo, regra_com_acordo])
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    assert (
        resolver.resolve_fcp(
            perfil.id, "BA", "22030000", empresa_tem_termo_acordo=True
        )
        is None
    )
    res_sem = resolver.resolve_fcp(
        perfil.id, "BA", "22030000", empresa_tem_termo_acordo=False
    )
    assert res_sem is not None
    assert res_sem.aliquota == Decimal("0.0200")

    res_ambos_true = resolver.resolve_fcp(
        perfil.id, "BA", "22041000", empresa_tem_termo_acordo=True
    )
    res_ambos_false = resolver.resolve_fcp(
        perfil.id, "BA", "22041000", empresa_tem_termo_acordo=False
    )
    assert res_ambos_true is not None and res_ambos_true.aliquota == Decimal("0.0200")
    assert res_ambos_false is not None and res_ambos_false.aliquota == Decimal("0.0200")


def test_fcp_colisao_mesmo_valor_gera_aviso_e_divergente_lanca_excecao(
    db_session, perfil
):
    regra_a = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22021000",
        termos_inclusao=["REFRI*"],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        descricao="Regra FCP A",
    )
    regra_b = RegraFcpProduto(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="22021000",
        termos_inclusao=["REFRIGERANTE"],
        termos_exclusao=[],
        aliquota=Decimal("0.0200"),
        descricao="Regra FCP B",
    )
    db_session.add_all([regra_a, regra_b])
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    # Mesmo valor (0.02): aplica e preenche aviso
    res_igual = resolver.resolve_fcp(
        perfil.id, "BA", "22021000", descricao="REFRIGERANTE GUARANA"
    )
    assert res_igual is not None
    assert res_igual.aliquota == Decimal("0.0200")
    assert res_igual.origem == f"fcp_produto:{min(regra_a.id, regra_b.id)}"
    assert res_igual.aviso is not None
    assert "FCP" in res_igual.aviso

    # Valores divergentes (0.02 vs 0.04): lança RuleResolutionException
    regra_b.aliquota = Decimal("0.0400")
    db_session.commit()

    with pytest.raises(RuleResolutionException) as exc_info:
        resolver.resolve_fcp(
            perfil.id, "BA", "22021000", descricao="REFRIGERANTE GUARANA"
        )
    assert "FCP" in str(exc_info.value)
    assert "22021000" in str(exc_info.value)
