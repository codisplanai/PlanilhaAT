"""Alarga destino_planilha para comportar o tipo antecipacao_parcial_antecipado

A string 'antecipacao_parcial_antecipado' tem exatamente 30 caracteres, o mesmo
limite da coluna original — cabe sem folga no SQLite (que não impõe o limite) e
quebra no PostgreSQL. Alarga para 50, igualando solicitacoes_saidas.tipo.

Revision ID: 006_parcial_antecipado
Revises: 005_cfop_routing
Create Date: 2026-08-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '006_parcial_antecipado'
down_revision: Union[str, None] = '005_cfop_routing'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table é obrigatório: o SQLite não suporta ALTER COLUMN nativo
    with op.batch_alter_table('notas_fiscais_processadas') as batch_op:
        batch_op.alter_column(
            'destino_planilha',
            existing_type=sa.String(length=30),
            type_=sa.String(length=50),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table('notas_fiscais_processadas') as batch_op:
        batch_op.alter_column(
            'destino_planilha',
            existing_type=sa.String(length=50),
            type_=sa.String(length=30),
            existing_nullable=True,
        )
