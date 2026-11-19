from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
    true,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraFcpProduto(Base):
    """Regra de FCP (Fundo de Combate à Pobreza) por UF, NCM e termos da descrição."""

    __tablename__ = "regras_fcp_produto"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(
        Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uf = Column(String(2), default="BA", server_default="BA", nullable=False)
    ncm = Column(String(8), nullable=False, index=True)
    termos_inclusao = Column(JSON, default=list, nullable=False)
    termos_exclusao = Column(JSON, default=list, nullable=False)
    aliquota = Column(Numeric(6, 4), nullable=False)
    aplicar_com_termo_acordo = Column(
        Boolean, default=True, server_default=true(), nullable=False
    )
    descricao = Column(String(255), nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(
        DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False
    )

    perfil_regras = relationship("PerfilRegras", back_populates="regras_fcp_produto")
    excecoes = relationship(
        "ExcecaoFcpProduto", back_populates="regra", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_fcp_perfil_uf_ncm", "perfil_regras_id", "uf", "ncm"),
        CheckConstraint("aliquota > 0 AND aliquota <= 1", name="ck_fcp_aliquota_intervalo"),
        CheckConstraint("uf = upper(uf) AND length(uf) = 2", name="ck_fcp_uf"),
    )


class ExcecaoFcpProduto(Base):
    """Exceção por descrição exata vinculada a uma regra de FCP por produto."""

    __tablename__ = "excecoes_fcp_produto"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    regra_fcp_id = Column(
        Integer,
        ForeignKey("regras_fcp_produto.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    descricao_exata = Column(String(255), nullable=False)
    enquadrado = Column(Boolean, nullable=False)
    observacao = Column(String(255), nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(
        DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False
    )

    regra = relationship("RegraFcpProduto", back_populates="excecoes")

    __table_args__ = (
        UniqueConstraint(
            "regra_fcp_id", "descricao_exata", name="uq_excecao_fcp_regra_descricao"
        ),
    )
