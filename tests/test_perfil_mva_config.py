import pytest
from pydantic import ValidationError

from app.schemas.perfil_regras import PerfilRegrasUpdate


VALID_CONFIG = {
    "enabled": True,
    "empresa_cnpj": "33.906.322/0001-53",
    "special_ncms": ["6403.99.90", "42033000"],
    "description_fallback_ncms": ["62171000"],
    "special_keywords": ["cinto"],
    "exclusion_keywords": ["mochila", "palmilha"],
    "mvas": {
        "especial": {
            "4": "61,81",
            "7": "56.75",
            "12": 48.33,
            "original": "34",
        },
        "demais": {
            "4": "69.06",
            "7": "63.77",
            "12": "54.97",
            "original": 40,
        },
    },
}


def test_normaliza_configuracao_mva_do_perfil():
    payload = PerfilRegrasUpdate(
        configuracoes_extras={
            "mva_revenda_antecipacao_tributaria": VALID_CONFIG,
        }
    )

    config = payload.configuracoes_extras["mva_revenda_antecipacao_tributaria"]

    assert config["empresa_cnpj"] == "33906322000153"
    assert config["special_ncms"] == ["64039990", "42033000"]
    assert config["special_keywords"] == ["CINTO"]
    assert config["exclusion_keywords"] == ["MOCHILA", "PALMILHA"]
    assert config["mvas"]["especial"]["4"] == "61.81"
    assert config["mvas"]["especial"]["original"] == "34.00"
    assert config["mvas"]["demais"]["original"] == "40.00"


def test_rejeita_configuracao_mva_sem_cnpj_autorizado():
    invalid = {
        **VALID_CONFIG,
        "empresa_cnpj": "",
    }

    with pytest.raises(ValidationError, match="empresa_cnpj"):
        PerfilRegrasUpdate(
            configuracoes_extras={
                "mva_revenda_antecipacao_tributaria": invalid,
            }
        )


def test_rejeita_ncm_invalido_na_configuracao_mva():
    invalid = {
        **VALID_CONFIG,
        "special_ncms": ["6403999"],
    }

    with pytest.raises(ValidationError, match="8 dígitos"):
        PerfilRegrasUpdate(
            configuracoes_extras={
                "mva_revenda_antecipacao_tributaria": invalid,
            }
        )


def test_rejeita_percentual_mva_fora_da_faixa():
    invalid = {
        **VALID_CONFIG,
        "mvas": {
            **VALID_CONFIG["mvas"],
            "especial": {
                **VALID_CONFIG["mvas"]["especial"],
                "7": "999.00",
            },
        },
    }

    with pytest.raises(ValidationError, match="entre 0% e 500%"):
        PerfilRegrasUpdate(
            configuracoes_extras={
                "mva_revenda_antecipacao_tributaria": invalid,
            }
        )
