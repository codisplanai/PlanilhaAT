from sqlalchemy import CheckConstraint, Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric
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
    optante_simples_nacional = Column(Boolean, default=False, nullable=False)
    # Acordo com a SEFAZ: A.ORI usada em toda a Antecipação Parcial no lugar da
    # alíquota do XML/SPED. Nula mantém a alíquota do documento fiscal.
    a_ori_fixa_parcial = Column(Numeric(6, 4), nullable=True)
    ativo = Column(Boolean, default=True, nullable=False)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="empresas")
    solicitacoes = relationship("Solicitacao", back_populates="empresa", passive_deletes=True)
    regras_aliquotas_empresa = relationship(
        "RegraAliquotaEmpresa", back_populates="empresa", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "a_ori_fixa_parcial IS NULL OR (a_ori_fixa_parcial >= 0 AND a_ori_fixa_parcial <= 1)",
            name="ck_empresa_a_ori_fixa_parcial_intervalo",
        ),
    )

    @property
    def termo_acordo(self):
        """O termo de acordo vigente, ou None.

        A relação é lista (preparada para o histórico por vigência), mas hoje o
        índice único em empresa_id garante no máximo um.
        """
        return self.regras_aliquotas_empresa[0] if self.regras_aliquotas_empresa else None

