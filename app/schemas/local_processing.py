from typing import Any, Dict, List, Optional
from datetime import date, datetime

from pydantic import BaseModel, Field, validator

from app.constants import TIPOS_PLANILHA


class LocalProcessedNoteIn(BaseModel):
    chave_acesso: Optional[str] = None
    numero_nota: str
    serie: Optional[str] = None
    cnpj_emitente: Optional[str] = None
    uf_emitente: Optional[str] = None
    cnpj_destinatario: str
    uf_destinatario: Optional[str] = None
    data_emissao: datetime
    data_entrada: Optional[date] = None
    origem_data_entrada: Optional[str] = None
    item_numero: int = 1
    ncm: str
    cfop: Optional[str] = None
    destino_planilha: Optional[str] = None
    v_total: float
    base_calculo: float
    ipi_despesas: float = 0.0
    a_ori: float
    a_dst_resolvida: float
    debito: float
    credito: float
    valor_devido: float
    metadados_extras: Dict[str, Any] = Field(default_factory=dict)

    @validator("destino_planilha")
    def validate_destination(cls, value):
        if value is not None and value not in TIPOS_PLANILHA:
            raise ValueError("destino_planilha inválido")
        return value

    class Config:
        extra = "forbid"


class LocalOutputSummaryIn(BaseModel):
    tipo: str
    template_id: Optional[int] = None
    total_notas: int = 0
    total_valor_devido: float = 0.0
    aviso: Optional[str] = None

    @validator("tipo")
    def validate_tipo(cls, value):
        if value not in TIPOS_PLANILHA:
            raise ValueError("tipo de saída inválido")
        return value

    class Config:
        extra = "forbid"


class LocalProcessingResultIn(BaseModel):
    notas_processadas: List[LocalProcessedNoteIn] = Field(default_factory=list)
    saidas: List[LocalOutputSummaryIn] = Field(default_factory=list)
    notas_ignoradas: List[Dict[str, Any]] = Field(default_factory=list)
    itens_excluidos: List[Dict[str, Any]] = Field(default_factory=list)
    avisos_avaliacao: List[Dict[str, Any]] = Field(default_factory=list)
    cfops_sem_regra: Dict[str, int] = Field(default_factory=dict)
    mensagem: Optional[str] = None

    class Config:
        extra = "forbid"


class LocalProcessingContextOut(BaseModel):
    empresa: Dict[str, Any]
    perfil: Dict[str, Any]
    regras_aliquotas: List[Dict[str, Any]]
    regras_cfop: List[Dict[str, Any]]
    regras_reducao: List[Dict[str, Any]]
    regras_reclassificacao: List[Dict[str, Any]]
    regras_exclusao_parcial: List[Dict[str, Any]]
    templates_ativos: List[Dict[str, Any]]
    mva_anexo: List[Dict[str, Any]]
