from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, Numeric, String,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraAliquotaEmpresa(Base):
    """Termo de acordo / regime especial: A.DST própria da empresa (nível 2).

    Sem coluna ``uf``: o escopo já é uma empresa, que tem uma UF só em
    ``empresas.uf``. Repetir criaria fonte de divergência.
    """

    __tablename__ = "regras_aliquotas_empresa"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # Único: uma empresa tem no máximo um termo de acordo. Ligar vigência no
    # futuro troca esta restrição por (empresa_id, vigencia_inicio).
    empresa_id = Column(
        Integer, ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    aliquota = Column(Numeric(6, 4), nullable=False)
    descricao = Column(String(255), nullable=True)
    vigencia_inicio = Column(Date, nullable=True)
    vigencia_fim = Column(Date, nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    empresa = relationship("Empresa", back_populates="regras_aliquotas_empresa")

    __table_args__ = (
        CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_aliquota_empresa_intervalo"),
    )
