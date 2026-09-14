"""Adiciona campo optante_simples_nacional na tabela empresas

Revision ID: 012_empresa_simples_nacional
Revises: 011_reclassificacao_cfop
Create Date: 2026-09-14 10:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '012_empresa_simples_nacional'
down_revision: Union[str, None] = '011_reclassificacao_cfop'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('empresas') as batch_op:
        batch_op.add_column(
            sa.Column(
                'optante_simples_nacional',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('false')
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('empresas') as batch_op:
        batch_op.drop_column('optante_simples_nacional')
