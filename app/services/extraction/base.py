from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, date
from decimal import Decimal
import re
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
    # False quando a descrição foi fabricada pelo extrator (SPED sem C170) em vez
    # de vir do documento. Regras de redução por produto ignoram esses itens: o
    # texto sintético não é descrição de mercadoria.
    descricao_confiavel: bool = True
    v_item: Decimal       # Valor do produto/item
    v_total: Decimal      # Valor total correspondente ao item (incluindo rateio de frete/seguro/despesas/IPI se aplicável)
    base_calculo: Decimal # Base de cálculo do ICMS (vBC)
    ipi_despesas: Decimal # IPI + Frete + Seguro + Outras despesas acessórias
    a_ori: Decimal        # Alíquota da operação (pICMS / ALIQ_ICMS), ex: 0.12 para 12%
    p_cred_sn: Decimal = Decimal("0.00")  # Percentual de crédito do Simples, distinto da A.ORI
    v_icms: Decimal = Decimal("0.00")  # Valor do ICMS destacado (crédito) extraído do documento/item
    v_icms_st: Decimal = Decimal("0.00")  # ST destacada no item do XML, nunca inferida pelo CFOP
    frete_fob_st_mva: Optional[Decimal] = None  # MVA comprovada para complemento do frete FOB
    frete_fob_st_reducao: Optional[Decimal] = None  # Redução comprovada, em fração
    origem_mercadoria: Optional[str] = None  # Dígito 0 a 8 indicativo da procedência (nacional, importada, etc.)
    csosn: Optional[str] = None  # Código de Situação da Operação no Simples Nacional (ex: 101, 102, 500)
    v_desc: Decimal = Decimal("0.00")  # Desconto comercial destacado no item (tag vDesc)

class ExtractedNFData(BaseModel):
    chave_acesso: str = ""
    numero_nota: str
    serie: str = ""
    cnpj_emitente: str = ""
    uf_emitente: str = ""
    cnpj_destinatario: str = ""
    uf_destinatario: str = ""
    data_emissao: Optional[datetime] = None
    data_entrada: Optional[date] = None
    v_total_nota: Decimal
    v_bc_nota: Decimal
    v_icms_nota: Decimal = Decimal("0.00")
    v_desc_nota: Decimal = Decimal("0.00")  # Desconto comercial total da nota (tag vDesc)
    # Alíquota de crédito de ICMS autorizada em Informações Complementares (ex: 0.0359); None se ausente
    aliq_credito_icms_inf_compl: Optional[Decimal] = None
    # Situação no protocolo de autorização (protNFe/infProt): cStat 100/150 = autorizada.
    c_stat_protocolo: Optional[str] = None
    protocolo_autorizacao: Optional[str] = None
    itens: List[ExtractedItemNF]
    raw_metadata: Dict[str, Any] = Field(default_factory=dict)
    origem_extracao: str = "xml"  # "xml" ou "sped"

class ExtractedCTeData(BaseModel):
    chave_acesso: str = ""
    numero_cte: str
    serie: str = ""
    cfop: str = ""
    cnpj_emitente: str = ""
    nome_emitente: str = ""
    uf_emitente: str = ""
    uf_inicio: str = ""
    uf_fim: str = ""
    cnpj_tomador: str = ""
    toma_codigo: str = ""
    data_emissao: Optional[datetime] = None
    data_entrada: Optional[date] = None
    v_total_cte: Decimal
    v_bc_cte: Decimal = Decimal("0.00")
    a_ori: Decimal = Decimal("0.00")
    a_ori_destacada: bool = False
    v_icms_cte: Decimal = Decimal("0.00")
    fornecedor_simples_nacional: bool = False
    chaves_nfe: List[str] = Field(default_factory=list)
    raw_metadata: Dict[str, Any] = Field(default_factory=dict)


def extrair_numero_serie_chave_nfe(chave: str) -> Tuple[str, str]:
    """Extrai (numero_nota, serie) de uma chave de acesso NF-e de 44 dígitos."""
    clean = re.sub(r"\D", "", chave or "")
    if len(clean) != 44:
        return "", ""
    serie = clean[22:25].lstrip("0") or "0"
    numero = clean[25:34].lstrip("0") or "0"
    return numero, serie


class BaseNFEExtractor(ABC):
    """Interface abstrata para extração de dados de NF-e (desacoplada para permitir múltiplos formatos no futuro)"""
    @abstractmethod
    def extract_from_xml(self, xml_content: bytes) -> ExtractedNFData:
        pass
