from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, String,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraExclusaoParcial(Base):
    """Regra de exclusão de mercadoria da Antecipação Parcial por NCM + todos os termos da descrição.

    O escopo é compartilhado por perfil de regras + UF de destino.
    """

    __tablename__ = "regras_exclusao_parcial"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(
        Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uf = Column(String(2), nullable=False, default="BA", index=True)
    ncm = Column(String(8), nullable=False, index=True)
    descricao = Column(String(255), nullable=True)
    termos_obrigatorios = Column(JSON, default=list, nullable=False)
    motivo = Column(String(50), nullable=False)  # 'isencao' ou 'imposto_pago_entrada'
    ativo = Column(Boolean, default=True, nullable=False)
    chave_origem = Column(String(50), nullable=True, index=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_exclusao_parcial")

    __table_args__ = (
        Index("ix_exclusao_perfil_uf_ncm", "perfil_regras_id", "uf", "ncm"),
        Index("ix_exclusao_perfil_uf", "perfil_regras_id", "uf"),
    )
