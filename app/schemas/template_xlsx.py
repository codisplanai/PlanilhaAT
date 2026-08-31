from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, validator

class TemplateMapping(BaseModel):
    start_row: int = Field(..., example=5, description="Linha onde começa o preenchimento dos dados")
    columns: Dict[str, str] = Field(
        ...,
        example={
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        },
        description="Mapeamento de campo para letra da coluna (ex: A, B, C...)"
    )
    sheet_name: Optional[str] = Field(None, description="Nome da aba. Se nulo, usa a aba ativa")
    extra_options: Dict[str, Any] = Field(default_factory=dict)

    @validator("start_row")
    def validate_start_row(cls, v):
        if v < 1:
            raise ValueError("start_row deve ser maior ou igual a 1")
        return v

    @validator("columns")
    def validate_columns(cls, v):
        for field, col in v.items():
            if not col.isalpha():
                raise ValueError(f"Coluna '{col}' para o campo '{field}' deve ser uma letra válida (ex: A, B, AA)")
            v[field] = col.upper()
        return v

class TemplateXlsxBase(BaseModel):
    tipo: str = Field(..., example="antecipacao_parcial", description="antecipacao_parcial, antecipacao_tributaria ou difal")
    versao: int = Field(..., example=1)
    mapeamento_campos: TemplateMapping
    ativo: bool = False
    observacoes: Optional[str] = None

class TemplateXlsxCreate(TemplateXlsxBase):
    arquivo_path: str
    arquivo_hash: str

class TemplateXlsxUpdate(BaseModel):
    ativo: Optional[bool] = None
    observacoes: Optional[str] = None
    mapeamento_campos: Optional[TemplateMapping] = None

class TemplateXlsxOut(BaseModel):
    id: int
    tipo: str
    versao: int
    arquivo_path: str
    arquivo_hash: str
    mapeamento_campos: Dict[str, Any]
    ativo: bool
    observacoes: Optional[str]
    criado_em: datetime

    class Config:
        orm_mode = True
