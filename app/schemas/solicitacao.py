from typing import Optional, List, Dict, Any
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, Field, validator
from app.schemas.nota_fiscal import NotaFiscalProcessadaOut
from app.constants import TIPOS_PLANILHA_LEGADO
import os

class NotaIgnoradaOut(BaseModel):
    numero_nota: str
    serie: Optional[str] = None
    chave_acesso: Optional[str] = None
    data_emissao: Optional[str] = None
    motivo: str
    arquivo: Optional[str] = None


class ItemExcluidoOut(BaseModel):
    chave_acesso: Optional[str] = None
    numero_nota: str
    serie: Optional[str] = None
    item_numero: int
    arquivo: Optional[str] = None
    destino: str
    ncm: str
    descricao: str
    descricao_confiavel: bool = True
    motivo: str
    tipo_exclusao: str
    regras_aplicadas: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    v_total: Optional[Decimal] = None
    base_calculo: Optional[Decimal] = None
    ipi_despesas: Optional[Decimal] = None
    a_ori: Optional[Decimal] = None
    a_dst: Optional[Decimal] = None
    debito: Optional[Decimal] = None
    credito: Optional[Decimal] = None
    valor_devido: Optional[Decimal] = None


class AvisoAvaliacaoOut(BaseModel):
    numero_nota: str
    serie: Optional[str] = None
    item_numero: int
    arquivo: Optional[str] = None
    aviso: str


class SolicitacaoCreate(BaseModel):
    empresa_id: int = Field(..., example=1)
    periodo_inicio: date = Field(..., example="2026-01-01")
    periodo_fim: date = Field(..., example="2026-01-31")
    tipo_planilha: Optional[str] = Field(
        None,
        example="multi",
        description="Legado: antecipacao_parcial, antecipacao_tributaria ou difal. Se omitido, o sistema roteia automaticamente por CFOP e gera todas as planilhas aplicáveis."
    )
    template_id: Optional[int] = Field(None, description="Legado: usado apenas junto com tipo_planilha para o fluxo de tipo único")

    @validator("periodo_fim")
    def validate_periodo(cls, v, values):
        if "periodo_inicio" in values and v < values["periodo_inicio"]:
            raise ValueError("periodo_fim não pode ser anterior a periodo_inicio")
        return v

    @validator("tipo_planilha")
    def validate_tipo_planilha(cls, v):
        if v is None:
            return v
        if v not in TIPOS_PLANILHA_LEGADO:
            raise ValueError(
                f"tipo_planilha deve ser um dos seguintes: {', '.join(TIPOS_PLANILHA_LEGADO)}"
            )
        return v

    @validator("template_id")
    def validate_template_requires_tipo(cls, value, values):
        if value is not None and not values.get("tipo_planilha"):
            raise ValueError("template_id só pode ser usado junto com tipo_planilha")
        return value

    class Config:
        extra = "forbid"

class SolicitacaoSaidaOut(BaseModel):
    id: str
    solicitacao_id: str
    tipo: str
    template_id: Optional[int]
    arquivo_path: Optional[str]
    total_notas: int
    total_valor_devido: Decimal
    aviso: Optional[str]
    criado_em: datetime

    @validator("id", "solicitacao_id", pre=True)
    def ensure_str_uuid(cls, v):
        return str(v) if v is not None else v

    @validator("arquivo_path", pre=True)
    def hide_internal_path(cls, value):
        return os.path.basename(str(value).replace("\\", "/")) if value else value

    class Config:
        orm_mode = True

class SolicitacaoOut(BaseModel):
    id: str
    empresa_id: int
    usuario_id: Optional[str] = None
    periodo_inicio: date
    periodo_fim: date
    tipo_planilha: str
    template_id: Optional[int]
    status: str
    mensagem_erro: Optional[str]
    arquivo_saida_path: Optional[str]
    total_notas_processadas: int
    notas_ignoradas: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    itens_excluidos: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    avisos_avaliacao: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    cfops_sem_regra: Optional[Dict[str, int]] = Field(default_factory=dict)
    criado_em: datetime
    atualizado_em: datetime
    notas_processadas: Optional[List[NotaFiscalProcessadaOut]] = Field(default_factory=list)
    saidas: Optional[List[SolicitacaoSaidaOut]] = Field(default_factory=list)

    @validator("id", "usuario_id", pre=True)
    def ensure_str_uuid(cls, v):
        return str(v) if v is not None else v

    @validator("arquivo_saida_path", pre=True)
    def hide_internal_path(cls, value):
        return os.path.basename(str(value).replace("\\", "/")) if value else value

    class Config:
        orm_mode = True


class SolicitacaoListOut(BaseModel):
    id: str
    empresa_id: int
    usuario_id: Optional[str] = None
    periodo_inicio: date
    periodo_fim: date
    tipo_planilha: str
    template_id: Optional[int]
    status: str
    mensagem_erro: Optional[str]
    total_notas_processadas: int
    criado_em: datetime
    atualizado_em: datetime

    @validator("id", "usuario_id", pre=True)
    def ensure_str_uuid(cls, value):
        return str(value) if value is not None else value

    class Config:
        orm_mode = True
