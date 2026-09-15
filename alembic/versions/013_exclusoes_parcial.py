"""Exclusões da Parcial: tabela regras_exclusao_parcial e campos de conferência em solicitacoes.

Revision ID: 013_exclusoes_parcial
Revises: 012_empresa_simples_nacional
Create Date: 2026-09-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "013_exclusoes_parcial"
down_revision: Union[str, None] = "012_empresa_simples_nacional"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regras_exclusao_parcial",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("perfil_regras_id", sa.Integer(), nullable=False),
        sa.Column("uf", sa.String(length=2), nullable=False),
        sa.Column("ncm", sa.String(length=8), nullable=False),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("termos_obrigatorios", sa.JSON(), nullable=False),
        sa.Column("motivo", sa.String(length=50), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["perfil_regras_id"], ["perfis_regras.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_regras_exclusao_parcial_id", "regras_exclusao_parcial", ["id"])
    op.create_index("ix_regras_exclusao_parcial_ncm", "regras_exclusao_parcial", ["ncm"])
    op.create_index(
        "ix_regras_exclusao_parcial_perfil_regras_id",
        "regras_exclusao_parcial",
        ["perfil_regras_id"],
    )
    op.create_index("ix_regras_exclusao_parcial_uf", "regras_exclusao_parcial", ["uf"])
    op.create_index(
        "ix_exclusao_perfil_uf_ncm",
        "regras_exclusao_parcial",
        ["perfil_regras_id", "uf", "ncm"],
    )
    op.create_index(
        "ix_exclusao_perfil_uf",
        "regras_exclusao_parcial",
        ["perfil_regras_id", "uf"],
    )

    with op.batch_alter_table("solicitacoes") as batch_op:
        batch_op.add_column(
            sa.Column(
                "itens_excluidos",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            )
        )
        batch_op.add_column(
            sa.Column(
                "avisos_avaliacao",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("solicitacoes") as batch_op:
        batch_op.drop_column("avisos_avaliacao")
        batch_op.drop_column("itens_excluidos")

    op.drop_table("regras_exclusao_parcial")
