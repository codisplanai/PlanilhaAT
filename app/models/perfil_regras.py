import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base

class PerfilRegras(Base):
    __tablename__ = "perfis_regras"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nome = Column(String(100), unique=True, nullable=False, index=True)
    descricao = Column(Text, nullable=True)
    configuracoes_extras = Column(JSON, default=dict, nullable=False)
    criado_em = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    atualizado_em = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    empresas = relationship("Empresa", back_populates="perfil_regras", cascade="all, delete-orphan")
    regras_aliquotas = relationship("RegraAliquotaDestino", back_populates="perfil_regras", cascade="all, delete-orphan")
    regras_cfop = relationship("RegraCfopDestino", back_populates="perfil_regras", cascade="all, delete-orphan")
