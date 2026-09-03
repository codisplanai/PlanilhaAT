from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index,
    Integer, JSON, Numeric, String, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraReducaoProduto(Base):
    """Redução de alíquota condicionada a NCM + descrição do produto (nível 1).

    A lista vem de documento oficial do estado, então o escopo é o perfil de
    regras — é a mesma para todos os contribuintes daquele perfil.
    """

    __tablename__ = "regras_reducao_produto"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(
        Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ncm = Column(String(8), nullable=False, index=True)
    termos_inclusao = Column(JSON, default=list, nullable=False)
    termos_exclusao = Column(JSON, default=list, nullable=False)
    aliquota = Column(Numeric(6, 4), nullable=False)
    descricao = Column(String(255), nullable=True)
    # Reservados: existem no schema para que ligar vigência depois não exija
    # migração de dados. Não expostos em schema Pydantic, endpoint nem tela.
    vigencia_inicio = Column(Date, nullable=True)
    vigencia_fim = Column(Date, nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_reducao_produto")
    excecoes = relationship(
        "ExcecaoReducaoProduto", back_populates="regra", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Sem índice único em (perfil, ncm): o mesmo NCM comporta várias regras
        # com termos diferentes. Duplicata literal é validada na camada de API.
        Index("ix_reducao_perfil_ncm", "perfil_regras_id", "ncm"),
        CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_reducao_aliquota_intervalo"),
    )


class ExcecaoReducaoProduto(Base):
    """Carimbo manual sobre uma descrição exata, avaliado antes dos termos.

    Serve nos dois sentidos: ``enquadrado=False`` para o item que casa os termos
    mas não se enquadra ("VERGALHAO DE COBRE"), e ``enquadrado=True`` para o que
    se enquadra mas nenhum termo razoável pegaria ("VG CA50 10.0").
    """

    __tablename__ = "excecoes_reducao_produto"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    regra_reducao_id = Column(
        Integer, ForeignKey("regras_reducao_produto.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    descricao_exata = Column(String(255), nullable=False)
    enquadrado = Column(Boolean, nullable=False)
    observacao = Column(String(255), nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    regra = relationship("RegraReducaoProduto", back_populates="excecoes")

    __table_args__ = (
        UniqueConstraint("regra_reducao_id", "descricao_exata", name="uq_excecao_regra_descricao"),
    )
