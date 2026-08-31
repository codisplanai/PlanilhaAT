import datetime
import uuid
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base

class SolicitacaoSaida(Base):
    __tablename__ = "solicitacoes_saidas"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    solicitacao_id = Column(String(36), ForeignKey("solicitacoes.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = Column(String(50), nullable=False)  # antecipacao_parcial, antecipacao_tributaria, difal
    template_id = Column(Integer, ForeignKey("templates_xlsx.id", ondelete="RESTRICT"), nullable=True)
    arquivo_path = Column(String(500), nullable=True)
    total_notas = Column(Integer, default=0, nullable=False)
    total_valor_devido = Column(Numeric(15, 2), default=0, nullable=False)
    aviso = Column(Text, nullable=True)  # Preenchido quando não havia template ativo para o tipo
    criado_em = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    solicitacao = relationship("Solicitacao", back_populates="saidas")
    template = relationship("TemplateXlsx")

    __table_args__ = (
        UniqueConstraint('solicitacao_id', 'tipo', name='uq_solicitacao_tipo'),
    )
