"""Add data_entrada and origem_data_entrada to notas_fiscais_processadas

Revision ID: 002_data_entrada
Revises: 001_initial_schema
Create Date: 2026-08-17 17:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '002_data_entrada'
down_revision: Union[str, None] = '001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('notas_fiscais_processadas', sa.Column('data_entrada', sa.Date(), nullable=True))
    op.add_column('notas_fiscais_processadas', sa.Column('origem_data_entrada', sa.String(length=50), nullable=True))

def downgrade() -> None:
    op.drop_column('notas_fiscais_processadas', 'origem_data_entrada')
    op.drop_column('notas_fiscais_processadas', 'data_entrada')
