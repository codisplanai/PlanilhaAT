from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON, UniqueConstraint, Index, LargeBinary
from sqlalchemy.orm import relationship, deferred

from app.core.database import Base
from app.core.time import utcnow_naive

class TemplateXlsx(Base):
    __tablename__ = "templates_xlsx"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tipo = Column(String(50), nullable=False, index=True)  # antecipacao_parcial, antecipacao_tributaria, difal
    versao = Column(Integer, nullable=False)               # 1, 2, 3...
    arquivo_path = Column(String(500), nullable=False)
    arquivo_hash = Column(String(64), nullable=False)      # SHA256 do arquivo original
    arquivo_blob = deferred(Column(LargeBinary, nullable=True))  # Bytes originais persistidos para runtimes efêmeros
    mapeamento_campos = Column(JSON, nullable=False)       # Mapeamento obrigatório declarado de linhas/colunas
    ativo = Column(Boolean, default=False, nullable=False) # Apenas 1 ativo por tipo
    observacoes = Column(Text, nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)

    solicitacoes = relationship("Solicitacao", back_populates="template")

    __table_args__ = (
        UniqueConstraint('tipo', 'versao', name='uq_tipo_versao'),
        Index(
            'uq_template_ativo_por_tipo',
            'tipo',
            unique=True,
            postgresql_where=(ativo.is_(True)),
            sqlite_where=(ativo.is_(True)),
        ),
    )
