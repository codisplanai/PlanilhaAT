from decimal import Decimal

import pytest

from app.core.exceptions import ValidationException
from app.services.rules_engine.revenda_antecipacao_policy import (
    RevendaAntecipacaoTributariaPolicy,
)


CONFIG = {
    "mva_revenda_antecipacao_tributaria": {
        "enabled": True,
        "empresa_cnpj": "33906322000153",
        "special_ncms": [
            "42022100", "42022210", "42022220", "42022900",
            "42023100", "42023200", "42023900", "42033000",
            "64019990", "64021900", "64022000", "64029190",
            "64029990", "64035990", "64039190", "64039990",
            "64041100", "64041900", "64059000",
        ],
        "description_fallback_ncms": ["61178090", "62171000", "63072000"],
        "special_keywords": ["CINTO", "CINTOS"],
        "exclusion_keywords": [
            "MOCHILA", "MOCHILAS", "MALA", "MALAS", "PASTA", "PASTAS",
            "NECESSAIRE", "NECESSAIRES", "PALMILHA", "PALMILHAS",
            "CALCANHEIRA", "CALCANHEIRAS",
        ],
        "mvas": {
            "especial": {"4": "61.81", "7": "56.75", "12": "48.33", "original": "34.00"},
            "demais": {"4": "69.06", "7": "63.77", "12": "54.97", "original": "40.00"},
        },
    }
}


def _config(cnpj="33906322000153"):
    return RevendaAntecipacaoTributariaPolicy.config_for_empresa(CONFIG, cnpj)


@pytest.mark.parametrize(
    ("a_ori", "expected"),
    [
        (Decimal("0.04"), Decimal("61.81")),
        (Decimal("0.07"), Decimal("56.75")),
        (Decimal("0.12"), Decimal("48.33")),
    ],
)
def test_mva_especial_por_aliquota(a_ori, expected):
    config = _config()
    classificacao = RevendaAntecipacaoTributariaPolicy.classify(
        config=config,
        ncm="64039990",
        descricao="CALCADO FEMININO",
        descricao_confiavel=True,
    )
    assert classificacao.grupo == "especial"
    assert RevendaAntecipacaoTributariaPolicy.resolve_mva(
        config=config,
        grupo=classificacao.grupo,
        a_ori=a_ori,
        fornecedor_simples=False,
    ) == expected


@pytest.mark.parametrize(
    ("a_ori", "expected"),
    [
        (Decimal("0.04"), Decimal("69.06")),
        (Decimal("0.07"), Decimal("63.77")),
        (Decimal("0.12"), Decimal("54.97")),
    ],
)
def test_mva_demais_por_aliquota(a_ori, expected):
    config = _config()
    classificacao = RevendaAntecipacaoTributariaPolicy.classify(
        config=config,
        ncm="95030099",
        descricao="OUTRO PRODUTO PARA REVENDA",
        descricao_confiavel=True,
    )
    assert classificacao.grupo == "demais"
    assert RevendaAntecipacaoTributariaPolicy.resolve_mva(
        config=config,
        grupo=classificacao.grupo,
        a_ori=a_ori,
        fornecedor_simples=False,
    ) == expected


def test_fornecedor_simples_usa_mva_original_do_grupo():
    config = _config()
    assert RevendaAntecipacaoTributariaPolicy.resolve_mva(
        config=config,
        grupo="especial",
        a_ori=Decimal("0.07"),
        fornecedor_simples=True,
    ) == Decimal("34.00")
    assert RevendaAntecipacaoTributariaPolicy.resolve_mva(
        config=config,
        grupo="demais",
        a_ori=Decimal("0.07"),
        fornecedor_simples=True,
    ) == Decimal("40.00")


def test_fallback_controlado_de_cinto_em_ncm_amplo():
    config = _config()
    classificacao = RevendaAntecipacaoTributariaPolicy.classify(
        config=config,
        ncm="62171000",
        descricao="CINTO MASCULINO",
        descricao_confiavel=True,
    )
    assert classificacao.grupo == "especial"
    assert classificacao.fonte == "ncm_fallback_descricao"


def test_ncm_amplo_sem_descricao_de_cinto_permanece_demais():
    config = _config()
    classificacao = RevendaAntecipacaoTributariaPolicy.classify(
        config=config,
        ncm="62171000",
        descricao="ACESSORIO TEXTIL",
        descricao_confiavel=True,
    )
    assert classificacao.grupo == "demais"


@pytest.mark.parametrize(
    "descricao",
    ["MOCHILA ESPORTIVA", "MALA VIAGEM", "NECESSAIRE", "PALMILHA GEL", "CALCANHEIRA"],
)
def test_exclusoes_de_descricao_nao_entram_no_grupo_especial(descricao):
    config = _config()
    classificacao = RevendaAntecipacaoTributariaPolicy.classify(
        config=config,
        ncm="42022210",
        descricao=descricao,
        descricao_confiavel=True,
    )
    assert classificacao.grupo == "demais"
    assert classificacao.fonte == "descricao_exclusao"


def test_configuracao_so_aplica_ao_cnpj_autorizado():
    assert _config("33906322000153") is not None
    assert _config("12345678000195") is None


def test_perfil_sem_configuracao_nao_aplica_regra():
    assert RevendaAntecipacaoTributariaPolicy.config_for_empresa({}, "33906322000153") is None


def test_configuracao_sem_cnpj_nao_ativa_regra_especial():
    config_sem_cnpj = {
        "mva_revenda_antecipacao_tributaria": {
            **CONFIG["mva_revenda_antecipacao_tributaria"]
        }
    }
    config_sem_cnpj["mva_revenda_antecipacao_tributaria"].pop("empresa_cnpj")
    assert (
        RevendaAntecipacaoTributariaPolicy.config_for_empresa(
            config_sem_cnpj,
            "33906322000153",
        )
        is None
    )


def test_aliquota_origem_fora_da_matriz_falha_sem_assumir_valor():
    with pytest.raises(ValidationException):
        RevendaAntecipacaoTributariaPolicy.resolve_mva(
            config=_config(),
            grupo="especial",
            a_ori=Decimal("0.18"),
            fornecedor_simples=False,
        )
