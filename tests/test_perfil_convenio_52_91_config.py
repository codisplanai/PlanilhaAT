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
