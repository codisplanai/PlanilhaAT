from dataclasses import dataclass
import re
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session, joinedload

from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop
from app.services.rules_engine.descricao_matcher import casa_algum, normalizar

EXTERIOR_PREFIXES = {"3", "7"}
NCM_SENTINELA = "00000000"


@dataclass(frozen=True)
class ResolucaoCfop:
    """Resultado da resolução de CFOP e roteamento de um item de nota fiscal."""

    cfop_efetivo: str
    sufixo_efetivo: Optional[str]
    destino: Optional[str]
    reclassificado: bool
    motivo: Optional[str] = None


class CfopResolver:
    """Motor de regras responsável por resolver o destino (planilha) e reclassificar o CFOP.

    Normaliza pelo sufixo de 3 dígitos do CFOP, pois o mesmo produto aparece como
    saída no XML do emitente (ex: 6102) e como entrada no SPED do destinatário (ex: 2102).

    Ordem de resolução:
      1. Reclassificação por Produto (NCM + Descrição + CFOP de origem opcional)
      2. Roteamento por CFOP (específica do Perfil > padrão global do sistema)
    """

    def __init__(self, db: Session):
        self.db = db
        self._cache: Dict[Tuple[Optional[int], str], Optional[str]] = {}
        self._reclassificacoes_cache: Dict[int, List[RegraReclassificacaoCfop]] = {}

    @staticmethod
    def _extract_sufixo(cfop: str) -> Optional[str]:
        cleaned = re.sub(r"\D", "", cfop or "")
        if len(cleaned) != 4:
            return None
        if cleaned[0] in EXTERIOR_PREFIXES:
            return None
        return cleaned[-3:]

    def preload_reclassificacoes(self, perfil_regras_id: int) -> None:
        """Carrega antecipadamente em memória todas as regras de reclassificação do perfil."""
        regras = (
            self.db.query(RegraReclassificacaoCfop)
            .options(joinedload(RegraReclassificacaoCfop.excecoes))
            .filter(RegraReclassificacaoCfop.perfil_regras_id == perfil_regras_id)
            .all()
        )
        self._reclassificacoes_cache[perfil_regras_id] = regras

    def _obter_regras_reclassificacao(self, perfil_regras_id: int) -> List[RegraReclassificacaoCfop]:
        if perfil_regras_id in self._reclassificacoes_cache:
            return self._reclassificacoes_cache[perfil_regras_id]
        self.preload_reclassificacoes(perfil_regras_id)
        return self._reclassificacoes_cache[perfil_regras_id]

    def resolve_destino(self, perfil_regras_id: int, cfop: str) -> Optional[str]:
        """Resolve o destino (planilha) a partir do CFOP original ou já reclassificado."""
        sufixo = self._extract_sufixo(cfop)
        if sufixo is None:
            return None
        return self._resolve_destino_por_sufixo(perfil_regras_id, sufixo)

    def _resolve_destino_por_sufixo(self, perfil_regras_id: int, sufixo: str) -> Optional[str]:
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
                RegraCfopDestino.cfop_sufixo == sufixo,
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
                RegraCfopDestino.cfop_sufixo == sufixo,
            )
            .first()
        )
        if regra_global is not None:
            return None if regra_global.destino == "ignorar" else regra_global.destino

        return None

    def reclassificar_cfop(
        self,
        perfil_regras_id: int,
        ncm: Optional[str],
        descricao: Optional[str],
        cfop_original: str,
    ) -> ResolucaoCfop:
        """Avalia reclassificação de CFOP por NCM/Descrição e resolve a planilha de destino.

        Precedência determinística:
          1º: Exceção exata de descrição vinculada à regra
          2º: Regra de NCM + Termos de Descrição (inclusão/exclusão)
          3º: Regra genérica de NCM puro (sem restrição de termos)
          4º: Sem regra -> mantém o CFOP original
        """
        sufixo_origem = self._extract_sufixo(cfop_original)
        if sufixo_origem is None:
            return ResolucaoCfop(
                cfop_efetivo=cfop_original,
                sufixo_efetivo=None,
                destino=None,
                reclassificado=False,
            )

        prefixo_operacao = cfop_original[0] if len(cfop_original) >= 1 else "6"
        ncm_limpo = re.sub(r"\D", "", ncm or "")

        if len(ncm_limpo) != 8 or ncm_limpo == NCM_SENTINELA:
            destino = self._resolve_destino_por_sufixo(perfil_regras_id, sufixo_origem)
            return ResolucaoCfop(
                cfop_efetivo=cfop_original,
                sufixo_efetivo=sufixo_origem,
                destino=destino,
                reclassificado=False,
            )

        todas_regras = self._obter_regras_reclassificacao(perfil_regras_id)

        # Regras candidatas para este NCM e com CFOP de origem compatível
        candidatas = [
            r for r in todas_regras
            if r.ncm == ncm_limpo
            and (r.cfop_origem_sufixo is None or r.cfop_origem_sufixo == sufixo_origem)
        ]

        if not candidatas:
            destino = self._resolve_destino_por_sufixo(perfil_regras_id, sufixo_origem)
            return ResolucaoCfop(
                cfop_efetivo=cfop_original,
                sufixo_efetivo=sufixo_origem,
                destino=destino,
                reclassificado=False,
            )

        desc_norm = normalizar(descricao) if descricao else ""

        # Separa regras com termos e regras genéricas
        regras_com_termos = [r for r in candidatas if r.termos_inclusao]
        regras_genericas = [r for r in candidatas if not r.termos_inclusao]

        # 1º Nível: Exceções exatas
        if desc_norm:
            for regra in candidatas:
                for exc in regra.excecoes:
                    if exc.descricao_exata == desc_norm:
                        if not exc.aplicar:
                            # Exceção negativa: proíbe a reclassificação desta regra
                            pass
                        else:
                            # Exceção positiva: aplica a reclassificação desta regra
                            return self._aplicar_reclassificacao(
                                perfil_regras_id, prefixo_operacao, regra,
                                motivo=f"Exceção exata na regra NCM {regra.ncm}",
                            )

        # 2º Nível: Regras com termos de descrição
        if desc_norm and regras_com_termos:
            for regra in regras_com_termos:
                # Se houver exceção com aplicar=False para essa descrição nesta regra, pula
                tem_bloqueio = any(
                    exc.descricao_exata == desc_norm and not exc.aplicar for exc in regra.excecoes
                )
                if tem_bloqueio:
                    continue

                if regra.termos_exclusao and casa_algum(desc_norm, regra.termos_exclusao):
                    continue

                if casa_algum(desc_norm, regra.termos_inclusao):
                    motivo = regra.descricao or f"Regra NCM {regra.ncm} + Termos"
                    return self._aplicar_reclassificacao(
                        perfil_regras_id, prefixo_operacao, regra, motivo=motivo
                    )

        # 3º Nível: Regras genéricas por NCM puro (sem termos de inclusão)
        if regras_genericas:
            for regra in regras_genericas:
                if desc_norm:
                    tem_bloqueio = any(
                        exc.descricao_exata == desc_norm and not exc.aplicar for exc in regra.excecoes
                    )
                    if tem_bloqueio:
                        continue
                    if regra.termos_exclusao and casa_algum(desc_norm, regra.termos_exclusao):
                        continue

                motivo = regra.descricao or f"Regra genérica NCM {regra.ncm}"
                return self._aplicar_reclassificacao(
                    perfil_regras_id, prefixo_operacao, regra, motivo=motivo
                )

        # 4º Nível: Sem reclassificação
        destino = self._resolve_destino_por_sufixo(perfil_regras_id, sufixo_origem)
        return ResolucaoCfop(
            cfop_efetivo=cfop_original,
            sufixo_efetivo=sufixo_origem,
            destino=destino,
            reclassificado=False,
        )

    def _aplicar_reclassificacao(
        self,
        perfil_regras_id: int,
        prefixo_operacao: str,
        regra: RegraReclassificacaoCfop,
        motivo: str,
    ) -> ResolucaoCfop:
        novo_sufixo = regra.cfop_destino_sufixo
        cfop_efetivo = f"{prefixo_operacao}{novo_sufixo}"
        destino = self._resolve_destino_por_sufixo(perfil_regras_id, novo_sufixo)
        return ResolucaoCfop(
            cfop_efetivo=cfop_efetivo,
            sufixo_efetivo=novo_sufixo,
            destino=destino,
            reclassificado=True,
            motivo=motivo,
        )
