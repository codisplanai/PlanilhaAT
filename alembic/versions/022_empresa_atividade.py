"""Adiciona a atividade da empresa (comercio/industria).

A indústria não recolhe Antecipação Parcial nem Tributária: gera apenas DIFAL
de uso/consumo e ativo imobilizado. Empresas existentes ficam como comércio.

Revision ID: 022_empresa_atividade
Revises: 021_valor_pago_st
Create Date: 2026-11-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "022_empresa_atividade"
down_revision: Union[str, None] = "021_valor_pago_st"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMN = "atividade"
CHECK_NAME = "ck_empresa_atividade"


def _columns(bind) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns("empresas")}


def upgrade() -> None:
    bind = op.get_bind()
    if "empresas" not in sa.inspect(bind).get_table_names():
        return

    if COLUMN not in _columns(bind):
        with op.batch_alter_table("empresas") as batch_op:
            batch_op.add_column(
                sa.Column(COLUMN, sa.String(length=20), nullable=False, server_default="comercio")
            )
            batch_op.create_check_constraint(CHECK_NAME, f"{COLUMN} IN ('comercio', 'industria')")


def downgrade() -> None:
    bind = op.get_bind()
    if "empresas" not in sa.inspect(bind).get_table_names():
        return

    if COLUMN in _columns(bind):
        with op.batch_alter_table("empresas") as batch_op:
            batch_op.drop_constraint(CHECK_NAME, type_="check")
            batch_op.drop_column(COLUMN)
