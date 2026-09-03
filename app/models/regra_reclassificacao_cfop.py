from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraReclassificacaoCfop(Base):
    """Regra que reclassifica o CFOP de um item por NCM e descrição antes do roteamento."""

    __tablename__ = "regras_reclassificacao_cfop"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(
        Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ncm = Column(String(8), nullable=False, index=True)
    cfop_origem_sufixo = Column(String(3), nullable=True, index=True)  # Null = qualquer CFOP
    cfop_destino_sufixo = Column(String(3), nullable=False)
    termos_inclusao = Column(JSON, nullable=True, default=list)
    termos_exclusao = Column(JSON, nullable=True, default=list)
    descricao = Column(String(255), nullable=True)

    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_reclassificacao_cfop")
    excecoes = relationship(
        "ExcecaoReclassificacaoCfop",
        back_populates="regra_reclassificacao",
        cascade="all, delete-orphan",
        order_by="ExcecaoReclassificacaoCfop.descricao_exata",
    )

    __table_args__ = (
        CheckConstraint("length(ncm) = 8", name="ck_reclassificacao_cfop_ncm"),
        CheckConstraint(
            "cfop_origem_sufixo IS NULL OR length(cfop_origem_sufixo) = 3",
            name="ck_reclassificacao_cfop_origem",
        ),
        CheckConstraint(
            "length(cfop_destino_sufixo) = 3",
            name="ck_reclassificacao_cfop_destino",
        ),
    )


class ExcecaoReclassificacaoCfop(Base):
    """Exceção para uma descrição exata de produto dentro de uma regra de reclassificação."""

    __tablename__ = "excecoes_reclassificacao_cfop"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    regra_reclassificacao_id = Column(
        Integer, ForeignKey("regras_reclassificacao_cfop.id", ondelete="CASCADE"), nullable=False, index=True
    )
    descricao_exata = Column(String(255), nullable=False)
    aplicar = Column(Boolean, nullable=False, default=False)
    observacao = Column(String(255), nullable=True)

    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    regra_reclassificacao = relationship("RegraReclassificacaoCfop", back_populates="excecoes")

    __table_args__ = (
        UniqueConstraint(
            "regra_reclassificacao_id",
            "descricao_exata",
            name="uq_excecao_reclassificacao_cfop_desc",
        ),
    )
