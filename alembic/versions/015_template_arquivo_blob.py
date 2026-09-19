"""Persiste os bytes originais dos templates XLSX.

Revision ID: 015_template_arquivo_blob
Revises: 014_chave_origem_parcial
Create Date: 2026-09-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "015_template_arquivo_blob"
down_revision: Union[str, None] = "014_chave_origem_parcial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "templates_xlsx" in inspector.get_table_names():
        columns = [column["name"] for column in inspector.get_columns("templates_xlsx")]
        if "arquivo_blob" not in columns:
            with op.batch_alter_table("templates_xlsx") as batch_op:
                batch_op.add_column(sa.Column("arquivo_blob", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "templates_xlsx" in inspector.get_table_names():
        columns = [column["name"] for column in inspector.get_columns("templates_xlsx")]
        if "arquivo_blob" in columns:
            with op.batch_alter_table("templates_xlsx") as batch_op:
                batch_op.drop_column("arquivo_blob")
