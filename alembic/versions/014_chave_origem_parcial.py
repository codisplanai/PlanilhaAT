"""Adiciona chave_origem e indice em regras_exclusao_parcial.

Revision ID: 014_chave_origem_parcial
Revises: 013_exclusoes_parcial
Create Date: 2026-09-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "014_chave_origem_parcial"
down_revision: Union[str, None] = "013_exclusoes_parcial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "regras_exclusao_parcial" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("regras_exclusao_parcial")]
        if "chave_origem" not in columns:
            with op.batch_alter_table("regras_exclusao_parcial") as batch_op:
                batch_op.add_column(sa.Column("chave_origem", sa.String(length=50), nullable=True))

        indexes = [i["name"] for i in inspector.get_indexes("regras_exclusao_parcial")]
        if "ix_regras_exclusao_parcial_chave_origem" not in indexes:
            op.create_index(
                "ix_regras_exclusao_parcial_chave_origem",
                "regras_exclusao_parcial",
                ["chave_origem"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "regras_exclusao_parcial" in inspector.get_table_names():
        indexes = [i["name"] for i in inspector.get_indexes("regras_exclusao_parcial")]
        if "ix_regras_exclusao_parcial_chave_origem" in indexes:
            op.drop_index("ix_regras_exclusao_parcial_chave_origem", table_name="regras_exclusao_parcial")

        columns = [c["name"] for c in inspector.get_columns("regras_exclusao_parcial")]
        if "chave_origem" in columns:
            with op.batch_alter_table("regras_exclusao_parcial") as batch_op:
                batch_op.drop_column("chave_origem")
