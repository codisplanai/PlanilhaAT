import re
from typing import Optional, Dict, Tuple
from sqlalchemy.orm import Session

from app.models.regra_cfop import RegraCfopDestino

EXTERIOR_PREFIXES = {"3", "7"}

class CfopResolver:
    """
    Motor de regras responsável por resolver determinísticamente o destino (planilha)
    de um item de NF-e a partir do CFOP.

    Normaliza pelo sufixo de 3 dígitos do CFOP, pois o mesmo produto aparece como
    saída no XML do emitente (ex: 6102) e como entrada no SPED do destinatário (ex: 2102).

    Ordem de precedência:
      1. Regra específica do Perfil de Regras
      2. Regra padrão global do sistema (perfil_regras_id = None)

    Se nenhuma regra for encontrada, ou se a regra encontrada for "ignorar",
    retorna None (o item é descartado da apuração, sem exceção).
    """

    def __init__(self, db: Session):
        self.db = db
        self._cache: Dict[Tuple[Optional[int], str], Optional[str]] = {}

    @staticmethod
    def _extract_sufixo(cfop: str) -> Optional[str]:
        cleaned = re.sub(r"\D", "", cfop or "")
        if len(cleaned) != 4:
            return None
        # CFOPs de operações com o exterior (série 3xxx e 7xxx) não se aplicam aqui
        if cleaned[0] in EXTERIOR_PREFIXES:
            return None
        return cleaned[-3:]

    def resolve_destino(self, perfil_regras_id: int, cfop: str) -> Optional[str]:
        sufixo = self._extract_sufixo(cfop)
        if sufixo is None:
            return None

        cache_key = (perfil_regras_id, sufixo)
        if cache_key in self._cache:
            return self._cache[cache_key]

        destino = self._resolve_uncached(perfil_regras_id, sufixo)
        self._cache[cache_key] = destino
        return destino

    def _resolve_uncached(self, perfil_regras_id: int, sufixo: str) -> Optional[str]:
        # 1. Regra específica do perfil
        regra_perfil = (
            self.db.query(RegraCfopDestino)
            .filter(
                RegraCfopDestino.perfil_regras_id == perfil_regras_id,
                RegraCfopDestino.cfop_sufixo == sufixo
            )
            .first()
        )
        if regra_perfil is not None:
            return None if regra_perfil.destino == "ignorar" else regra_perfil.destino

        # 2. Regra padrão global (perfil_regras_id IS NULL)
        regra_global = (
            self.db.query(RegraCfopDestino)
            .filter(
                RegraCfopDestino.perfil_regras_id == None,
                RegraCfopDestino.cfop_sufixo == sufixo
            )
            .first()
        )
        if regra_global is not None:
            return None if regra_global.destino == "ignorar" else regra_global.destino

        return None
