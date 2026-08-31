from typing import Optional, Dict, Any
from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel, Field, validator

class NotaFiscalProcessadaOut(BaseModel):
    id: str
    solicitacao_id: str
    chave_acesso: Optional[str]
    numero_nota: str
    serie: Optional[str]
    cnpj_emitente: Optional[str]
    uf_emitente: Optional[str] = None
    cnpj_destinatario: str
    uf_destinatario: Optional[str] = None
    data_emissao: datetime
    data_entrada: Optional[date] = None
    origem_data_entrada: Optional[str] = None
    item_numero: int
    ncm: str
    cfop: Optional[str]
    destino_planilha: Optional[str] = None
    v_total: Decimal
    base_calculo: Decimal
    ipi_despesas: Decimal
    a_ori: Decimal
    a_dst_resolvida: Decimal
    debito: Decimal
    credito: Decimal
    valor_devido: Decimal
    metadados_extras: Dict[str, Any]
    criado_em: datetime

    @validator("id", "solicitacao_id", pre=True)
    def ensure_str_uuid(cls, v):
        return str(v) if v is not None else v

    class Config:
        orm_mode = True

class NotaFiscalDataEntradaUpdate(BaseModel):
    data_entrada: date = Field(..., description="Data de entrada no formato YYYY-MM-DD")
