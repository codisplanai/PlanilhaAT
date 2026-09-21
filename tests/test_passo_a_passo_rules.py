from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.core.exceptions import ValidationException
from app.services.rules_engine.company_special_tax_rules import CompanySpecialTaxRules


CONFIG = {
    "antecipacao_tributaria_revenda": {
        "enabled": True,
        "empresa_cnpj": "33906322000153",
        "destinos_revenda": ["antecipacao_parcial"],
        "special_ncms": [
            "42022100", "42022210", "42022220", "42022900",
            "42023100", "42023200", "42023900", "42033000",
            "64019990", "64021900", "64022000", "64029190",
            "64029990", "64035990", "64039190", "64039990",
            "64041100", "64041900", "64059000",
        ],
        "description_fallback_ncms": ["61178090", "62171000", "63072000"],
        "description_fallback_terms": ["CINTO", "CINTOS"],
        "special_exclusion_terms": [
            "MOCHILA", "MOCHILAS", "MALA", "MALAS", "PASTA", "PASTAS",
            "NECESSAIRE", "NECESSAIRES", "PALMILHA", "PALMILHAS",
            "CALCANHEIRA", "CALCANHEIRAS",
        ],
        "mva": {
            "especial": {"4": "61.81", "7": "56.75", "12": "48.33", "original": "34.00"},
            "demais": {"4": "69.06", "7": "63.77", "12": "54.97", "original": "40.00"},
        },
    }
}


def _empresa(cnpj="33906322000153", config=None):
    perfil = SimpleNamespace(configuracoes_extras=config if config is not None else CONFIG)
    return SimpleNamespace(cnpj=cnpj, perfil_regras=perfil)


@pytest.mark.parametrize(
    ("a_ori", "expected"),
    [
        (Decimal("0.04"), Decimal("61.81")),
        (Decimal("0.07"), Decimal("56.75")),
        (Decimal("0.12"), Decimal("48.33")),
    ],
)
def test_mva_especial_por_aliquota(a_ori, expected):
    result = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="64039990",
        descricao="CALCADO FEMININO",
        descricao_confiavel=True,
        a_ori=a_ori,
        fornecedor_crt="3",
    )
    assert result.applicable is True
    assert result.group == "especial"
    assert result.value == expected
    assert result.source.startswith("ncm_exato:")


@pytest.mark.parametrize(
    ("a_ori", "expected"),
    [
        (Decimal("0.04"), Decimal("69.06")),
        (Decimal("0.07"), Decimal("63.77")),
        (Decimal("0.12"), Decimal("54.97")),
    ],
)
def test_mva_demais_por_aliquota(a_ori, expected):
    result = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="95030099",
        descricao="OUTRO PRODUTO PARA REVENDA",
        descricao_confiavel=True,
        a_ori=a_ori,
        fornecedor_crt="3",
    )
    assert result.group == "demais"
    assert result.value == expected


def test_fornecedor_simples_usa_mva_original_do_grupo():
    especial = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="42033000",
        descricao="CINTO COURO",
        descricao_confiavel=True,
        a_ori=Decimal("0.07"),
        fornecedor_crt="1",
    )
    demais = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="95030099",
        descricao="OUTRO PRODUTO",
        descricao_confiavel=True,
        a_ori=Decimal("0.07"),
        fornecedor_crt="2",
    )
    assert especial.value == Decimal("34.00")
    assert demais.value == Decimal("40.00")
    assert "mva_original_simples" in especial.source
    assert "mva_original_simples" in demais.source


def test_fallback_controlado_de_cinto_em_ncm_amplo():
    result = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="62171000",
        descricao="CINTO MASCULINO",
        descricao_confiavel=True,
        a_ori=Decimal("0.12"),
        fornecedor_crt="3",
    )
    assert result.group == "especial"
    assert result.value == Decimal("48.33")
    assert result.source.startswith("descricao_cinto_fallback:")


def test_ncm_amplo_sem_descricao_de_cinto_permanece_demais():
    result = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="62171000",
        descricao="ACESSORIO TEXTIL",
        descricao_confiavel=True,
        a_ori=Decimal("0.12"),
        fornecedor_crt="3",
    )
    assert result.group == "demais"
    assert result.value == Decimal("54.97")


@pytest.mark.parametrize("descricao", ["MOCHILA ESPORTIVA", "MALA VIAGEM", "NECESSAIRE", "PALMILHA GEL", "CALCANHEIRA"])
def test_exclusoes_de_descricao_nao_entram_no_grupo_especial(descricao):
    result = CompanySpecialTaxRules.resolve_mva(
        empresa=_empresa(),
        ncm="42022210",
        descricao=descricao,
        descricao_confiavel=True,
        a_ori=Decimal("0.07"),
        fornecedor_crt="3",
    )
    assert result.group == "demais"
    assert result.value == Decimal("63.77")
    assert result.source.startswith("descricao_exclusao:")


def test_regra_so_roteia_empresa_configurada():
    assert CompanySpecialTaxRules.route_revenda_to_tributaria(
        _empresa(), "antecipacao_parcial"
    ) is True
    assert CompanySpecialTaxRules.route_revenda_to_tributaria(
        _empresa(cnpj="12345678000195"), "antecipacao_parcial"
    ) is False
    assert CompanySpecialTaxRules.route_revenda_to_tributaria(
        _empresa(), "difal"
    ) is False


def test_perfil_sem_configuracao_nao_aplica_regra():
    empresa = _empresa(config={})
    result = CompanySpecialTaxRules.resolve_mva(
        empresa=empresa,
        ncm="64039990",
        descricao="CALCADO",
        descricao_confiavel=True,
        a_ori=Decimal("0.07"),
        fornecedor_crt="3",
    )
    assert result.applicable is False


def test_aliquota_origem_fora_da_matriz_falha_sem_assumir_valor():
    with pytest.raises(ValidationException):
        CompanySpecialTaxRules.resolve_mva(
            empresa=_empresa(),
            ncm="64039990",
            descricao="CALCADO",
            descricao_confiavel=True,
            a_ori=Decimal("0.18"),
            fornecedor_crt="3",
        )
