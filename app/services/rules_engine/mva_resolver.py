import os
import json
import re
from decimal import Decimal
from typing import Optional, Dict, Any, List
from app.core.config import settings
from app.core.exceptions import ValidationException

class MvaResolver:
    """
    Resolvedor determinístico de MVA (Margem de Valor Agregado) para Antecipação Tributária.
    Consulta a tabela oficial do Anexo I (storage/data/AnexoI.json) por NCM e Alíquota de Origem (A.ORI).
    
    Suporta:
    - Match exato de NCM e por prefixos (8, 7, 6, 5, 4, 3, 2 dígitos)
    - MVA ajustada conforme a alíquota interestadual (4%, 7%, 12%)
    - Fallback para MVA padrão (12%), MVA original ou zero
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
            return fallback_mva

        clean_cest = re.sub(r"\D", "", str(cest or ""))
        if clean_cest:
            cest_matches = [entry for entry in matches if re.sub(r"\D", "", str(entry.get("cest") or "")) == clean_cest]
            if cest_matches:
                matches = cest_matches

        resolved_values = {value for entry in matches if (value := cls._value_for_entry(entry, ori_key)) is not None}
        if len(resolved_values) > 1:
            raise ValidationException(
                f"O NCM {clean_ncm} possui mais de uma MVA aplicável. Informe um CEST válido no documento fiscal."
            )
        return next(iter(resolved_values), fallback_mva)

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
