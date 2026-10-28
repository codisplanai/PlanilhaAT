import pytest
from pydantic import ValidationError

from app.schemas.perfil_regras import PerfilRegrasUpdate


def test_normaliza_config_convenio_52_91():
    payload = PerfilRegrasUpdate(
        configuracoes_extras={
            "convenio_icms_52_91_anexo_i": {
                "enabled": True,
                "aplicar_automaticamente_seguros": True,
                "solicitar_confirmacao_duvidosos": True,
                "considerar_cst20_como_indicio": True,
                "ajustes": [
                    {
                        "id": "x",
                        "ncm": "84.19.81.90",
                        "acao": "revisar",
                        "termos_descricao": [" buffet frio ", "Câmara"],
                        "vigencia_inicio": "2026-01-01",
                        "vigencia_fim": None,
                        "motivo": "conferir",
                    }
                ],
            }
        }
    )
    cfg = payload.configuracoes_extras["convenio_icms_52_91_anexo_i"]
    assert cfg["ajustes"][0]["ncm"] == "84198190"
    assert cfg["ajustes"][0]["termos_descricao"] == ["BUFFET FRIO", "CÂMARA"]


def test_rejeita_ajuste_convenio_com_ncm_invalido():
    with pytest.raises(ValidationError, match="8 dígitos"):
        PerfilRegrasUpdate(
            configuracoes_extras={
                "convenio_icms_52_91_anexo_i": {
                    "enabled": True,
                    "aplicar_automaticamente_seguros": True,
                    "solicitar_confirmacao_duvidosos": True,
                    "considerar_cst20_como_indicio": True,
                    "ajustes": [{"id": "x", "ncm": "8419819", "acao": "revisar"}],
                }
            }
        )



def test_convenio_anexo_ii_e_industrial_independentes():
    payload = PerfilRegrasUpdate(
        configuracoes_extras={
            "convenio_icms_52_91_anexo_i": {
                "enabled": False,
                "aplicar_automaticamente_seguros": True,
                "solicitar_confirmacao_duvidosos": True,
                "considerar_cst20_como_indicio": True,
                "ajustes": [],
            },
            "convenio_icms_52_91_anexo_ii": {
                "enabled": True,
                "aplicar_automaticamente_seguros": False,
                "solicitar_confirmacao_duvidosos": True,
                "considerar_cst20_como_indicio": True,
                "ajustes": [
                    {
                        "id": "agricola",
                        "ncm": "84.67.81.00",
                        "acao": "revisar",
                        "termos_descricao": ["motosserra"],
                        "vigencia_inicio": "2026-06-01",
                    }
                ],
            },
        }
    )
    extra = payload.configuracoes_extras
    assert extra["convenio_icms_52_91_anexo_i"]["enabled"] is False
    assert extra["convenio_icms_52_91_anexo_ii"]["enabled"] is True
    assert extra["convenio_icms_52_91_anexo_ii"]["ajustes"][0]["ncm"] == "84678100"
    assert extra["convenio_icms_52_91_anexo_ii"]["ajustes"][0]["termos_descricao"] == ["MOTOSSERRA"]


def test_rejeita_config_anexo_ii_invalida():
    with pytest.raises(ValidationError, match="convenio_icms_52_91_anexo_ii"):
        PerfilRegrasUpdate(
            configuracoes_extras={"convenio_icms_52_91_anexo_ii": {"enabled": "true"}}
        )
