"""Adiciona a A.ORI fixa da Antecipação Parcial por empresa (acordo com a SEFAZ).

Revision ID: 019_a_ori_fixa_parcial
Revises: 018_convenio_52_91
Create Date: 2026-09-30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019_a_ori_fixa_parcial"
down_revision: Union[str, None] = "018_convenio_52_91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMN = "a_ori_fixa_parcial"
CHECK_NAME = "ck_empresa_a_ori_fixa_parcial_intervalo"


def _columns(bind) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns("empresas")}


def upgrade() -> None:
    bind = op.get_bind()
    if "empresas" not in sa.inspect(bind).get_table_names():
        return

    if COLUMN not in _columns(bind):
        with op.batch_alter_table("empresas") as batch_op:
            batch_op.add_column(sa.Column(COLUMN, sa.Numeric(precision=6, scale=4), nullable=True))
            batch_op.create_check_constraint(
                CHECK_NAME,
                f"{COLUMN} IS NULL OR ({COLUMN} >= 0 AND {COLUMN} <= 1)",
            )


def downgrade() -> None:
    bind = op.get_bind()
    if "empresas" not in sa.inspect(bind).get_table_names():
        return

    if COLUMN in _columns(bind):
        with op.batch_alter_table("empresas") as batch_op:
            batch_op.drop_constraint(CHECK_NAME, type_="check")
            batch_op.drop_column(COLUMN)
