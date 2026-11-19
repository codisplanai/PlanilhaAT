from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.constants import ANTECIPACAO_PARCIAL, ANTECIPACAO_TRIBUTARIA
from app.core.exceptions import RuleResolutionException
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_fcp_produto import RegraFcpProduto
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.services.rules_engine.descricao_matcher import casa_algum, casa_termo, normalizar


@dataclass(frozen=True)
class ResolucaoAliquota:
    """A alíquota de destino e a procedência dela.

    Com três níveis de precedência, saber qual alíquota saiu sem saber de onde
    inviabiliza a conferência fiscal. A origem é gravada em ``metadados_extras``
    da nota processada.

    ``aviso`` é um alerta de cadastro para o resultado, sem o prefixo do item:
    hoje, regras redundantes (mais de uma casou o item, todas com o mesmo valor).
    """

    aliquota: Decimal
    origem: str
    detalhe: str
    aviso: Optional[str] = None


@dataclass(frozen=True)
class _CasamentoRegra:
    """Regra de produto/FCP que casou um item, e por quê."""

    regra: Any
    termos: Tuple[str, ...] = ()
    excecao_id: Optional[int] = None


@dataclass(frozen=True)
class _ContextoResolucaoRegra:
    """Rótulos e prefixos de origem para compartilhar a resolução por produto/FCP."""

    prefixo_origem_regra: str
    prefixo_origem_excecao: str
    rotulo_regra_detalhe: str
    rotulo_excecao_detalhe: str
    rotulo_escopo: str
    nome_valor: str
    substantivo_conflito: str
    rotulo_aviso_regras: str
    rotulo_aviso_excecoes: str


_ROTULOS_ESCOPO = {
    ANTECIPACAO_PARCIAL: "Antecipação Parcial",
    ANTECIPACAO_TRIBUTARIA: "Antecipação Tributária",
}

_CTX_FCP = _ContextoResolucaoRegra(
    prefixo_origem_regra="fcp_produto",
    prefixo_origem_excecao="excecao_fcp",
    rotulo_regra_detalhe="FCP por produto",
    rotulo_excecao_detalhe="Exceção de FCP cadastrada na regra",
    rotulo_escopo="FCP",
    nome_valor="alíquota",
    substantivo_conflito="de FCP",
    rotulo_aviso_regras="as regras de FCP",
    rotulo_aviso_excecoes="as exceções de FCP",
)


def _contexto_reducao(escopo: str) -> _ContextoResolucaoRegra:
    return _ContextoResolucaoRegra(
        prefixo_origem_regra="reducao_produto",
        prefixo_origem_excecao="excecao",
        rotulo_regra_detalhe="Redução por produto",
        rotulo_excecao_detalhe="Exceção cadastrada na regra",
        rotulo_escopo=_ROTULOS_ESCOPO.get(escopo, escopo),
        nome_valor="redução" if escopo == ANTECIPACAO_TRIBUTARIA else "alíquota",
        substantivo_conflito="de redução",
        rotulo_aviso_regras="as reduções por produto",
        rotulo_aviso_excecoes="as exceções das reduções",
    )


_PRECISAO_CADASTRO = Decimal("0.00001")  # Numeric(8, 5) em regras_reducao_produto


def _normalizar_ncm(ncm: Optional[str]) -> str:
    clean_ncm = re.sub(r"\D", "", ncm or "")
    if len(clean_ncm) < 4 or set(clean_ncm) == {"0"}:
        return ""
    return clean_ncm


def _mesmo_valor(a, b) -> bool:
    return (
        Decimal(str(a)).quantize(_PRECISAO_CADASTRO, rounding=ROUND_HALF_UP)
        == Decimal(str(b)).quantize(_PRECISAO_CADASTRO, rounding=ROUND_HALF_UP)
    )


def _formatar_valor(valor) -> str:
    pct = (Decimal(str(valor)) * 100).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    casas = 2 if pct == pct.quantize(Decimal("0.01")) else 3
    return f"{pct:.{casas}f}".replace(".", ",") + "%"


def _lista_entre_aspas(valores) -> str:
    return ", ".join(f'"{valor}"' for valor in valores)


