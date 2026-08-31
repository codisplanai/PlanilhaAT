import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base

class RegraCfopDestino(Base):
    __tablename__ = "regras_cfop_destino"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=True, index=True)  # Null = padrão global do sistema
    cfop_sufixo = Column(String(3), nullable=False, index=True)  # 3 últimos dígitos do CFOP (ex: 102, 405, 556)
    destino = Column(String(30), nullable=False)  # antecipacao_parcial | antecipacao_tributaria | difal | ignorar
    descricao = Column(String(255), nullable=True)
    criado_em = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    atualizado_em = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_cfop")

    __table_args__ = (
        UniqueConstraint('perfil_regras_id', 'cfop_sufixo', name='uq_perfil_cfop_sufixo'),
    )
