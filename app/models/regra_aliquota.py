import datetime
from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base

class RegraAliquotaDestino(Base):
    __tablename__ = "regras_aliquotas_destino"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=False, index=True)
    uf = Column(String(2), nullable=False, index=True)
    ncm = Column(String(8), nullable=True, index=True)  # Null = regra padrão da UF
    aliquota = Column(Numeric(6, 4), nullable=False)    # Ex: 0.1800 para 18%
    descricao = Column(String(255), nullable=True)
    parametros_extras = Column(JSON, default=dict, nullable=False) # chave-valor extensível
    criado_em = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    atualizado_em = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_aliquotas")

    __table_args__ = (
        # Constraint de unicidade para evitar duplicar regra no mesmo perfil para mesma UF e NCM
        UniqueConstraint('perfil_regras_id', 'uf', 'ncm', name='uq_perfil_uf_ncm'),
    )
