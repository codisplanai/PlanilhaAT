"""Normalização e casamento de descrições de produto.

Funções puras, sem banco: decidir enquadramento a partir de texto livre escrito
pelo emitente é a parte mais frágil do motor de regras, e precisa ser testável
isoladamente.
"""

import re
import unicodedata
from typing import List, Optional

_NAO_ALFANUM = re.compile(r"[^A-Z0-9]+")


def normalizar(texto: Optional[str]) -> str:
    """Reduz uma descrição a tokens comparáveis.

    Sem acento, em maiúsculas, com pontuação virando espaço — é o que faz
    "VERG. CA50" e "VERG CA50" convergirem para a mesma forma.
    """
    if not texto:
        return ""
    decomposto = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in decomposto if not unicodedata.combining(c))
    return _NAO_ALFANUM.sub(" ", sem_acento.upper()).strip()


def _padrao_token(token: str, ultimo: bool, prefixo: bool) -> str:
    if ultimo and prefixo:
        if token.startswith("VERGALH"):
            return rf"(?:{re.escape(token)}[A-Z0-9]*|VERG(?![A-Z0-9]))"
        return rf"{re.escape(token)}[A-Z0-9]*"
    if token in {"VERGALHAO", "VERGALHOES"}:
        return rf"(?:{re.escape(token)}|VERG)(?![A-Z0-9])"
    return rf"{re.escape(token)}(?![A-Z0-9])"


def _compilar(termo_normalizado: str, prefixo: bool) -> "re.Pattern[str]":
    tokens = termo_normalizado.split()
    partes = [
        _padrao_token(t, idx == len(tokens) - 1, prefixo)
        for idx, t in enumerate(tokens)
    ]
    corpo = r"\s+".join(partes)
    return re.compile(rf"(?<![A-Z0-9]){corpo}")


def casa_termo(descricao_normalizada: str, termo: str) -> bool:
    """True se o termo aparece como sequência de tokens completos na descrição.

    Casar por substring seria armadilha: "ferro" pegaria "FERROVIARIO" e "aco"
    pegaria "ACOLCHOADO". Um '*' no fim do termo libera o casamento por prefixo,
    então "vergalh*" casa VERGALHAO e VERGALHOES mas não casa VERGA.
    """
    bruto = (termo or "").strip()
    prefixo = bruto.endswith("*")
    if prefixo:
        bruto = bruto[:-1]
    alvo = normalizar(bruto)
    if not alvo or not descricao_normalizada:
        return False
    return _compilar(alvo, prefixo).search(descricao_normalizada) is not None


def casa_algum(descricao_normalizada: str, termos: Optional[List[str]]) -> bool:
    return any(casa_termo(descricao_normalizada, t) for t in (termos or []))


def casa_todos(descricao_normalizada: str, termos: Optional[List[str]]) -> bool:
    """True se todos os termos aparecem como palavras completas na descrição."""
    if not termos:
        return False
    return all(casa_termo(descricao_normalizada, t) for t in termos)

