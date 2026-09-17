"""Reclassificação de CFOP por NCM e descrição de produto.

Revision ID: 011_reclassificacao_cfop
Revises: 010_aliquotas_reduzidas
Create Date: 2026-09-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "011_reclassificacao_cfop"
down_revision: Union[str, None] = "010_aliquotas_reduzidas"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regras_reclassificacao_cfop",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("perfil_regras_id", sa.Integer(), nullable=False),
        sa.Column("ncm", sa.String(length=8), nullable=False),
        sa.Column("cfop_origem_sufixo", sa.String(length=3), nullable=True),
        sa.Column("cfop_destino_sufixo", sa.String(length=3), nullable=False),
        sa.Column("termos_inclusao", sa.JSON(), nullable=True),
        sa.Column("termos_exclusao", sa.JSON(), nullable=True),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["perfil_regras_id"], ["perfis_regras.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("length(ncm) = 8", name="ck_reclassificacao_cfop_ncm"),
        sa.CheckConstraint(
            "cfop_origem_sufixo IS NULL OR length(cfop_origem_sufixo) = 3",
            name="ck_reclassificacao_cfop_origem",
        ),
        sa.CheckConstraint("length(cfop_destino_sufixo) = 3", name="ck_reclassificacao_cfop_destino"),
    )
    op.create_index("ix_regras_reclassificacao_cfop_id", "regras_reclassificacao_cfop", ["id"])
    op.create_index("ix_regras_reclassificacao_cfop_ncm", "regras_reclassificacao_cfop", ["ncm"])
    op.create_index(
        "ix_regras_reclassificacao_cfop_perfil_regras_id",
        "regras_reclassificacao_cfop",
        ["perfil_regras_id"],
    )
    op.create_index(
        "ix_reclassificacao_perfil_ncm",
        "regras_reclassificacao_cfop",
        ["perfil_regras_id", "ncm"],
    )

    op.create_table(
        "excecoes_reclassificacao_cfop",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("regra_reclassificacao_id", sa.Integer(), nullable=False),
        sa.Column("descricao_exata", sa.String(length=255), nullable=False),
        sa.Column("aplicar", sa.Boolean(), nullable=False),
        sa.Column("observacao", sa.String(length=255), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["regra_reclassificacao_id"],
            ["regras_reclassificacao_cfop.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "regra_reclassificacao_id",
            "descricao_exata",
            name="uq_excecao_reclassificacao_cfop_desc",
        ),
    )
    op.create_index("ix_excecoes_reclassificacao_cfop_id", "excecoes_reclassificacao_cfop", ["id"])
    op.create_index(
        "ix_excecoes_reclassificacao_cfop_regra_id",
        "excecoes_reclassificacao_cfop",
        ["regra_reclassificacao_id"],
    )


def downgrade() -> None:
    op.drop_table("excecoes_reclassificacao_cfop")
    op.drop_table("regras_reclassificacao_cfop")
