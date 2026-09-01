from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel, Field

IBGE_UF_MAP: Dict[str, str] = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
    "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
    "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
    "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF"
}

class ExtractedItemNF(BaseModel):
    item_numero: int
    ncm: str
    cest: str = ""
    cfop: str = ""
    descricao: str = ""
    v_item: Decimal       # Valor do produto/item
    v_total: Decimal      # Valor total correspondente ao item (incluindo rateio de frete/seguro/despesas/IPI se aplicável)
    base_calculo: Decimal # Base de cálculo do ICMS (vBC)
    ipi_despesas: Decimal # IPI + Frete + Seguro + Outras despesas acessórias
    a_ori: Decimal        # Alíquota de origem extraída do XML ou SPED (pICMS / ALIQ_ICMS), ex: 0.12 para 12%

class ExtractedNFData(BaseModel):
    chave_acesso: str = ""
    numero_nota: str
    serie: str = ""
    cnpj_emitente: str = ""
    uf_emitente: str = ""
    cnpj_destinatario: str = ""
    uf_destinatario: str = ""
    data_emissao: datetime
    data_entrada: Optional[date] = None
    v_total_nota: Decimal
    v_bc_nota: Decimal
    itens: List[ExtractedItemNF]
    raw_metadata: Dict[str, Any] = Field(default_factory=dict)
    origem_extracao: str = "xml"  # "xml" ou "sped"

class BaseNFEExtractor(ABC):
    """Interface abstrata para extração de dados de NF-e (desacoplada para permitir múltiplos formatos no futuro)"""
    @abstractmethod
    def extract_from_xml(self, xml_content: bytes) -> ExtractedNFData:
        pass
