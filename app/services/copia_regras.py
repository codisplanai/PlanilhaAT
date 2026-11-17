"""Cópia de regras em tabela de um perfil para outros perfis.

Regras já existentes no destino (mesma chave de duplicidade) são ignoradas,
nunca sobrescritas. Exceções acompanham a regra de redução e de reclassificação.
"""
from copy import deepcopy
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, TypeVar

from sqlalchemy.orm import Session

from app.constants import ANTECIPACAO_PARCIAL
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop
from app.models.regra_reducao_produto import RegraReducaoProduto

_ModelT = TypeVar("_ModelT")


def _termos(valor: Optional[Iterable[str]]) -> Tuple[str, ...]:
    return tuple(sorted(valor or []))


# secao -> (relacao em PerfilRegras, modelo, chave de duplicidade)
SECOES: Dict[str, Tuple[str, type, Callable[[Any], Tuple[Any, ...]]]] = {
    "aliquotas": (
        "regras_aliquotas", RegraAliquotaDestino,
        lambda r: (r.uf, r.ncm or ""),
    ),
    "cfop": (
        "regras_cfop", RegraCfopDestino,
        lambda r: (r.cfop_sufixo,),
    ),
    "reducao": (
        "regras_reducao_produto", RegraReducaoProduto,
        lambda r: (r.escopo or ANTECIPACAO_PARCIAL, r.ncm, _termos(r.termos_inclusao)),
    ),
    "reclassificacao": (
        "regras_reclassificacao_cfop", RegraReclassificacaoCfop,
        lambda r: (r.ncm, r.cfop_origem_sufixo, _termos(r.termos_inclusao), _termos(r.termos_exclusao)),
    ),
    "exclusao": (
        "regras_exclusao_parcial", RegraExclusaoParcial,
        lambda r: (r.uf, r.ncm, _termos(r.termos_obrigatorios)),
    ),
}


def copiar_registro(registro: _ModelT) -> _ModelT:
    """Clona um registro ORM descartando PK, FKs e timestamps."""
    return type(registro)(**{
        coluna.key: deepcopy(getattr(registro, coluna.key))
        for coluna in registro.__table__.columns
        if not coluna.primary_key and not coluna.foreign_keys
        and coluna.key not in {"criado_em", "atualizado_em"}
    })


def clonar_regras_perfil(origem: PerfilRegras, destino: PerfilRegras) -> None:
    """Clona todas as regras e exceções do perfil de origem para o perfil destino."""
    for relacao, _modelo, _chave in SECOES.values():
        for regra in getattr(origem, relacao):
            nova_regra = copiar_registro(regra)
            if hasattr(regra, "excecoes"):
                nova_regra.excecoes = [copiar_registro(e) for e in regra.excecoes]
            getattr(destino, relacao).append(nova_regra)


def copiar_regras(
    db: Session,
    origem: PerfilRegras,
    secao: str,
    destinos: List[PerfilRegras],
    regra_ids: Optional[List[int]] = None,
) -> List[dict]:
    """Copia regras da seção para cada destino. Não faz commit."""
    relacao, _modelo, chave = SECOES[secao]
    regras = list(getattr(origem, relacao))
    if regra_ids is not None:
        id_set = set(regra_ids)
        regras = [r for r in regras if r.id in id_set]

    resultados = []
    for destino in destinos:
        existentes = {chave(r) for r in getattr(destino, relacao)}
        copiadas = ignoradas = 0
        for regra in regras:
            k = chave(regra)
            if k in existentes:
                ignoradas += 1
                continue
            nova = copiar_registro(regra)
            if hasattr(regra, "excecoes"):
                nova.excecoes = [copiar_registro(e) for e in regra.excecoes]
            getattr(destino, relacao).append(nova)
            existentes.add(k)
            copiadas += 1
        resultados.append({
            "perfil_id": destino.id,
            "perfil_nome": destino.nome,
            "copiadas": copiadas,
            "ignoradas": ignoradas,
        })
    return resultados

