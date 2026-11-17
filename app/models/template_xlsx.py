from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    and_,
)
from sqlalchemy.orm import relationship, deferred

from app.core.database import Base
from app.core.time import utcnow_naive


class TemplateXlsx(Base):
    __tablename__ = "templates_xlsx"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    empresa_id = Column(
        Integer,
        ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # NULL = modelo padrão global; preenchido = modelo personalizado da empresa
    tipo = Column(String(50), nullable=False, index=True)  # antecipacao_parcial, antecipacao_tributaria, difal
    versao = Column(Integer, nullable=False)               # 1, 2, 3...
    capacidade_linhas = Column(
        Integer,
        nullable=True,
        index=True,
    )  # NULL identifica apenas modelos legados anteriores ao cadastro por capacidade
    arquivo_path = Column(String(500), nullable=False)
    arquivo_hash = Column(String(64), nullable=False)      # SHA256 do arquivo original
    arquivo_blob = deferred(Column(LargeBinary, nullable=True))  # Bytes originais persistidos para runtimes efêmeros
    mapeamento_campos = Column(JSON, nullable=False)       # Mapeamento obrigatório declarado de linhas/colunas
    ativo = Column(Boolean, default=False, nullable=False) # 1 ativo por escopo + tipo + capacidade
    observacoes = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)

    empresa = relationship("Empresa")
    solicitacoes = relationship("Solicitacao", back_populates="template")

    __table_args__ = (
        Index(
            "uq_template_versao_global",
            "tipo",
            "versao",
            unique=True,
            postgresql_where=empresa_id.is_(None),
            sqlite_where=empresa_id.is_(None),
        ),
        Index(
            "uq_template_versao_empresa",
            "empresa_id",
            "tipo",
            "versao",
            unique=True,
            postgresql_where=empresa_id.is_not(None),
            sqlite_where=empresa_id.is_not(None),
        ),
        CheckConstraint(
            "capacidade_linhas IS NULL OR capacidade_linhas > 0",
            name="ck_template_capacidade_linhas_positiva",
        ),
        Index(
            "uq_template_ativo_tipo_capacidade",
            "tipo",
            "capacidade_linhas",
            unique=True,
            postgresql_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_not(None),
                empresa_id.is_(None),
            ),
            sqlite_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_not(None),
                empresa_id.is_(None),
            ),
        ),
        Index(
            "uq_template_ativo_tipo_legado",
            "tipo",
            unique=True,
            postgresql_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_(None),
                empresa_id.is_(None),
            ),
            sqlite_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_(None),
                empresa_id.is_(None),
            ),
        ),
        Index(
            "uq_template_ativo_empresa_tipo_capacidade",
            "empresa_id",
            "tipo",
            "capacidade_linhas",
            unique=True,
            postgresql_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_not(None),
                empresa_id.is_not(None),
            ),
            sqlite_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_not(None),
                empresa_id.is_not(None),
            ),
        ),
        Index(
            "uq_template_ativo_empresa_tipo_legado",
            "empresa_id",
            "tipo",
            unique=True,
            postgresql_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_(None),
                empresa_id.is_not(None),
            ),
            sqlite_where=and_(
                ativo.is_(True),
                capacidade_linhas.is_(None),
                empresa_id.is_not(None),
            ),
        ),
    )
