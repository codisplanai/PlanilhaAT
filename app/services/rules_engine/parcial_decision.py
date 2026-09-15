"""Serviço de decisão e exclusão de itens na Antecipação Parcial.

Avalia itens candidatos aos destinos de Antecipação Parcial em dois níveis:
1. Exclusão por mercadoria (NCM exato + todos os termos da descrição) com motivo
   cadastrado (isenção ou imposto pago na entrada).
2. Condição numérica de alíquotas iguais: quando A.ORI == A.DST, calcula o item
   individualmente com o calculador da modalidade. Se o valor devido final for <= 0,00,
   exclui o item; se for positivo (> 0,00 por IPI/frete/despesas), mantém o item.
"""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set, Tuple
from sqlalchemy.orm import Session

from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
    ANTECIPACAO_PARCIAL_SIMPLES,
)
from app.models.perfil_regras import PerfilRegras
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.services.calculation.antecipacao_parcial import AntecipacaoParcialCalculator
from app.services.rules_engine.descricao_matcher import casa_todos, normalizar

DESTINOS_PARCIAL = {
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_SIMPLES,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
}

MOTIVO_LABELS: Dict[str, str] = {
    "isencao": "Isenção",
    "imposto_pago_entrada": "Imposto pago na entrada",
}


@dataclass
class DecisaoExclusaoItem:
    excluido: bool
    tipo_exclusao: Optional[str] = None  # 'mercadoria' ou 'aliquotas_iguais'
    motivo: Optional[str] = None
    regras_aplicadas: List[Dict[str, Any]] = field(default_factory=list)
    v_total: Optional[Decimal] = None
    base_calculo: Optional[Decimal] = None
    ipi_despesas: Optional[Decimal] = None
    a_ori: Optional[Decimal] = None
    a_dst: Optional[Decimal] = None
    debito: Optional[Decimal] = None
    credito: Optional[Decimal] = None
    valor_devido: Optional[Decimal] = None


