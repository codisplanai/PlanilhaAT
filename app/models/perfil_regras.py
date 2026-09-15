from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive

class PerfilRegras(Base):
    __tablename__ = "perfis_regras"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    nome = Column(String(100), unique=True, nullable=False, index=True)
    descricao = Column(Text, nullable=True)
    configuracoes_extras = Column(JSON, default=dict, nullable=False)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    empresas = relationship("Empresa", back_populates="perfil_regras", passive_deletes=True)
    regras_aliquotas = relationship("RegraAliquotaDestino", back_populates="perfil_regras", cascade="all, delete-orphan")
    regras_cfop = relationship("RegraCfopDestino", back_populates="perfil_regras", cascade="all, delete-orphan")
    regras_reducao_produto = relationship(
        "RegraReducaoProduto", back_populates="perfil_regras", cascade="all, delete-orphan"
    )
    regras_reclassificacao_cfop = relationship(
        "RegraReclassificacaoCfop", back_populates="perfil_regras", cascade="all, delete-orphan"
    )
    regras_exclusao_parcial = relationship(
        "RegraExclusaoParcial", back_populates="perfil_regras", cascade="all, delete-orphan"
    )
