from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive

class Empresa(Base):
    __tablename__ = "empresas"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    razao_social = Column(String(255), nullable=False)
    cnpj = Column(String(14), unique=True, nullable=False, index=True)
    inscricao_estadual = Column(String(30), nullable=True)
    uf = Column(String(2), nullable=False)
    perfil_regras_id = Column(Integer, ForeignKey("perfis_regras.id", ondelete="RESTRICT"), nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="empresas")
    solicitacoes = relationship("Solicitacao", back_populates="empresa", passive_deletes=True)