class ParcialExclusionService:
    def __init__(self, db: Session):
        self.db = db
        self.calculator = AntecipacaoParcialCalculator()
        self._regras_cache: Dict[Tuple[int, str, str], List[RegraExclusaoParcial]] = {}
        self._politicas_iguais_cache: Dict[Tuple[int, str], bool] = {}
        self._preloaded_perfis: Set[int] = set()

    def preload(self, perfil_regras_id: Optional[int], uf: Optional[str] = None) -> None:
        """Pré-carrega as regras de exclusão ativas do perfil para evitar consultas repetidas por item."""
        if not perfil_regras_id or perfil_regras_id in self._preloaded_perfis:
            return

        regras = (
            self.db.query(RegraExclusaoParcial)
            .filter(
                RegraExclusaoParcial.perfil_regras_id == perfil_regras_id,
                RegraExclusaoParcial.ativo.is_(True),
            )
            .all()
        )
        for r in regras:
            key = (r.perfil_regras_id, (r.uf or "").upper(), r.ncm)
            if key not in self._regras_cache:
                self._regras_cache[key] = []
            self._regras_cache[key].append(r)

        perfil = self.db.query(PerfilRegras).filter(PerfilRegras.id == perfil_regras_id).first()
        if perfil:
            extras = perfil.configuracoes_extras or {}
            politica_dict = extras.get("politica_aliquotas_iguais_parcial")
            if isinstance(politica_dict, dict):
                for uf_key, atv in politica_dict.items():
                    clean_k = (uf_key or "").strip().upper()
                    if isinstance(atv, bool):
                        self._politicas_iguais_cache[(perfil.id, clean_k)] = atv
                    else:
                        self._politicas_iguais_cache[(perfil.id, clean_k)] = False

        self._preloaded_perfis.add(perfil_regras_id)

    def is_politica_aliquotas_iguais_ativa(self, perfil_regras_id: Optional[int], uf: str) -> bool:
        """Verifica se a política de alíquotas iguais está habilitada para o perfil e UF."""
        if not perfil_regras_id:
            return False
        uf_upper = (uf or "").strip().upper()
        if (perfil_regras_id, uf_upper) in self._politicas_iguais_cache:
            return self._politicas_iguais_cache[(perfil_regras_id, uf_upper)]

        # Consulta sob demanda caso preload não tenha sido chamado
        perfil = self.db.query(PerfilRegras).filter(PerfilRegras.id == perfil_regras_id).first()
        if not perfil:
            return False
        extras = perfil.configuracoes_extras or {}
        politica_dict = extras.get("politica_aliquotas_iguais_parcial")
        if isinstance(politica_dict, dict):
            for k, val in politica_dict.items():
                if (k or "").strip().upper() == uf_upper:
                    if isinstance(val, bool):
                        return val
            return False

        return False


    @staticmethod
    def preparar_valores_item(
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
    ) -> Tuple[Decimal, Decimal, Decimal]:
        """Aplica a mesma lógica consistente de saneamento de base e IPI do pipeline."""
        v_tot = v_total
        v_bc = base_calculo
        v_ipi = ipi_despesas
        if v_bc <= Decimal("0.00"):
            v_bc = v_tot - v_ipi
        elif v_bc > Decimal("0.00") and v_tot > v_bc and v_ipi == Decimal("0.00"):
            v_ipi = v_tot - v_bc
        return v_tot, v_bc, v_ipi

    def avaliar_mercadoria(
        self,
        *,
        perfil_regras_id: int,
        uf_empresa: str,
        destino: str,
        ncm: str,
        descricao: str,
        descricao_confiavel: bool,
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
        a_ori: Decimal,
    ) -> DecisaoExclusaoItem:
        """Avalia exclusivamente a regra de exclusão por mercadoria (NCM + termos) sem exigir A.DST."""
        if destino not in DESTINOS_PARCIAL:
            return DecisaoExclusaoItem(excluido=False)

        uf_norm = (uf_empresa or "").strip().upper()
        ncm_clean = (ncm or "").strip()

        if descricao_confiavel and ncm_clean and ncm_clean != "00000000" and descricao and normalizar(descricao).strip():
            key = (perfil_regras_id, uf_norm, ncm_clean)
            regras = self._regras_cache.get(key)
            if regras is None and perfil_regras_id not in self._preloaded_perfis:
                regras = (
                    self.db.query(RegraExclusaoParcial)
                    .filter(
                        RegraExclusaoParcial.perfil_regras_id == perfil_regras_id,
                        RegraExclusaoParcial.uf == uf_norm,
                        RegraExclusaoParcial.ncm == ncm_clean,
                        RegraExclusaoParcial.ativo.is_(True),
                    )
                    .all()
                )

            if regras:
                desc_normalizada = normalizar(descricao)
                regras_casadas = [
                    r for r in regras
                    if casa_todos(desc_normalizada, r.termos_obrigatorios)
                ]
                if regras_casadas:
                    primeira_regra = regras_casadas[0]
                    motivo_formatado = MOTIVO_LABELS.get(
                        primeira_regra.motivo, primeira_regra.motivo
                    )
                    criterios = [
                        {
                            "id": r.id,
                            "ncm": r.ncm,
                            "descricao_regra": r.descricao,
                            "termos_obrigatorios": r.termos_obrigatorios,
                            "motivo": r.motivo,
                        }
                        for r in regras_casadas
                    ]
                    v_tot, v_bc, v_ipi = self.preparar_valores_item(
                        v_total, base_calculo, ipi_despesas
                    )
                    return DecisaoExclusaoItem(
                        excluido=True,
                        tipo_exclusao="mercadoria",
                        motivo=motivo_formatado,
                        regras_aplicadas=criterios,
                        v_total=v_tot,
                        base_calculo=v_bc,
                        ipi_despesas=v_ipi,
                        a_ori=a_ori,
                        a_dst=None,
                        debito=None,
                        credito=None,
                        valor_devido=None,
                    )

        return DecisaoExclusaoItem(excluido=False)

    def avaliar_aliquotas_iguais(
        self,
        *,
        perfil_regras_id: int,
        uf_empresa: str,
        destino: str,
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
        a_ori: Decimal,
        a_dst: Decimal,
        is_simples: bool,
    ) -> DecisaoExclusaoItem:
        """Avalia exclusivamente a condição numérica de alíquotas iguais (A.ORI == A.DST)."""
        if destino not in DESTINOS_PARCIAL:
            return DecisaoExclusaoItem(excluido=False)

        uf_norm = (uf_empresa or "").strip().upper()
        politica_ativa = self.is_politica_aliquotas_iguais_ativa(perfil_regras_id, uf_norm)
        if politica_ativa and a_ori == a_dst and v_total > Decimal("0.00"):
            v_tot, v_bc, v_ipi = self.preparar_valores_item(
                v_total, base_calculo, ipi_despesas
            )
            calc_result = self.calculator.calculate(
                v_total=v_tot,
                base_calculo=v_bc,
                ipi_despesas=v_ipi,
                a_ori=a_ori,
                a_dst=a_dst,
                parametros_extras={"is_simples": is_simples},
            )
            if calc_result.valor_devido <= Decimal("0.00"):
                return DecisaoExclusaoItem(
                    excluido=True,
                    tipo_exclusao="aliquotas_iguais",
                    motivo="Alíquotas iguais com valor devido zero ou negativo",
                    regras_aplicadas=[],
                    v_total=v_tot,
                    base_calculo=v_bc,
                    ipi_despesas=v_ipi,
                    a_ori=a_ori,
                    a_dst=a_dst,
                    debito=calc_result.debito,
                    credito=calc_result.credito,
                    valor_devido=calc_result.valor_devido,
                )

        return DecisaoExclusaoItem(excluido=False)

    def avaliar_item(
        self,
        *,
        perfil_regras_id: int,
        uf_empresa: str,
        destino: str,
        ncm: str,
        descricao: str,
        descricao_confiavel: bool,
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
        a_ori: Decimal,
        a_dst: Decimal,
        is_simples: bool,
    ) -> DecisaoExclusaoItem:
        """Avalia se um item de Parcial deve ser excluído e retorna os metadados de conferência."""
        decisao_merc = self.avaliar_mercadoria(
            perfil_regras_id=perfil_regras_id,
            uf_empresa=uf_empresa,
            destino=destino,
            ncm=ncm,
            descricao=descricao,
            descricao_confiavel=descricao_confiavel,
            v_total=v_total,
            base_calculo=base_calculo,
            ipi_despesas=ipi_despesas,
            a_ori=a_ori,
        )
        if decisao_merc.excluido:
            return decisao_merc

        return self.avaliar_aliquotas_iguais(
            perfil_regras_id=perfil_regras_id,
            uf_empresa=uf_empresa,
            destino=destino,
            v_total=v_total,
            base_calculo=base_calculo,
            ipi_despesas=ipi_despesas,
            a_ori=a_ori,
            a_dst=a_dst,
            is_simples=is_simples,
        )
