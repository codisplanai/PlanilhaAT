from sqlalchemy import CheckConstraint, Column, String, Boolean, DateTime
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive

class Profile(Base):
    __tablename__ = "profiles"

    id = Column(String(36), primary_key=True)  # Supabase Auth UUID
    email = Column(String(255), unique=True, nullable=False, index=True)
    nome = Column(String(255), nullable=False)
    cargo = Column(String(100), default="Analista Fiscal", nullable=False)
    role = Column(String(50), default="operador", nullable=False)  # 'admin' ou 'operador'
    ativo = Column(Boolean, default=True, nullable=False)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    solicitacoes = relationship("Solicitacao", back_populates="usuario")

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'operador')", name="ck_profiles_role"),
    )
