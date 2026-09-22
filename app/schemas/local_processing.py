from datetime import date, datetime
from typing import Any, Dict, List, Optional

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


class LocalTermoAcordoOut(BaseModel):
    id: int
    aliquota: float
    descricao: Optional[str] = None


class LocalEmpresaOut(BaseModel):
    id: int
    razao_social: str
    cnpj: str
    inscricao_estadual: Optional[str] = None
    uf: str
    perfil_regras_id: int
    optante_simples_nacional: bool
    termo_acordo: Optional[LocalTermoAcordoOut] = None


class LocalPerfilOut(BaseModel):
    id: int
    nome: str
    descricao: Optional[str] = None
    configuracoes_extras: Dict[str, Any] = Field(default_factory=dict)


class LocalRegraAliquotaOut(BaseModel):
    id: int
    perfil_regras_id: int
    uf: str
    ncm: Optional[str] = None
    aliquota: float
    descricao: Optional[str] = None
    parametros_extras: Dict[str, Any] = Field(default_factory=dict)


class LocalRegraCfopOut(BaseModel):
    id: int
    perfil_regras_id: Optional[int] = None
    cfop_sufixo: str
    destino: str
    descricao: Optional[str] = None


class LocalExcecaoReducaoOut(BaseModel):
    id: int
    descricao_exata: str
    enquadrado: bool
    observacao: Optional[str] = None


class LocalRegraReducaoOut(BaseModel):
    id: int
    perfil_regras_id: int
    ncm: str
    termos_inclusao: List[str] = Field(default_factory=list)
    termos_exclusao: List[str] = Field(default_factory=list)
    aliquota: float
    descricao: Optional[str] = None
    excecoes: List[LocalExcecaoReducaoOut] = Field(default_factory=list)


class LocalExcecaoReclassificacaoOut(BaseModel):
    id: int
    descricao_exata: str
    aplicar: bool
    observacao: Optional[str] = None


class LocalRegraReclassificacaoOut(BaseModel):
    id: int
    perfil_regras_id: int
    ncm: str
    cfop_origem_sufixo: Optional[str] = None
    cfop_destino_sufixo: str
    termos_inclusao: List[str] = Field(default_factory=list)
    termos_exclusao: List[str] = Field(default_factory=list)
    descricao: Optional[str] = None
    excecoes: List[LocalExcecaoReclassificacaoOut] = Field(default_factory=list)


class LocalRegraExclusaoOut(BaseModel):
    id: int
    perfil_regras_id: int
    uf: str
    ncm: str
    descricao: Optional[str] = None
    termos_obrigatorios: List[str] = Field(default_factory=list)
    motivo: str
    ativo: bool


class LocalTemplateMappingOut(BaseModel):
    start_row: int
    columns: Dict[str, str]
    sheet_name: Optional[str] = None
    header_cell: Optional[str] = None
    aliquota_format: Optional[str] = None
    extra_options: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class LocalTemplateDescriptorOut(BaseModel):
    id: int
    tipo: str
    versao: int
    capacidade_linhas: Optional[int] = None
    arquivo_hash: str
    mapeamento_campos: LocalTemplateMappingOut
    observacoes: Optional[str] = None


class LocalMvaAjustadaOut(BaseModel):
    caso: Optional[str] = None
    aliquotas: Dict[str, float] = Field(default_factory=dict)


class LocalMvaOriginalOut(BaseModel):
    caso: Optional[str] = None
    valor: Optional[float] = None


class LocalMvaEntryOut(BaseModel):
    ncm: str
    mva: Optional[float] = None
    mva_ajustada: Optional[List[LocalMvaAjustadaOut]] = None
    mva_original: Optional[List[LocalMvaOriginalOut]] = None
    cest: Optional[List[str]] = None
    descricao: Optional[str] = None


class LocalProcessingContextOut(BaseModel):
    empresa: LocalEmpresaOut
    perfil: LocalPerfilOut
    regras_aliquotas: List[LocalRegraAliquotaOut]
    regras_cfop: List[LocalRegraCfopOut]
    regras_reducao: List[LocalRegraReducaoOut]
    regras_reclassificacao: List[LocalRegraReclassificacaoOut]
    regras_exclusao_parcial: List[LocalRegraExclusaoOut]
    margens_seguranca_templates: Dict[str, int]
    templates_ativos: List[LocalTemplateDescriptorOut]
    mva_anexo: List[LocalMvaEntryOut]
