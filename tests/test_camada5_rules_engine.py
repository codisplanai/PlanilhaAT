import pytest
from decimal import Decimal

from app.core.exceptions import RuleResolutionException
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto
from app.services.rules_engine.aliquota_resolver import AliquotaResolver


@pytest.fixture
def cenario(db_session):
    """Perfil BA com padrão 18%, exceção de NCM 20,5% e empresa vinculada."""
    perfil = PerfilRegras(nome="Perfil Teste BA")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm="84713012", aliquota=Decimal("0.2050")))
    db_session.commit()

    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195",
                      uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()
    return perfil, empresa


def _regra_vergalhao(db_session, perfil, aliquota="0.1200", exclusao=None):
    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["VERGALH*"], termos_exclusao=exclusao or [],
        aliquota=Decimal(aliquota), descricao="Vergalhoes - Decreto 12.345")
    db_session.add(regra)
    db_session.commit()
    return regra


# --- Nível 3: comportamento atual, preservado -------------------------------

def test_rules_engine_precedencia_ncm(db_session, cenario):
    perfil, _ = cenario
    resolver = AliquotaResolver(db_session)

    assert resolver.resolve_a_dst(perfil.id, "BA", "84713012").aliquota == Decimal("0.2050")
    assert resolver.resolve_a_dst(perfil.id, "BA", "39269090").aliquota == Decimal("0.1800")

    with pytest.raises(RuleResolutionException) as exc_info:
        resolver.resolve_a_dst(perfil.id, "SP", "84713012")
    assert "Nenhuma regra de alíquota de destino" in str(exc_info.value)


def test_origem_identifica_o_nivel_que_resolveu(db_session, cenario):
    perfil, _ = cenario
    resolver = AliquotaResolver(db_session)

    assert resolver.resolve_a_dst(perfil.id, "BA", "39269090").origem.startswith("padrao_uf:")
    assert resolver.resolve_a_dst(perfil.id, "BA", "84713012").origem.startswith("regra_ncm:")


# --- Nível 2: termo de acordo ----------------------------------------------

def test_termo_de_acordo_vence_o_padrao_da_uf(db_session, cenario):
    perfil, empresa = cenario
    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "39269090", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1206")
    assert res.origem.startswith("termo_acordo:")


def test_sem_termo_de_acordo_cai_no_padrao(db_session, cenario):
    perfil, empresa = cenario
    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "39269090", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


# --- Nível 1: redução por produto ------------------------------------------

def test_reducao_por_produto_vence_o_termo_de_acordo(db_session, cenario):
    """O caso central: empresa com acordo de 12,06% comprando vergalhão a 12,00%."""
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil)
    db_session.add(RegraAliquotaEmpresa(empresa_id=empresa.id, aliquota=Decimal("0.1206")))
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    vergalhao = resolver.resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VERGALHAO CA-50 10MM", empresa_id=empresa.id)
    assert vergalhao.aliquota == Decimal("0.1200")
    assert vergalhao.origem.startswith("reducao_produto:")

    outro = resolver.resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="BARRA CHATA 3/4", empresa_id=empresa.id)
    assert outro.aliquota == Decimal("0.1206")
    assert outro.origem.startswith("termo_acordo:")


def test_termo_de_exclusao_derruba_a_regra(db_session, cenario):
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil, exclusao=["COBRE"])

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VERGALHAO DE COBRE", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


def test_descricao_ausente_nunca_aplica_reducao(db_session, cenario):
    """SPED consolidado chega aqui: sem descrição real, nada é enquadrado."""
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil)

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao=None, empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


def test_excecao_negativa_derruba_para_o_nivel_seguinte(db_session, cenario):
    perfil, empresa = cenario
    regra = _regra_vergalhao(db_session, perfil)
    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.commit()

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="Vergalhão de cobre", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


def test_excecao_positiva_aplica_mesmo_sem_termo_casar(db_session, cenario):
    perfil, empresa = cenario
    regra = _regra_vergalhao(db_session, perfil)
    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VG CA50 10 0", enquadrado=True))
    db_session.commit()

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VG CA50 10.0", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1200")
    assert res.origem.startswith("excecao:")


# --- Conflito ---------------------------------------------------------------

def test_conflito_de_regras_falha_com_mensagem_acionavel(db_session, cenario):
    perfil, empresa = cenario
    regra_a = _regra_vergalhao(db_session, perfil)
    regra_b = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["BARRA CHATA"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas")
    db_session.add(regra_b)
    db_session.commit()

    with pytest.raises(RuleResolutionException) as exc_info:
        AliquotaResolver(db_session).resolve_a_dst(
            perfil.id, "BA", "72142000",
            descricao="VERGALHAO BARRA CHATA 10MM", empresa_id=empresa.id)

    msg = str(exc_info.value)
    assert "VERGALHAO BARRA CHATA 10MM" in msg   # o item
    assert "72142000" in msg                      # o NCM
    assert f"#{regra_a.id}" in msg                # as regras que colidiram
    assert f"#{regra_b.id}" in msg
    assert "exceção" in msg.lower()               # a instrução


def test_duas_excecoes_para_a_mesma_descricao_tambem_conflitam(db_session, cenario):
    """O único é (regra, descrição), então duas regras do mesmo NCM podem carregar
    o mesmo texto. Nesse caso a alíquota da regra pai seria ambígua."""
    perfil, empresa = cenario
    regra_a = _regra_vergalhao(db_session, perfil)
    regra_b = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["BARRA CHATA"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas")
    db_session.add(regra_b)
    db_session.commit()

    for regra in (regra_a, regra_b):
        db_session.add(ExcecaoReducaoProduto(
            regra_reducao_id=regra.id, descricao_exata="PECA AMBIGUA", enquadrado=True))
    db_session.commit()

    with pytest.raises(RuleResolutionException) as exc_info:
        AliquotaResolver(db_session).resolve_a_dst(
            perfil.id, "BA", "72142000", descricao="Peça ambígua", empresa_id=empresa.id)
    assert "exceções" in str(exc_info.value)


def test_preload_resolve_sem_novas_consultas(db_session, cenario):
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil)
    db_session.add(RegraAliquotaEmpresa(empresa_id=empresa.id, aliquota=Decimal("0.1206")))
    db_session.commit()

    resolver = AliquotaResolver(db_session)
    resolver.preload(perfil.id, empresa.id)

    res = resolver.resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VERGALHAO CA-50", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1200")
