"""Alíquotas reduzidas: termo de acordo por empresa e redução por produto.

Revision ID: 010_aliquotas_reduzidas
Revises: 009_integrity_constraints
Create Date: 2026-09-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010_aliquotas_reduzidas"
down_revision: Union[str, None] = "009_integrity_constraints"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regras_reducao_produto",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("perfil_regras_id", sa.Integer(), nullable=False),
        sa.Column("ncm", sa.String(length=8), nullable=False),
        sa.Column("termos_inclusao", sa.JSON(), nullable=False),
        sa.Column("termos_exclusao", sa.JSON(), nullable=False),
        sa.Column("aliquota", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("vigencia_inicio", sa.Date(), nullable=True),
        sa.Column("vigencia_fim", sa.Date(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["perfil_regras_id"], ["perfis_regras.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_reducao_aliquota_intervalo"),
    )
    op.create_index("ix_regras_reducao_produto_id", "regras_reducao_produto", ["id"])
    op.create_index("ix_regras_reducao_produto_ncm", "regras_reducao_produto", ["ncm"])
    op.create_index(
        "ix_regras_reducao_produto_perfil_regras_id", "regras_reducao_produto", ["perfil_regras_id"]
    )
    op.create_index("ix_reducao_perfil_ncm", "regras_reducao_produto", ["perfil_regras_id", "ncm"])

    op.create_table(
        "excecoes_reducao_produto",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("regra_reducao_id", sa.Integer(), nullable=False),
        sa.Column("descricao_exata", sa.String(length=255), nullable=False),
        sa.Column("enquadrado", sa.Boolean(), nullable=False),
        sa.Column("observacao", sa.String(length=255), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["regra_reducao_id"], ["regras_reducao_produto.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("regra_reducao_id", "descricao_exata", name="uq_excecao_regra_descricao"),
    )
    op.create_index("ix_excecoes_reducao_produto_id", "excecoes_reducao_produto", ["id"])
    op.create_index(
        "ix_excecoes_reducao_produto_regra_reducao_id", "excecoes_reducao_produto", ["regra_reducao_id"]
    )

    op.create_table(
        "regras_aliquotas_empresa",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("empresa_id", sa.Integer(), nullable=False),
        sa.Column("aliquota", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("vigencia_inicio", sa.Date(), nullable=True),
        sa.Column("vigencia_fim", sa.Date(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["empresa_id"], ["empresas.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("empresa_id", name="uq_termo_acordo_empresa"),
        sa.CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_aliquota_empresa_intervalo"),
    )
    op.create_index("ix_regras_aliquotas_empresa_id", "regras_aliquotas_empresa", ["id"])
    op.create_index(
        "ix_regras_aliquotas_empresa_empresa_id", "regras_aliquotas_empresa", ["empresa_id"]
    )


def downgrade() -> None:
    op.drop_table("regras_aliquotas_empresa")
    op.drop_table("excecoes_reducao_produto")
    op.drop_table("regras_reducao_produto")