def _juntar_com_e(valores: List[str]) -> str:
    if len(valores) <= 1:
        return "".join(valores)
    return f"{', '.join(valores[:-1])} e {valores[-1]}"


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
        self._reducoes_perfil: Optional[List[RegraReducaoProduto]] = None
        self._fcp_perfil: Optional[List[RegraFcpProduto]] = None
        self._termos_acordo: Dict[int, Optional[RegraAliquotaEmpresa]] = {}

    @staticmethod
    def calcular_reducao_base_tributaria(
        aliquota_efetiva: Decimal, aliquota_padrao: Decimal
    ) -> Optional[Decimal]:
        """Calcula o percentual de redução da Base ST (ex: 0.41463 para 41,463%)
        quando a mercadoria possui carga efetiva reduzida (ex: 12% frente a 20,5%).
        """
        if aliquota_padrao <= Decimal("0") or aliquota_efetiva <= Decimal("0"):
            return None
        if aliquota_efetiva >= aliquota_padrao:
            return None
        return (Decimal("1") - (aliquota_efetiva / aliquota_padrao)).quantize(
            Decimal("0.00001"), rounding=ROUND_HALF_UP
        )

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
        self._reducoes_perfil = list(regras)
        fcp_regras = (
            self.db.query(RegraFcpProduto)
            .options(selectinload(RegraFcpProduto.excecoes))
            .filter(RegraFcpProduto.perfil_regras_id == perfil_regras_id)
            .all()
        )
        self._fcp_perfil = list(fcp_regras)
        self._perfil_preload = perfil_regras_id

        if empresa_id is not None:
            self._termos_acordo[empresa_id] = (
                self.db.query(RegraAliquotaEmpresa)
                .filter(RegraAliquotaEmpresa.empresa_id == empresa_id)
                .first()
            )

    def _regras_reducao(
        self,
        perfil_regras_id: int,
        ncm: str,
        escopo: str = ANTECIPACAO_PARCIAL,
    ) -> List[RegraReducaoProduto]:
        clean_ncm = _normalizar_ncm(ncm)
        if not clean_ncm:
            return []
        if self._reducoes_perfil is not None and perfil_regras_id == self._perfil_preload:
            todas = self._reducoes_perfil
        else:
            todas = (
                self.db.query(RegraReducaoProduto)
                .filter(RegraReducaoProduto.perfil_regras_id == perfil_regras_id)
                .all()
            )
        return [
            r
            for r in todas
            if (getattr(r, "escopo", None) or ANTECIPACAO_PARCIAL) == escopo
            and r.ncm
            and clean_ncm.startswith(r.ncm)
        ]

    def _regras_fcp(
        self,
        perfil_regras_id: int,
        clean_uf: str,
        clean_ncm: str,
        empresa_tem_termo_acordo: bool = False,
    ) -> List[RegraFcpProduto]:
        if self._fcp_perfil is not None and perfil_regras_id == self._perfil_preload:
            todas = self._fcp_perfil
        else:
            todas = (
                self.db.query(RegraFcpProduto)
                .options(selectinload(RegraFcpProduto.excecoes))
                .filter(RegraFcpProduto.perfil_regras_id == perfil_regras_id)
                .all()
            )
        return [
            r
            for r in todas
            if r.uf == clean_uf
            and r.ncm
            and clean_ncm.startswith(r.ncm)
            and not (empresa_tem_termo_acordo and r.aplicar_com_termo_acordo is False)
        ]

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
        apenas_padrao_uf: bool = False,
        ignorar_termo_acordo: bool = False,
        ignorar_reducao_produto: bool = False,
    ) -> ResolucaoAliquota:
        clean_uf = uf.strip().upper() if uf else ""
        clean_ncm = ncm.strip() if ncm else None

        if apenas_padrao_uf:
            return self._nivel_padrao_uf(perfil_regras_id, clean_uf)

        if not ignorar_reducao_produto:
            reducao = self._nivel_reducao_produto(
                perfil_regras_id, clean_ncm, descricao, escopo=ANTECIPACAO_PARCIAL
            )
            if reducao is not None:
                return reducao

        if not ignorar_termo_acordo:
            acordo = self._nivel_termo_acordo(empresa_id)
            if acordo is not None:
                return acordo

        return self._nivel_padrao(perfil_regras_id, clean_uf, clean_ncm)

    def resolve_reducao_tributaria(
        self,
        perfil_regras_id: int,
        ncm: Optional[str] = None,
        descricao: Optional[str] = None,
    ) -> Optional[ResolucaoAliquota]:
        """Resolve o percentual de redução da Base ST (ex: 0.41463) cadastrado na aba
        Antecipação Tributária de Reduções por Produto."""
        clean_ncm = ncm.strip() if ncm else None
        return self._nivel_reducao_produto(
            perfil_regras_id,
            clean_ncm,
            descricao,
            escopo=ANTECIPACAO_TRIBUTARIA,
        )

    def resolve_fcp(
        self,
        perfil_regras_id: int,
        uf: str,
        ncm: Optional[str] = None,
        descricao: Optional[str] = None,
        empresa_tem_termo_acordo: bool = False,
    ) -> Optional[ResolucaoAliquota]:
        """Resolve a alíquota de FCP cadastrada para (perfil, UF, NCM, descrição)."""
        clean_uf = uf.strip().upper() if uf else ""
        clean_ncm = _normalizar_ncm(ncm)
        if not clean_uf or not clean_ncm:
            return None
        regras = self._regras_fcp(
            perfil_regras_id,
            clean_uf,
            clean_ncm,
            empresa_tem_termo_acordo=empresa_tem_termo_acordo,
        )
        if not regras:
            return None
        return self._resolver_regras_por_produto(
            regras=regras,
            ncm=(ncm or "").strip() or clean_ncm,
            descricao=descricao,
            ctx=_CTX_FCP,
        )

    def resolve_a_dst_padrao(
        self, perfil_regras_id: int, uf: str, ncm: Optional[str] = None
    ) -> ResolucaoAliquota:
        """Resolve a alíquota interna padrão da UF/NCM (Nível 3), sem reduções por produto nem acordo."""
        clean_uf = uf.strip().upper() if uf else ""
        clean_ncm = ncm.strip() if ncm else None
        return self._nivel_padrao(perfil_regras_id, clean_uf, clean_ncm)

    # -- níveis --------------------------------------------------------------

    def _selecionar_regra_mais_especifica(
        self,
        candidatas: Sequence[Any],
        rotulo_item: str,
        ncm: str,
        ctx: _ContextoResolucaoRegra,
        desc: str = "",
    ) -> ResolucaoAliquota:
        max_len = max(len(regra.ncm) for regra in candidatas)
        especificas = [regra for regra in candidatas if len(regra.ncm) == max_len]
        if len(especificas) > 1:
            casamentos = [
                _CasamentoRegra(
                    regra=regra,
                    termos=tuple(
                        termo for termo in (regra.termos_inclusao or [])
                        if desc and casa_termo(desc, termo)
                    ),
                )
                for regra in especificas
            ]
            return self._resolver_colisao(rotulo_item, ncm, ctx, casamentos, "regras")
        regra = especificas[0]
        return ResolucaoAliquota(
            aliquota=Decimal(str(regra.aliquota)),
            origem=f"{ctx.prefixo_origem_regra}:{regra.id}",
            detalhe=f"{ctx.rotulo_regra_detalhe}: {regra.descricao or f'regra #{regra.id}'}",
        )

    def _resolver_colisao(
        self,
        rotulo_item: str,
        ncm: str,
        ctx: _ContextoResolucaoRegra,
        casamentos: List[_CasamentoRegra],
        especie: str,
    ) -> ResolucaoAliquota:
        """Mais de uma regra (ou exceção) de mesma especificidade casou o item.

        Com o mesmo valor em todas, o resultado não é ambíguo: o valor é aplicado
        e a redundância vira aviso, para o cadastro ser unificado. Com valores
        diferentes, escolher uma regra seria adivinhar: o processamento falha com
        as regras que colidiram e o que fazer a respeito.
        """
        ordenados = sorted(casamentos, key=lambda c: c.regra.id)
        valor = Decimal(str(ordenados[0].regra.aliquota))
        if not all(_mesmo_valor(c.regra.aliquota, valor) for c in ordenados):
            raise RuleResolutionException(
                self._msg_conflito(rotulo_item, ncm, ordenados, especie, ctx)
            )

        primeiro = ordenados[0]
        ids = _juntar_com_e([f"#{c.regra.id}" for c in ordenados])
        valor_txt = _formatar_valor(valor)
        excecoes = especie == "exceções"
        return ResolucaoAliquota(
            aliquota=valor,
            origem=(
                f"{ctx.prefixo_origem_excecao}:{primeiro.excecao_id}"
                if primeiro.excecao_id is not None
                else f"{ctx.prefixo_origem_regra}:{primeiro.regra.id}"
            ),
            detalhe=(
                f"Exceções cadastradas nas regras {ids} (mesma {ctx.nome_valor} de {valor_txt})"
                if excecoes
                else f"{ctx.rotulo_regra_detalhe}: regras {ids} (mesma {ctx.nome_valor} de {valor_txt})"
            ),
            aviso=(
                f"{ctx.rotulo_aviso_excecoes if excecoes else ctx.rotulo_aviso_regras} "
                f"{_juntar_com_e([self._rotulo_curto(c) for c in ordenados])} da aba "
                f'{ctx.rotulo_escopo} casaram com "{rotulo_item}" (NCM {ncm}), todas com '
                f"{valor_txt}; a {ctx.nome_valor} foi aplicada. Unifique essas regras no perfil: "
                "se os valores passarem a divergir, o processamento será interrompido "
                "por conflito."
            ),
        )

    def _resolver_regras_por_produto(
        self,
        regras: Sequence[Any],
        ncm: str,
        descricao: Optional[str],
        ctx: _ContextoResolucaoRegra,
    ) -> Optional[ResolucaoAliquota]:
        desc = normalizar(descricao) if descricao else ""
        # A mensagem mostra a descrição como veio na nota, não a normalizada.
        rotulo_item = (descricao or "").strip() or ncm

        if desc:
            casadas = [
                (regra, exc)
                for regra in regras
                for exc in regra.excecoes
                if exc.descricao_exata == desc
            ]
            positivas = [(regra, exc) for regra, exc in casadas if exc.enquadrado]
            if len(positivas) > 1:
                return self._resolver_colisao(
                    rotulo_item,
                    ncm,
                    ctx,
                    [_CasamentoRegra(regra=regra, excecao_id=exc.id) for regra, exc in positivas],
                    "exceções",
                )
            if positivas:
                regra, excecao = positivas[0]
                return ResolucaoAliquota(
                    aliquota=Decimal(str(regra.aliquota)),
                    origem=f"{ctx.prefixo_origem_excecao}:{excecao.id}",
                    detalhe=f"{ctx.rotulo_excecao_detalhe} {self._rotulo(regra)}",
                )
            bloqueadas_ids = {regra.id for regra, exc in casadas if not exc.enquadrado}
            if bloqueadas_ids:
                regras = [regra for regra in regras if regra.id not in bloqueadas_ids]
                if not regras:
                    return None

        regras_com_termos = [regra for regra in regras if regra.termos_inclusao]
        if desc and regras_com_termos:
            candidatas = [
                regra
                for regra in regras_com_termos
                if casa_algum(desc, regra.termos_inclusao)
                and not casa_algum(desc, regra.termos_exclusao)
            ]
            if candidatas:
                return self._selecionar_regra_mais_especifica(
                    candidatas, rotulo_item, ncm, ctx, desc=desc
                )

        regras_genericas = [regra for regra in regras if not regra.termos_inclusao]
        if regras_genericas:
            candidatas_genericas = [
                regra
                for regra in regras_genericas
                if not (desc and regra.termos_exclusao and casa_algum(desc, regra.termos_exclusao))
            ]
            if candidatas_genericas:
                return self._selecionar_regra_mais_especifica(
                    candidatas_genericas, rotulo_item, ncm, ctx
                )

        return None

    def _nivel_reducao_produto(
        self,
        perfil_regras_id: int,
        ncm: Optional[str],
        descricao: Optional[str],
        escopo: str = ANTECIPACAO_PARCIAL,
    ) -> Optional[ResolucaoAliquota]:
        if not ncm:
            return None
        regras = self._regras_reducao(perfil_regras_id, ncm, escopo=escopo)
        if not regras:
            return None
        return self._resolver_regras_por_produto(
            regras=regras,
            ncm=ncm,
            descricao=descricao,
            ctx=_contexto_reducao(escopo),
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

    def _buscar_regra_padrao_uf(
        self, perfil_regras_id: int, clean_uf: str
    ) -> Optional[ResolucaoAliquota]:
        regra_padrao = (
            self.db.query(RegraAliquotaDestino)
            .filter(
                RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                RegraAliquotaDestino.uf == clean_uf,
                or_(RegraAliquotaDestino.ncm == None, RegraAliquotaDestino.ncm == ""),  # noqa: E711
            )
            .first()
        )
        if regra_padrao is None:
            return None
        return ResolucaoAliquota(
            aliquota=Decimal(str(regra_padrao.aliquota)),
            origem=f"padrao_uf:{regra_padrao.id}",
            detalhe=f"Alíquota padrão da UF {clean_uf}",
        )

    def _nivel_padrao(
        self, perfil_regras_id: int, clean_uf: str, clean_ncm: Optional[str]
    ) -> ResolucaoAliquota:
        ncm_digits = _normalizar_ncm(clean_ncm)
        if ncm_digits:
            regras_ncm = (
                self.db.query(RegraAliquotaDestino)
                .filter(
                    RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                    RegraAliquotaDestino.uf == clean_uf,
                    RegraAliquotaDestino.ncm.isnot(None),
                    RegraAliquotaDestino.ncm != "",
                )
                .all()
            )
            candidatas = [
                r for r in regras_ncm if r.ncm and ncm_digits.startswith(r.ncm)
            ]
            if candidatas:
                regra_ncm = max(candidatas, key=lambda r: len(r.ncm))
                return ResolucaoAliquota(
                    aliquota=Decimal(str(regra_ncm.aliquota)),
                    origem=f"regra_ncm:{regra_ncm.id}",
                    detalhe=f"Exceção por NCM {regra_ncm.ncm} na UF {clean_uf}",
                )

        padrao = self._buscar_regra_padrao_uf(perfil_regras_id, clean_uf)
        if padrao is not None:
            return padrao

        ncm_info = f" e NCM '{clean_ncm}'" if clean_ncm else ""
        raise RuleResolutionException(
            f"Nenhuma regra de alíquota de destino (A.DST) encontrada para UF '{clean_uf}'{ncm_info} no perfil de regras ID {perfil_regras_id}. "
            f"Cadastre a alíquota padrão ou a exceção para este estado."
        )

    def _nivel_padrao_uf(self, perfil_regras_id: int, clean_uf: str) -> ResolucaoAliquota:
        padrao = self._buscar_regra_padrao_uf(perfil_regras_id, clean_uf)
        if padrao is not None:
            return padrao

        raise RuleResolutionException(
            f"Nenhuma regra de alíquota padrão encontrada para UF '{clean_uf}' no perfil de regras ID {perfil_regras_id}. "
            f"Cadastre a alíquota padrão para este estado."
        )

    def resolve_a_dst_padrao_uf(self, perfil_regras_id: int, uf: str) -> ResolucaoAliquota:
        return self._nivel_padrao_uf(perfil_regras_id, uf.strip().upper() if uf else "")

    # -- mensagens -----------------------------------------------------------

    @staticmethod
    def _rotulo(regra: Any) -> str:
        return f'#{regra.id} "{regra.descricao or "sem rótulo"}"'

    @staticmethod
    def _descrever_casamento(casamento: _CasamentoRegra) -> str:
        regra = casamento.regra
        descricao = (regra.descricao or "").strip()
        rotulo = f'"{descricao}"' if descricao else "sem descrição"
        if casamento.excecao_id is not None:
            motivo = f"casou pela exceção de descrição exata #{casamento.excecao_id}"
        elif casamento.termos:
            palavra = "os termos" if len(casamento.termos) > 1 else "o termo"
            motivo = f"casou com {palavra} {_lista_entre_aspas(casamento.termos)}"
        else:
            motivo = "sem termos de inclusão (vale para todo o NCM)"
        return f"#{regra.id} {rotulo} — NCM {regra.ncm}, {_formatar_valor(regra.aliquota)}, {motivo}"

    @staticmethod
    def _rotulo_curto(casamento: _CasamentoRegra) -> str:
        if casamento.excecao_id is not None:
            motivo = f"exceção #{casamento.excecao_id}"
        elif casamento.termos:
            palavra = "termos" if len(casamento.termos) > 1 else "termo"
            motivo = f"{palavra} {_lista_entre_aspas(casamento.termos)}"
        else:
            motivo = "sem termos"
        return f"#{casamento.regra.id} ({motivo})"

    @classmethod
    def _msg_conflito(
        cls,
        rotulo_item: str,
        ncm: str,
        casamentos: List[_CasamentoRegra],
        especie: str,
        ctx: _ContextoResolucaoRegra,
    ) -> str:
        """Aponta o item, as regras que colidiram e o que fazer a respeito.

        Falhar em vez de escolher é deliberado: aplicar a alíquota errada em
        silêncio gera passivo que só aparece em fiscalização.
        """
        linhas = "\n".join(f"  {cls._descrever_casamento(c)}" for c in casamentos)
        instrucao = (
            "Mantenha a exceção com esta descrição só na regra que deve prevalecer, "
            "para que o sistema saiba qual aplicar."
            if especie == "exceções"
            else "Cadastre uma exceção com a descrição exata deste item na regra que "
            "deve prevalecer, para que o sistema saiba qual aplicar."
        )
        return (
            f'Conflito de {especie} {ctx.substantivo_conflito} no item "{rotulo_item}" (NCM {ncm}).\n\n'
            f"Estas {especie} da aba {ctx.rotulo_escopo} casaram o mesmo item com valores "
            f"diferentes:\n{linhas}\n\n{instrucao}"
        )
