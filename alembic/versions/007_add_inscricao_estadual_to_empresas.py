"""Adiciona campo inscricao_estadual na tabela empresas

Revision ID: 007_add_ie_empresas
Revises: 006_parcial_antecipado
Create Date: 2026-08-21 10:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '007_add_ie_empresas'
down_revision: Union[str, None] = '006_parcial_antecipado'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('empresas') as batch_op:
        batch_op.add_column(
            sa.Column('inscricao_estadual', sa.String(length=30), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table('empresas') as batch_op:
        batch_op.drop_column('inscricao_estadual')
