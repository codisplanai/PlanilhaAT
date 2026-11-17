"""Validadores reutilizados pelos schemas da API."""

import os
import re
from decimal import Decimal
from typing import Any, List, Optional

from app.constants import NCM_SENTINELA, UFS_BRASIL
from app.services.rules_engine.descricao_matcher import normalizar


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


def clean_ncm_prefixo_obrigatorio(v: str) -> str:
    """NCM completo (8 dígitos) ou prefixo de posição/subposição (4 a 8 dígitos)."""
    if v is None or str(v).strip() == "":
        raise ValueError("NCM é obrigatório na regra de redução por produto")
    cleaned = re.sub(r"\D", "", str(v))
    if not (4 <= len(cleaned) <= 8):
        raise ValueError("NCM deve conter de 4 a 8 dígitos numéricos (ex: 7217, 7314.31 ou 72142000)")
    if set(cleaned) == {"0"}:
        raise ValueError(
            "NCM zerado (00000000) é o marcador de item sem NCM no SPED e não pode ter regra de redução"
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


def clean_email(value: str) -> str:
    """Normaliza e valida um endereço de e-mail."""
    clean = value.strip().lower()
    if clean.count("@") != 1 or clean.startswith("@") or clean.endswith("@"):
        raise ValueError("E-mail inválido")
    return clean


def clean_uf(value: Optional[str]) -> Optional[str]:
    """Normaliza e valida sigla de UF brasileira, preservando None."""
    if value is None:
        return None
    clean = value.strip().upper()
    if clean not in UFS_BRASIL:
        raise ValueError("UF inválida")
    return clean


def ensure_str_uuid(value: Any) -> Any:
    """Converte UUID para string na serialização, preservando None."""
    return str(value) if value is not None else value


def hide_internal_path(value: Any) -> Any:
    """Expõe apenas o nome do arquivo em respostas da API."""
    return os.path.basename(str(value).replace("\\", "/")) if value else value

