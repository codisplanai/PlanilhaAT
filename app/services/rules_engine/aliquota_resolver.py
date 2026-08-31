from decimal import Decimal
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.regra_aliquota import RegraAliquotaDestino
from app.core.exceptions import RuleResolutionException

class AliquotaResolver:
    """
    Motor de regras responsável por resolver determinísticamente a Alíquota de Destino (A.DST).
    Ordem de precedência:
      1. Regra específica por (Perfil, UF, NCM)
      2. Regra padrão do estado (Perfil, UF, NCM = None)
    
    A.ORI nunca passa por este motor (é extraída diretamente do XML).
    """

    def __init__(self, db: Session):
        self.db = db

    def resolve_a_dst(self, perfil_regras_id: int, uf: str, ncm: Optional[str] = None) -> Decimal:
        clean_uf = uf.strip().upper() if uf else ""
        clean_ncm = ncm.strip() if ncm else None

        # 1. Tenta buscar regra específica por UF e NCM
        if clean_ncm:
            regra_ncm = (
                self.db.query(RegraAliquotaDestino)
                .filter(
                    RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                    RegraAliquotaDestino.uf == clean_uf,
                    RegraAliquotaDestino.ncm == clean_ncm
                )
                .first()
            )
            if regra_ncm is not None:
                return Decimal(str(regra_ncm.aliquota))

        # 2. Tenta buscar regra padrão estadual (NCM is None ou vazio)
        regra_padrao = (
            self.db.query(RegraAliquotaDestino)
            .filter(
                RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                RegraAliquotaDestino.uf == clean_uf,
                or_(RegraAliquotaDestino.ncm == None, RegraAliquotaDestino.ncm == "")
            )
            .first()
        )
        if regra_padrao is not None:
            return Decimal(str(regra_padrao.aliquota))

        # Se não encontrar nenhuma regra configurada
        ncm_info = f" e NCM '{clean_ncm}'" if clean_ncm else ""
        raise RuleResolutionException(
            f"Nenhuma regra de alíquota de destino (A.DST) encontrada para UF '{clean_uf}'{ncm_info} no perfil de regras ID {perfil_regras_id}. "
            f"Cadastre a alíquota padrão ou a exceção para este estado."
        )
