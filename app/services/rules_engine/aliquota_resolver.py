from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.exceptions import RuleResolutionException
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.services.rules_engine.descricao_matcher import casa_algum, normalizar


@dataclass(frozen=True)
class ResolucaoAliquota:
    """A alíquota de destino e a procedência dela.

    Com três níveis de precedência, saber qual alíquota saiu sem saber de onde
    inviabiliza a conferência fiscal. A origem é gravada em ``metadados_extras``
    da nota processada.
    """

    aliquota: Decimal
    origem: str
    detalhe: str


class AliquotaResolver:
    """Resolve a Alíquota de Destino (A.DST) em três níveis de precedência:

      1. Redução por produto — (perfil, NCM) + descrição do item
      2. Termo de acordo     — (empresa)
      3. Padrão do perfil    — (perfil, UF, NCM) e depois (perfil, UF)

    A.ORI nunca passa por este motor (vem direto do XML/SPED).

    Sem ``descricao`` e ``empresa_id`` os dois primeiros níveis são pulados e o
    comportamento é idêntico ao anterior à introdução das alíquotas reduzidas.
    """

    def __init__(self, db: Session):
        self.db = db
        self._perfil_preload: Optional[int] = None
        self._reducoes_por_ncm: Optional[Dict[str, List[RegraReducaoProduto]]] = None
        self._termos_acordo: Dict[int, Optional[RegraAliquotaEmpresa]] = {}

    # -- cache ---------------------------------------------------------------

    def preload(self, perfil_regras_id: int, empresa_id: Optional[int] = None) -> None:
        """Carrega em memória as regras usadas no processamento de uma solicitação.

        O resolver é chamado item a item dentro do loop de notas; sem isto, três
        níveis multiplicariam o número de consultas por item.
        """
        regras = (
            self.db.query(RegraReducaoProduto)
            .filter(RegraReducaoProduto.perfil_regras_id == perfil_regras_id)
            .all()
        )
        indexadas: Dict[str, List[RegraReducaoProduto]] = {}
        for regra in regras:
            indexadas.setdefault(regra.ncm, []).append(regra)
        self._reducoes_por_ncm = indexadas
        self._perfil_preload = perfil_regras_id

        if empresa_id is not None:
            self._termos_acordo[empresa_id] = (
                self.db.query(RegraAliquotaEmpresa)
                .filter(RegraAliquotaEmpresa.empresa_id == empresa_id)
                .first()
            )

    def _regras_reducao(self, perfil_regras_id: int, ncm: str) -> List[RegraReducaoProduto]:
        if self._reducoes_por_ncm is not None and perfil_regras_id == self._perfil_preload:
            return self._reducoes_por_ncm.get(ncm, [])
        return (
            self.db.query(RegraReducaoProduto)
            .filter(
                RegraReducaoProduto.perfil_regras_id == perfil_regras_id,
                RegraReducaoProduto.ncm == ncm,
            )
            .all()
        )

    def _termo_acordo(self, empresa_id: int) -> Optional[RegraAliquotaEmpresa]:
        if empresa_id not in self._termos_acordo:
            self._termos_acordo[empresa_id] = (
                self.db.query(RegraAliquotaEmpresa)
                .filter(RegraAliquotaEmpresa.empresa_id == empresa_id)
                .first()
            )
        return self._termos_acordo[empresa_id]

    # -- API pública ---------------------------------------------------------

    def resolve_a_dst(
        self,
        perfil_regras_id: int,
        uf: str,
        ncm: Optional[str] = None,
        descricao: Optional[str] = None,
        empresa_id: Optional[int] = None,
    ) -> ResolucaoAliquota:
        clean_uf = uf.strip().upper() if uf else ""
        clean_ncm = ncm.strip() if ncm else None

        reducao = self._nivel_reducao_produto(perfil_regras_id, clean_ncm, descricao)
        if reducao is not None:
            return reducao

        acordo = self._nivel_termo_acordo(empresa_id)
        if acordo is not None:
            return acordo

        return self._nivel_padrao(perfil_regras_id, clean_uf, clean_ncm)

    # -- níveis --------------------------------------------------------------

    def _nivel_reducao_produto(
        self, perfil_regras_id: int, ncm: Optional[str], descricao: Optional[str]
    ) -> Optional[ResolucaoAliquota]:
        if not ncm or not descricao:
            return None
        regras = self._regras_reducao(perfil_regras_id, ncm)
        if not regras:
            return None
        desc = normalizar(descricao)
        if not desc:
            return None

        casadas = [
            (regra, exc)
            for regra in regras
            for exc in regra.excecoes
            if exc.descricao_exata == desc
        ]
        if len(casadas) > 1:
            raise RuleResolutionException(
                self._msg_conflito(desc, ncm, [regra for regra, _ in casadas], "exceções")
            )
        if casadas:
            regra, excecao = casadas[0]
            if not excecao.enquadrado:
                return None
            return ResolucaoAliquota(
                aliquota=Decimal(str(regra.aliquota)),
                origem=f"excecao:{excecao.id}",
                detalhe=f"Exceção cadastrada na regra {self._rotulo(regra)}",
            )

        candidatas = [
            regra
            for regra in regras
            if casa_algum(desc, regra.termos_inclusao)
            and not casa_algum(desc, regra.termos_exclusao)
        ]
        if not candidatas:
            return None
        if len(candidatas) > 1:
            raise RuleResolutionException(self._msg_conflito(desc, ncm, candidatas, "regras"))

        regra = candidatas[0]
        return ResolucaoAliquota(
            aliquota=Decimal(str(regra.aliquota)),
            origem=f"reducao_produto:{regra.id}",
            detalhe=f"Redução por produto: {regra.descricao or f'regra #{regra.id}'}",
        )

    def _nivel_termo_acordo(self, empresa_id: Optional[int]) -> Optional[ResolucaoAliquota]:
        if empresa_id is None:
            return None
        regra = self._termo_acordo(empresa_id)
        if regra is None:
            return None
        return ResolucaoAliquota(
            aliquota=Decimal(str(regra.aliquota)),
            origem=f"termo_acordo:{regra.id}",
            detalhe=f"Termo de acordo da empresa: {regra.descricao or f'regra #{regra.id}'}",
        )

    def _nivel_padrao(
        self, perfil_regras_id: int, clean_uf: str, clean_ncm: Optional[str]
    ) -> ResolucaoAliquota:
        if clean_ncm:
            regra_ncm = (
                self.db.query(RegraAliquotaDestino)
                .filter(
                    RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                    RegraAliquotaDestino.uf == clean_uf,
                    RegraAliquotaDestino.ncm == clean_ncm,
                )
                .first()
            )
            if regra_ncm is not None:
                return ResolucaoAliquota(
                    aliquota=Decimal(str(regra_ncm.aliquota)),
                    origem=f"regra_ncm:{regra_ncm.id}",
                    detalhe=f"Exceção por NCM {clean_ncm} na UF {clean_uf}",
                )

        regra_padrao = (
            self.db.query(RegraAliquotaDestino)
            .filter(
                RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                RegraAliquotaDestino.uf == clean_uf,
                or_(RegraAliquotaDestino.ncm == None, RegraAliquotaDestino.ncm == ""),  # noqa: E711
            )
            .first()
        )
        if regra_padrao is not None:
            return ResolucaoAliquota(
                aliquota=Decimal(str(regra_padrao.aliquota)),
                origem=f"padrao_uf:{regra_padrao.id}",
                detalhe=f"Alíquota padrão da UF {clean_uf}",
            )

        ncm_info = f" e NCM '{clean_ncm}'" if clean_ncm else ""
        raise RuleResolutionException(
            f"Nenhuma regra de alíquota de destino (A.DST) encontrada para UF '{clean_uf}'{ncm_info} no perfil de regras ID {perfil_regras_id}. "
            f"Cadastre a alíquota padrão ou a exceção para este estado."
        )

    # -- mensagens -----------------------------------------------------------

    @staticmethod
    def _rotulo(regra: RegraReducaoProduto) -> str:
        return f'#{regra.id} "{regra.descricao or "sem rótulo"}"'

    @classmethod
    def _msg_conflito(
        cls, desc: str, ncm: str, regras: List[RegraReducaoProduto], especie: str
    ) -> str:
        """Aponta o item, as regras que colidiram e o que fazer a respeito.

        Falhar em vez de escolher é deliberado: aplicar a alíquota errada em
        silêncio gera passivo que só aparece em fiscalização.
        """
        linhas = "\n".join(
            f"  {cls._rotulo(r)} ({Decimal(str(r.aliquota)) * 100:.2f}%) "
            f"— termos de inclusão: {', '.join(r.termos_inclusao)}"
            for r in regras
        )
        return (
            f'Conflito de regras de redução no item "{desc}" (NCM {ncm}).\n\n'
            f"Estas {especie} casaram o mesmo item:\n{linhas}\n\n"
            "Cadastre uma exceção com a descrição exata deste item na regra que "
            "deve prevalecer, para que o sistema saiba qual aplicar."
        )
