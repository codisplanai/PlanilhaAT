"""Cópia de regras em tabela de um perfil para outros perfis.

Regras já existentes no destino (mesma chave de duplicidade) são ignoradas,
nunca sobrescritas. Exceções acompanham a regra de redução e de reclassificação.
"""
from copy import deepcopy
from typing import Callable, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop
from app.models.regra_reducao_produto import RegraReducaoProduto


def _termos(valor) -> Tuple[str, ...]:
    return tuple(sorted(valor or []))


# secao -> (relacao em PerfilRegras, modelo, chave de duplicidade)
SECOES: Dict[str, Tuple[str, type, Callable]] = {
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
        lambda r: (r.escopo or "antecipacao_parcial", r.ncm, _termos(r.termos_inclusao)),
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


def _copiar_registro(registro):
    # Identidades, vínculos e datas são novos.
    return type(registro)(**{
        coluna.key: deepcopy(getattr(registro, coluna.key))
        for coluna in registro.__table__.columns
        if not coluna.primary_key and not coluna.foreign_keys
        and coluna.key not in {"criado_em", "atualizado_em"}
    })


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
        regras = [r for r in regras if r.id in set(regra_ids)]

    resultados = []
    for destino in destinos:
        existentes = {chave(r) for r in getattr(destino, relacao)}
        copiadas = ignoradas = 0
        for regra in regras:
            k = chave(regra)
            if k in existentes:
                ignoradas += 1
                continue
            nova = _copiar_registro(regra)
            if hasattr(regra, "excecoes"):
                nova.excecoes = [_copiar_registro(e) for e in regra.excecoes]
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

