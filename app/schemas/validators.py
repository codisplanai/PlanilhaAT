"""Validadores reutilizados pelos schemas de regras de alíquota."""

import re
from decimal import Decimal
from typing import List, Optional

from app.services.rules_engine.descricao_matcher import normalizar

# NCM que o extrator do SPED usa quando o item não consta no registro 0200.
# É ausência de dado, não NCM: uma regra cadastrada nele capturaria tudo o que
# o SPED não conseguiu identificar.
NCM_SENTINELA = "00000000"


def clean_ncm(v: Optional[str]) -> Optional[str]:
    """NCM de 8 dígitos, ou None para 'regra padrão do estado'."""
    if v is None or v.strip() == "":
        return None
    cleaned = re.sub(r"\D", "", v)
    if len(cleaned) != 8:
        raise ValueError("NCM deve conter 8 dígitos ou ser vazio/nulo para regra padrão do estado")
    return cleaned


def clean_ncm_obrigatorio(v: str) -> str:
    """NCM de 8 dígitos, obrigatório e diferente do sentinela do SPED."""
    cleaned = clean_ncm(v)
    if cleaned is None:
        raise ValueError("NCM é obrigatório na regra de redução por produto")
    if cleaned == NCM_SENTINELA:
        raise ValueError(
            "NCM 00000000 é o marcador de item sem NCM no SPED e não pode ter regra de redução"
        )
    return cleaned


def normalizar_aliquota(v: Optional[Decimal]) -> Optional[Decimal]:
    """Aceita 0.1206 e 12.06, devolvendo sempre a forma decimal unitária."""
    if v is None:
        return None
    if v < 0 or v > 1:
        if 1 < v <= 100:
            return v / Decimal("100")
        raise ValueError("Alíquota deve estar entre 0 e 1 (ex: 0.1800)")
    return v


def normalizar_termos(termos: Optional[List[str]]) -> List[str]:
    """Normaliza cada termo preservando o wildcard de prefixo e descarta vazios."""
    limpos: List[str] = []
    for termo in termos or []:
        bruto = (termo or "").strip()
        prefixo = bruto.endswith("*")
        if prefixo:
            bruto = bruto[:-1]
        alvo = normalizar(bruto)
        if not alvo:
            continue
        limpos.append(f"{alvo}*" if prefixo else alvo)
    return limpos


def clean_cfop_sufixo(v: Optional[str]) -> Optional[str]:
    """Aceita CFOP de 3 dígitos (sufixo) ou 4 dígitos completos, devolvendo o sufixo de 3 dígitos."""
    if v is None or str(v).strip() == "":
        return None
    cleaned = re.sub(r"\D", "", str(v))
    if len(cleaned) == 4:
        return cleaned[-3:]
    if len(cleaned) == 3:
        return cleaned
    raise ValueError("CFOP deve conter 3 ou 4 dígitos numéricos (ex: 405 ou 6405)")


def clean_cfop_sufixo_obrigatorio(v: str) -> str:
    """CFOP de destino obrigatório normalizado para sufixo de 3 dígitos."""
    sufixo = clean_cfop_sufixo(v)
    if sufixo is None:
        raise ValueError("CFOP de destino é obrigatório")
    return sufixo

