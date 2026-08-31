"""Adiciona tabela profiles e campo usuario_id em solicitacoes

Revision ID: 008_profiles_user_ownership
Revises: 007_add_ie_empresas
Create Date: 2026-08-31 11:00:00.000000

"""
from typing import Sequence, Union
import datetime
from alembic import op
import sqlalchemy as sa

revision: str = '008_profiles_user_ownership'
down_revision: Union[str, None] = '007_add_ie_empresas'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Cria tabela profiles se não existir
    if 'profiles' not in tables:
        op.create_table(
            'profiles',
            sa.Column('id', sa.String(length=36), primary_key=True),
            sa.Column('email', sa.String(length=255), nullable=False, unique=True),
            sa.Column('nome', sa.String(length=255), nullable=False),
            sa.Column('cargo', sa.String(length=100), server_default='Analista Fiscal', nullable=False),
            sa.Column('role', sa.String(length=50), server_default='operador', nullable=False),
            sa.Column('ativo', sa.Boolean(), server_default=sa.text('1'), nullable=False),
            sa.Column('criado_em', sa.DateTime(), default=datetime.datetime.utcnow, nullable=False),
            sa.Column('atualizado_em', sa.DateTime(), default=datetime.datetime.utcnow, nullable=False),
        )
        op.create_index('ix_profiles_email', 'profiles', ['email'], unique=True)

    # 2. Adiciona coluna usuario_id em solicitacoes se não existir
    columns = [c['name'] for c in inspector.get_columns('solicitacoes')]
    if 'usuario_id' not in columns:
        with op.batch_alter_table('solicitacoes') as batch_op:
            batch_op.add_column(
                sa.Column('usuario_id', sa.String(length=36), nullable=True)
            )
            batch_op.create_foreign_key(
                'fk_solicitacoes_usuario_id',
                'profiles',
                ['usuario_id'],
                ['id'],
                ondelete='SET NULL'
            )
            batch_op.create_index('ix_solicitacoes_usuario_id', ['usuario_id'])


def downgrade() -> None:
    with op.batch_alter_table('solicitacoes') as batch_op:
        batch_op.drop_index('ix_solicitacoes_usuario_id')
        batch_op.drop_constraint('fk_solicitacoes_usuario_id', type_='foreignkey')
        batch_op.drop_column('usuario_id')

    op.drop_index('ix_profiles_email', table_name='profiles')
    op.drop_table('profiles')
