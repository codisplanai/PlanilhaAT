from sqlalchemy import CheckConstraint, Column, Integer, String, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive

class RegraCfopDestino(Base):
    __tablename__ = "regras_cfop_destino"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=True, index=True)  # Null = padrão global do sistema
    cfop_sufixo = Column(String(3), nullable=False, index=True)  # 3 últimos dígitos do CFOP (ex: 102, 405, 556)
    destino = Column(String(30), nullable=False)  # antecipacao_parcial | antecipacao_tributaria | difal | ignorar
    descricao = Column(String(255), nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_cfop")

    __table_args__ = (
        Index(
            'uq_perfil_cfop_sufixo_normalizado',
            func.coalesce(perfil_regras_id, 0),
            'cfop_sufixo',
            unique=True,
        ),
        CheckConstraint("length(cfop_sufixo) = 3", name="ck_regra_cfop_sufixo"),
        CheckConstraint(
            "destino IN ('antecipacao_parcial', 'antecipacao_parcial_antecipado', 'antecipacao_tributaria', 'difal', 'ignorar')",
            name="ck_regra_cfop_destino",
        ),
    )
