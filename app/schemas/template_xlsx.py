import re
from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, validator
from openpyxl.utils import column_index_from_string

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
    header_cell: Optional[str] = Field(None, description="Célula que recebe o cabeçalho da empresa")
    aliquota_format: Optional[str] = Field(None, description="decimal ou percent_number")
    extra_options: Dict[str, Any] = Field(default_factory=dict)

    @validator("start_row")
    def validate_start_row(cls, v):
        if v < 1:
            raise ValueError("start_row deve ser maior ou igual a 1")
        return v

    @validator("columns")
    def validate_columns(cls, v):
        if not v:
            raise ValueError("O mapeamento deve declarar ao menos uma coluna")
        for field, col in v.items():
            if not isinstance(col, str) or not col.isalpha():
                raise ValueError(f"Coluna '{col}' para o campo '{field}' deve ser uma letra válida (ex: A, B, AA)")
            normalized = col.upper()
            try:
                column_index_from_string(normalized)
            except ValueError as exc:
                raise ValueError(f"Coluna '{col}' está fora do limite do Excel") from exc
            v[field] = normalized
        return v

    @validator("header_cell")
    def validate_header_cell(cls, value):
        if value is not None and not re.fullmatch(r"[A-Za-z]{1,3}[1-9]\d*", value.strip()):
            raise ValueError("header_cell deve ser uma referência Excel válida, como A2")
        return value.upper() if value else value

    @validator("aliquota_format")
    def validate_percentage_format(cls, value):
        if value is not None and value not in {"decimal", "percent_number"}:
            raise ValueError("aliquota_format deve ser decimal ou percent_number")
        return value

    class Config:
        extra = "forbid"

class TemplateXlsxBase(BaseModel):
    tipo: str = Field(..., example="antecipacao_parcial", description="antecipacao_parcial, antecipacao_tributaria ou difal")
    versao: int = Field(..., example=1)
    capacidade_linhas: Optional[int] = Field(
        None,
        ge=1,
        description="Quantidade máxima de linhas de dados suportada pelo modelo. Nulo apenas para modelos legados.",
    )
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
    capacidade_linhas: Optional[int] = None
    arquivo_path: str
    arquivo_hash: str
    mapeamento_campos: Dict[str, Any]
    ativo: bool
    observacoes: Optional[str]
    criado_em: datetime

    @validator("arquivo_path", pre=True)
    def hide_internal_path(cls, value):
        import os
        return os.path.basename(str(value).replace("\\", "/"))

    class Config:
        orm_mode = True
