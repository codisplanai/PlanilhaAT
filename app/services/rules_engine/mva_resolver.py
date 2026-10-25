import os
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional, Dict, Any, List, Tuple
from app.core.config import settings
from app.core.exceptions import ValidationException

MVA_ORIGINAL = "original"
MVA_AJUSTADA = "ajustada"

# Código CEST no formato 00.000.00 (com ou sem pontos).
_PADRAO_CEST = re.compile(r"\d{2}\.?\d{3}\.?\d{2}")


@dataclass(frozen=True)
class ResultadoMva:
    """MVA resolvida para um item, ou o motivo de ela ter ficado pendente."""

    mva: Optional[Decimal]
    coluna: Optional[str]
    motivo_pendencia: Optional[str] = None
    itens_anexo: Tuple[str, ...] = ()

    @property
    def pendente(self) -> bool:
        return self.mva is None


class MvaResolver:
    """
    Resolvedor determinístico de MVA (Margem de Valor Agregado) para Antecipação Tributária.
    Consulta a tabela oficial do Anexo I (storage/data/AnexoI.json) por NCM e Alíquota de Origem (A.ORI).

    Suporta:
    - Match exato de NCM e por prefixos (8, 7, 6, 5, 4, 3, 2 dígitos)
    - MVA ajustada conforme a alíquota interestadual (4%, 7%, 12%)

    O pipeline usa `resolver_para_item`, que escolhe a coluna da MVA pelo regime
    do fornecedor e nunca completa a falta de dado com um valor padrão: quando a
    MVA não pode ser determinada, devolve o motivo da pendência. `resolve_mva`
    é a consulta antiga, com valores de fallback, mantida por compatibilidade.
    """

    _cache_entries: Optional[List[Dict[str, Any]]] = None
    _bundled_anexo_file_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "storage",
        "data",
        "AnexoI.json",
    )
    _anexo_file_path = os.path.join(settings.STORAGE_DIR, "data", "AnexoI.json")

    @classmethod
    def set_custom_path(cls, path: str) -> None:
        cls._anexo_file_path = path
        cls._cache_entries = None

    @classmethod
    def _normalize_a_ori_key(cls, a_ori: Optional[Decimal]) -> Optional[str]:
        if a_ori is None:
            return "12"
        try:
            val = float(a_ori)
            if val <= 0:
                return "12"
            if val <= 0.05: # ex: 0.04
                return "4"
            elif val <= 0.09: # ex: 0.07
                return "7"
            elif val <= 0.15: # ex: 0.12
                return "12"
            elif 3.5 <= val <= 4.5: # ex: 4.0
                return "4"
            elif 6.5 <= val <= 7.5: # ex: 7.0
                return "7"
            elif 11.5 <= val <= 12.5: # ex: 12.0
                return "12"
            else:
                return str(int(round(val)))
        except Exception:
            return "12"

    @classmethod
    def _load_anexo_entries(cls) -> List[Dict[str, Any]]:
        if cls._cache_entries is not None:
            return cls._cache_entries

        entries: List[Dict[str, Any]] = []
        source_path = cls._anexo_file_path
        if not os.path.exists(source_path):
            source_path = cls._bundled_anexo_file_path
        if not os.path.exists(source_path):
            cls._cache_entries = entries
            return cls._cache_entries

        try:
            with open(source_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        # Ignorar metadados
                        if item.get("_meta"):
                            continue
                        ncm_raw = item.get("ncm") or item.get("NCM") or ""
                        ncm_clean = re.sub(r"\D", "", str(ncm_raw))
                        if not ncm_clean:
                            continue
                        
                        entry = {
                            "ncm": ncm_clean,
                            "item": item.get("item"),
                            "mva": item.get("mva"),
                            "mva_ajustada": item.get("mva_ajustada"),
                            "mva_original": item.get("mva_original"),
                            "cest": item.get("cest"),
                            "descricao": item.get("descricao")
                        }
                        entries.append(entry)
            elif isinstance(data, dict):
                for k, v in data.items():
                    ncm_clean = re.sub(r"\D", "", str(k))
                    if ncm_clean:
                        entries.append({
                            "ncm": ncm_clean,
                            "mva": v,
                            "mva_ajustada": None,
                            "mva_original": None
                        })
        except Exception:
            pass

        cls._cache_entries = entries
        return cls._cache_entries

    @classmethod
    def resolve_mva(
        cls,
        ncm: Optional[str],
        a_ori: Optional[Decimal] = None,
        fallback_mva: Optional[Decimal] = None,
        cest: Optional[str] = None,
    ) -> Decimal:
        """
        Resolve a alíquota MVA (%) para o NCM e A.ORI fornecidos.
        Retorna em formato percentual (ex: Decimal('57.92') para 57,92%).
        """
        if fallback_mva is None:
            fallback_mva = Decimal("0.00")

        if not ncm:
            return fallback_mva

        clean_ncm = re.sub(r"\D", "", str(ncm))
        if not clean_ncm:
            return fallback_mva

        entries = cls._load_anexo_entries()
        if not entries:
            return fallback_mva

        ori_key = cls._normalize_a_ori_key(a_ori)

        matches = cls._candidatos(entries, clean_ncm, cest)
        if not matches:
            return fallback_mva

        resolved_values = {value for entry in matches if (value := cls._value_for_entry(entry, ori_key)) is not None}
        if len(resolved_values) > 1:
            raise ValidationException(
                f"O NCM {clean_ncm} possui mais de uma MVA aplicável. Informe um CEST válido no documento fiscal."
            )
        return next(iter(resolved_values), fallback_mva)

    @staticmethod
    def _candidatos(
        entries: List[Dict[str, Any]],
        clean_ncm: str,
        cest: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Busca antiga, usada só por `resolve_mva`: prefixo mais longo e CEST opcional.

        O fluxo da Antecipação Tributária usa `_candidatos_por_ncm` e
        `_cests_do_item`, que não descartam itens antes de olhar o CEST.
        """
        # Buscar melhor match por NCM (do mais específico ao mais geral)
        best_prefix_len = 0
        matches: List[Dict[str, Any]] = []

        for entry in entries:
            entry_ncm = entry["ncm"]
            # Match exato ou prefixo: se o NCM consultado começa com entry_ncm ou vice-versa
            if clean_ncm.startswith(entry_ncm):
                prefix_len = len(entry_ncm)
                if prefix_len > best_prefix_len:
                    best_prefix_len = prefix_len
                    matches = [entry]
                elif prefix_len == best_prefix_len:
                    matches.append(entry)
            elif entry_ncm.startswith(clean_ncm) and len(clean_ncm) >= 4:
                prefix_len = len(clean_ncm)
                if prefix_len > best_prefix_len:
                    best_prefix_len = prefix_len
                    matches = [entry]
                elif prefix_len == best_prefix_len:
                    matches.append(entry)

        if not matches:
            return matches

        clean_cest = re.sub(r"\D", "", str(cest or ""))
        if clean_cest:
            cest_matches = [entry for entry in matches if re.sub(r"\D", "", str(entry.get("cest") or "")) == clean_cest]
            if cest_matches:
                matches = cest_matches

        return matches

    @staticmethod
    def _candidatos_por_ncm(entries: List[Dict[str, Any]], clean_ncm: str) -> List[Dict[str, Any]]:
        """Todos os itens do Anexo cujo código casa com o NCM do documento.

        Não descarta itens de código mais curto: itens com o mesmo NCM são
        separados pelo CEST, não pelo tamanho do código no Anexo.
        """
        candidatos: List[Dict[str, Any]] = []
        for entry in entries:
            codigo = str(entry.get("ncm") or "")
            if not codigo:
                continue
            if clean_ncm.startswith(codigo) or (len(clean_ncm) >= 4 and codigo.startswith(clean_ncm)):
                candidatos.append(entry)
        return candidatos

    @staticmethod
    def _cests_do_item(entry: Dict[str, Any]) -> set:
        """CESTs de um item do Anexo, só com dígitos (um item pode ter mais de um)."""
        bruto = entry.get("cest")
        valores = bruto if isinstance(bruto, (list, tuple)) else [bruto]
        cests = set()
        for valor in valores:
            if valor is None:
                continue
            for achado in _PADRAO_CEST.findall(str(valor)):
                cests.add(re.sub(r"\D", "", achado))
        return cests

    @staticmethod
    def _formatar_cest(cest: str) -> str:
        return f"{cest[:2]}.{cest[2:5]}.{cest[5:]}" if len(cest) == 7 else cest

    @staticmethod
    def coluna_por_regime(crt: Optional[str], evidencia_csosn: bool) -> Optional[str]:
        """Coluna do Anexo 1 conforme o regime do fornecedor.

        CRT 1 (Simples Nacional) e 4 (MEI) usam a MVA original; CRT 2 (Simples com
        excesso de sublimite) e 3 (regime normal) usam a MVA ajustada. Sem CRT
        (nota vinda só do SPED), vale o código de tributação: CSOSN é exclusivo de
        CRT 1 e 4, e CST é usado por CRT 2 e 3. CRT com valor desconhecido não
        permite escolher a coluna e retorna None.
        """
        valor = (crt or "").strip()
        if valor in ("1", "4"):
            return MVA_ORIGINAL
        if valor in ("2", "3"):
            return MVA_AJUSTADA
        if valor:
            return None
        return MVA_ORIGINAL if evidencia_csosn else MVA_AJUSTADA

    @staticmethod
    def chave_aliquota_interestadual(a_ori: Optional[Decimal]) -> Optional[str]:
        """Faixa da MVA ajustada (4, 7 ou 12) para a A.ORI do documento.

        Ao contrário de `_normalize_a_ori_key`, não aproxima valores nem assume
        12%: qualquer alíquota que não seja exatamente 4%, 7% ou 12% retorna None.
        """
        if a_ori is None:
            return None
        try:
            valor = Decimal(str(a_ori))
        except (InvalidOperation, ValueError):
            return None
        if valor <= 0:
            return None
        percentual = valor * 100 if valor <= 1 else valor
        for chave in ("4", "7", "12"):
            if abs(percentual - Decimal(chave)) < Decimal("0.005"):
                return chave
        return None

    @staticmethod
    def _numero(valor: Any) -> Optional[Decimal]:
        if valor is None or isinstance(valor, bool):
            return None
        try:
            numero = Decimal(str(valor))
        except (InvalidOperation, ValueError):
            return None
        return numero if numero.is_finite() else None

    @classmethod
    def _valor_da_coluna(
        cls,
        entry: Dict[str, Any],
        coluna: str,
        chave: Optional[str],
    ) -> Tuple[Optional[Decimal], bool]:
        """Valor numérico da coluna no item do Anexo e se o item tem MVA condicional."""
        campo = "mva_original" if coluna == MVA_ORIGINAL else "mva_ajustada"
        casos = [caso for caso in (entry.get(campo) or []) if isinstance(caso, dict)]
        if len(casos) > 1:
            return None, True
        if not casos:
            return None, False
        if coluna == MVA_ORIGINAL:
            return cls._numero(casos[0].get("valor")), False
        aliquotas = casos[0].get("aliquotas") or {}
        return cls._numero(aliquotas.get(chave)) if chave else None, False

    @staticmethod
    def _rotulo_itens(itens: Tuple[str, ...], limite: int = 5) -> str:
        if not itens:
            return ""
        if len(itens) == 1:
            return f", item {itens[0]} do Anexo 1"
        visiveis = ", ".join(itens[:limite])
        restantes = len(itens) - limite
        sufixo = f" e mais {restantes}" if restantes > 0 else ""
        return f", itens {visiveis}{sufixo} do Anexo 1"

    @staticmethod
    def _formatar_percentual(valor: Decimal) -> str:
        texto = f"{valor.quantize(Decimal('0.01')):f}"
        if texto.endswith(".00"):
            texto = texto[:-3]
        return texto.replace(".", ",") + "%"

    @classmethod
    def resolver_para_item(
        cls,
        *,
        ncm: Optional[str],
        cest: Optional[str],
        a_ori: Optional[Decimal],
        coluna: Optional[str],
    ) -> ResultadoMva:
        """MVA de um item de Antecipação Tributária, sem valores de fallback.

        `coluna` vem de `coluna_por_regime`. A MVA ajustada usa a faixa da A.ORI
        destacada no documento.

        Itens possíveis: todos os itens do Anexo cujo código casa com o NCM. Com
        CEST no documento, fica só o item desse CEST; se nenhum item possível tem
        esse CEST, há divergência entre NCM e CEST e o item fica pendente. Sem CEST,
        a MVA só é usada se for a mesma em todos os itens possíveis.

        Fica pendente, com o motivo, quando o NCM não está no Anexo, quando o CEST
        diverge do NCM, quando a MVA do item não é numérica (PMPF, Ato COTEPE,
        preço sugerido), quando é condicional, quando os itens possíveis têm MVAs
        diferentes, ou quando a A.ORI não permite escolher a faixa da MVA ajustada.
        """
        if coluna not in (MVA_ORIGINAL, MVA_AJUSTADA):
            return ResultadoMva(
                mva=None,
                coluna=None,
                motivo_pendencia=(
                    "MVA pendente: regime do fornecedor não identificado (CRT ausente ou inválido), "
                    "sem como escolher entre MVA original e ajustada."
                ),
            )

        clean_ncm = re.sub(r"\D", "", str(ncm or ""))
        if not clean_ncm:
            return ResultadoMva(
                mva=None,
                coluna=coluna,
                motivo_pendencia="MVA pendente: item sem NCM no documento fiscal.",
            )

        chave: Optional[str] = None
        if coluna == MVA_AJUSTADA:
            chave = cls.chave_aliquota_interestadual(a_ori)
            if chave is None:
                a_ori_num = cls._numero(a_ori)
                if a_ori_num is None or a_ori_num <= 0:
                    descricao_a_ori = "ausente no documento"
                else:
                    percentual = a_ori_num * 100 if a_ori_num <= 1 else a_ori_num
                    descricao_a_ori = f"de {cls._formatar_percentual(percentual)}"
                return ResultadoMva(
                    mva=None,
                    coluna=coluna,
                    motivo_pendencia=(
                        f"MVA pendente: fornecedor em regime normal (MVA ajustada) e A.ORI {descricao_a_ori}; "
                        "a MVA ajustada só existe para 4%, 7% e 12%."
                    ),
                )

        entries = cls._load_anexo_entries()
        if not entries:
            return ResultadoMva(
                mva=None,
                coluna=coluna,
                motivo_pendencia="MVA pendente: a tabela do Anexo 1 não está disponível no sistema.",
            )

        candidatos = cls._candidatos_por_ncm(entries, clean_ncm)
        if not candidatos:
            return ResultadoMva(
                mva=None,
                coluna=coluna,
                motivo_pendencia=(
                    f"MVA pendente: NCM {clean_ncm} não encontrado no Anexo 1 carregado no sistema."
                ),
            )

        clean_cest = re.sub(r"\D", "", str(cest or ""))
        if clean_cest:
            com_cest = [entry for entry in candidatos if clean_cest in cls._cests_do_item(entry)]
            if not com_cest:
                itens_ncm = tuple(dict.fromkeys(str(entry.get("item")) for entry in candidatos if entry.get("item")))
                return ResultadoMva(
                    mva=None,
                    coluna=coluna,
                    motivo_pendencia=(
                        f"MVA pendente: divergência entre NCM e CEST. O CEST {cls._formatar_cest(clean_cest)} "
                        f"do documento não corresponde a nenhum item do Anexo 1 para o NCM "
                        f"{clean_ncm}{cls._rotulo_itens(itens_ncm)}."
                    ),
                    itens_anexo=itens_ncm,
                )
            candidatos = com_cest

        itens = tuple(dict.fromkeys(str(entry.get("item")) for entry in candidatos if entry.get("item")))
        rotulo = cls._rotulo_itens(itens)

        nome_coluna = "original" if coluna == MVA_ORIGINAL else f"ajustada ({chave}%)"
        valores = set()
        for entry in candidatos:
            valor, condicional = cls._valor_da_coluna(entry, coluna, chave)
            if condicional:
                return ResultadoMva(
                    mva=None,
                    coluna=coluna,
                    motivo_pendencia=(
                        f"MVA pendente: o Anexo 1 traz mais de um caso de MVA para o NCM {clean_ncm}{rotulo}, "
                        "e a escolha depende de informação que não está no documento."
                    ),
                    itens_anexo=itens,
                )
            if valor is None:
                return ResultadoMva(
                    mva=None,
                    coluna=coluna,
                    motivo_pendencia=(
                        f"MVA pendente: o Anexo 1 não traz MVA {nome_coluna} numérica para o NCM {clean_ncm}{rotulo} "
                        "(o item usa outra base, como PMPF ou preço sugerido, ou está sem valor na tabela)."
                    ),
                    itens_anexo=itens,
                )
            valores.add(valor)

        if len(valores) > 1:
            lista = " / ".join(cls._formatar_percentual(v) for v in sorted(valores))
            falta = (
                "e o CEST do documento não identificou um único item."
                if clean_cest
                else "e o documento não traz CEST para identificar o item."
            )
            return ResultadoMva(
                mva=None,
                coluna=coluna,
                motivo_pendencia=(
                    f"MVA pendente: o NCM {clean_ncm} tem mais de uma MVA {nome_coluna} possível ({lista}){rotulo}, "
                    f"{falta}"
                ),
                itens_anexo=itens,
            )

        return ResultadoMva(mva=next(iter(valores)), coluna=coluna, itens_anexo=itens)

    @classmethod
    def _value_for_entry(cls, entry: Dict[str, Any], ori_key: Optional[str]) -> Optional[Decimal]:

        # 1. Tentar obter da MVA ajustada para a alíquota de origem (4%, 7%, 12%)
        ajustadas = entry.get("mva_ajustada")
        if ajustadas and isinstance(ajustadas, list):
            for aj in ajustadas:
                if isinstance(aj, dict):
                    aliq_map = aj.get("aliquotas") or {}
                    if ori_key and ori_key in aliq_map and aliq_map[ori_key] is not None:
                        try:
                            return Decimal(str(aliq_map[ori_key]))
                        except Exception:
                            pass
                    # Se não achou a chave exata, tenta 12% como padrão geral
                    if "12" in aliq_map and aliq_map["12"] is not None:
                        try:
                            return Decimal(str(aliq_map["12"]))
                        except Exception:
                            pass

        # 2. Tentar valor 'mva' direto da entrada
        if entry.get("mva") is not None:
            try:
                return Decimal(str(entry["mva"]))
            except Exception:
                pass

        # 3. Tentar valor 'mva_original'
        orig = entry.get("mva_original")
        if orig and isinstance(orig, list) and len(orig) > 0 and isinstance(orig[0], dict):
            val = orig[0].get("valor")
            if val is not None:
                try:
                    return Decimal(str(val))
                except Exception:
                    pass

        return None
