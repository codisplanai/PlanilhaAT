"""Add uf_emitente and uf_destinatario to notas_fiscais_processadas

Revision ID: 004_uf_notas
Revises: 003_notas_ignoradas
Create Date: 2026-08-18 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '004_uf_notas'
down_revision: Union[str, None] = '003_notas_ignoradas'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('notas_fiscais_processadas', sa.Column('uf_emitente', sa.String(length=2), nullable=True))
    op.add_column('notas_fiscais_processadas', sa.Column('uf_destinatario', sa.String(length=2), nullable=True))

def downgrade() -> None:
    op.drop_column('notas_fiscais_processadas', 'uf_destinatario')
    op.drop_column('notas_fiscais_processadas', 'uf_emitente')
