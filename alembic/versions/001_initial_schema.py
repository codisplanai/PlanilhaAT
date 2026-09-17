"""Initial schema migration

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-08-14 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Perfis de Regras
    op.create_table(
        'perfis_regras',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('nome', sa.String(length=100), nullable=False, unique=True),
        sa.Column('descricao', sa.Text(), nullable=True),
        sa.Column('configuracoes_extras', sa.JSON(), nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.Column('atualizado_em', sa.DateTime(), nullable=False)
    )

    # 2. Empresas
    op.create_table(
        'empresas',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('razao_social', sa.String(length=255), nullable=False),
        sa.Column('cnpj', sa.String(length=14), nullable=False, unique=True),
        sa.Column('uf', sa.String(length=2), nullable=False),
        sa.Column('perfil_regras_id', sa.Integer(), sa.ForeignKey('perfis_regras.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('ativo', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.Column('atualizado_em', sa.DateTime(), nullable=False)
    )

    # 3. Regras de Alíquotas de Destino
    op.create_table(
        'regras_aliquotas_destino',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('perfil_regras_id', sa.Integer(), sa.ForeignKey('perfis_regras.id', ondelete='CASCADE'), nullable=False),
        sa.Column('uf', sa.String(length=2), nullable=False),
        sa.Column('ncm', sa.String(length=8), nullable=True),
        sa.Column('aliquota', sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column('descricao', sa.String(length=255), nullable=True),
        sa.Column('parametros_extras', sa.JSON(), nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.Column('atualizado_em', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('perfil_regras_id', 'uf', 'ncm', name='uq_perfil_uf_ncm')
    )

    # 4. Templates XLSX
    op.create_table(
        'templates_xlsx',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tipo', sa.String(length=50), nullable=False),
        sa.Column('versao', sa.Integer(), nullable=False),
        sa.Column('arquivo_path', sa.String(length=500), nullable=False),
        sa.Column('arquivo_hash', sa.String(length=64), nullable=False),
        sa.Column('mapeamento_campos', sa.JSON(), nullable=False),
        sa.Column('ativo', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('observacoes', sa.Text(), nullable=True),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('tipo', 'versao', name='uq_tipo_versao')
    )

    # 5. Solicitações
    op.create_table(
        'solicitacoes',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('empresa_id', sa.Integer(), sa.ForeignKey('empresas.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('periodo_inicio', sa.Date(), nullable=False),
        sa.Column('periodo_fim', sa.Date(), nullable=False),
        sa.Column('tipo_planilha', sa.String(length=50), nullable=False),
        sa.Column('template_id', sa.Integer(), sa.ForeignKey('templates_xlsx.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pendente'),
        sa.Column('mensagem_erro', sa.Text(), nullable=True),
        sa.Column('arquivo_saida_path', sa.String(length=500), nullable=True),
        sa.Column('total_notas_processadas', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.Column('atualizado_em', sa.DateTime(), nullable=False)
    )

    # 6. Notas Fiscais Processadas
    op.create_table(
        'notas_fiscais_processadas',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('solicitacao_id', sa.String(length=36), sa.ForeignKey('solicitacoes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chave_acesso', sa.String(length=44), nullable=True),
        sa.Column('numero_nota', sa.String(length=20), nullable=False),
        sa.Column('serie', sa.String(length=10), nullable=True),
        sa.Column('cnpj_emitente', sa.String(length=14), nullable=True),
        sa.Column('cnpj_destinatario', sa.String(length=14), nullable=False),
        sa.Column('data_emissao', sa.DateTime(), nullable=False),
        sa.Column('item_numero', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('ncm', sa.String(length=8), nullable=False),
        sa.Column('cfop', sa.String(length=4), nullable=True),
        sa.Column('v_total', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('base_calculo', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('ipi_despesas', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0.00'),
        sa.Column('a_ori', sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column('a_dst_resolvida', sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column('debito', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('credito', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('valor_devido', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('metadados_extras', sa.JSON(), nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False)
    )

def downgrade() -> None:
    op.drop_table('notas_fiscais_processadas')
    op.drop_table('solicitacoes')
    op.drop_table('templates_xlsx')
    op.drop_table('regras_aliquotas_destino')
    op.drop_table('empresas')
    op.drop_table('perfis_regras')
