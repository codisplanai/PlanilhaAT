"""Add notas_ignoradas to solicitacoes

Revision ID: 003_notas_ignoradas
Revises: 002_data_entrada
Create Date: 2026-08-17 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '003_notas_ignoradas'
down_revision: Union[str, None] = '002_data_entrada'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('solicitacoes', sa.Column('notas_ignoradas', sa.JSON(), nullable=False, server_default='[]'))

def downgrade() -> None:
    op.drop_column('solicitacoes', 'notas_ignoradas')
