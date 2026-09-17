"""Roteamento por CFOP e geração de múltiplas planilhas por solicitação

Cria regras_cfop_destino (mapeamento CFOP -> planilha) e solicitacoes_saidas
(uma linha por planilha gerada em uma solicitação). Adiciona destino_planilha
em notas_fiscais_processadas. Torna solicitacoes.template_id opcional, já que
o novo fluxo padrão gera múltiplos templates por solicitação em vez de um só.

Idempotente: como app.main dispara Base.metadata.create_all no import (inclusive
ao rodar a suíte de testes contra o banco de produção), as tabelas novas podem já
ter sido criadas por fora do Alembic antes desta migração rodar. Cada passo checa
o estado atual do schema antes de agir.

Revision ID: 005_cfop_routing
Revises: 004_uf_notas
Create Date: 2026-08-19 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '005_cfop_routing'
down_revision: Union[str, None] = '004_uf_notas'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # 1. Regras de roteamento CFOP -> planilha
    if 'regras_cfop_destino' not in existing_tables:
        op.create_table(
            'regras_cfop_destino',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('perfil_regras_id', sa.Integer(), sa.ForeignKey('perfis_regras.id', ondelete='CASCADE'), nullable=True),
            sa.Column('cfop_sufixo', sa.String(length=3), nullable=False),
            sa.Column('destino', sa.String(length=30), nullable=False),
            sa.Column('descricao', sa.String(length=255), nullable=True),
            sa.Column('criado_em', sa.DateTime(), nullable=False),
            sa.Column('atualizado_em', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('perfil_regras_id', 'cfop_sufixo', name='uq_perfil_cfop_sufixo')
        )
    existing_indexes = {ix['name'] for ix in inspector.get_indexes('regras_cfop_destino')} if 'regras_cfop_destino' in existing_tables else set()
    if 'ix_regras_cfop_destino_perfil_regras_id' not in existing_indexes:
        op.create_index('ix_regras_cfop_destino_perfil_regras_id', 'regras_cfop_destino', ['perfil_regras_id'])
    if 'ix_regras_cfop_destino_cfop_sufixo' not in existing_indexes:
        op.create_index('ix_regras_cfop_destino_cfop_sufixo', 'regras_cfop_destino', ['cfop_sufixo'])

    # 2. Saídas (planilhas geradas) por solicitação
    if 'solicitacoes_saidas' not in existing_tables:
        op.create_table(
            'solicitacoes_saidas',
            sa.Column('id', sa.String(length=36), primary_key=True),
            sa.Column('solicitacao_id', sa.String(length=36), sa.ForeignKey('solicitacoes.id', ondelete='CASCADE'), nullable=False),
            sa.Column('tipo', sa.String(length=50), nullable=False),
            sa.Column('template_id', sa.Integer(), sa.ForeignKey('templates_xlsx.id', ondelete='RESTRICT'), nullable=True),
            sa.Column('arquivo_path', sa.String(length=500), nullable=True),
            sa.Column('total_notas', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('total_valor_devido', sa.Numeric(precision=15, scale=2), nullable=False, server_default='0'),
            sa.Column('aviso', sa.Text(), nullable=True),
            sa.Column('criado_em', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('solicitacao_id', 'tipo', name='uq_solicitacao_tipo')
        )
    existing_saida_indexes = {ix['name'] for ix in inspector.get_indexes('solicitacoes_saidas')} if 'solicitacoes_saidas' in existing_tables else set()
    if 'ix_solicitacoes_saidas_solicitacao_id' not in existing_saida_indexes:
        op.create_index('ix_solicitacoes_saidas_solicitacao_id', 'solicitacoes_saidas', ['solicitacao_id'])

    # 3. Coluna de destino resolvido em cada nota processada
    notas_columns = {c['name'] for c in inspector.get_columns('notas_fiscais_processadas')}
    if 'destino_planilha' not in notas_columns:
        op.add_column('notas_fiscais_processadas', sa.Column('destino_planilha', sa.String(length=30), nullable=True))
        op.create_index('ix_notas_fiscais_processadas_destino_planilha', 'notas_fiscais_processadas', ['destino_planilha'])

    # 4. Resumo agregado de CFOPs sem regra cadastrada, por solicitação
    solicitacoes_columns = {c['name'] for c in inspector.get_columns('solicitacoes')}
    if 'cfops_sem_regra' not in solicitacoes_columns:
        op.add_column('solicitacoes', sa.Column('cfops_sem_regra', sa.JSON(), nullable=False, server_default='{}'))

    # 5. template_id de solicitacoes passa a ser opcional (o fluxo novo usa solicitacoes_saidas.template_id)
    template_id_col = next(c for c in inspector.get_columns('solicitacoes') if c['name'] == 'template_id')
    if not template_id_col['nullable']:
        with op.batch_alter_table('solicitacoes') as batch_op:
            batch_op.alter_column('template_id', existing_type=sa.Integer(), nullable=True)

    # --- Backfill dos dados existentes ---

    # a) destino_planilha das notas já processadas = tipo_planilha da solicitação-pai
    conn.execute(sa.text("""
        UPDATE notas_fiscais_processadas
        SET destino_planilha = (
            SELECT tipo_planilha FROM solicitacoes WHERE solicitacoes.id = notas_fiscais_processadas.solicitacao_id
        )
        WHERE destino_planilha IS NULL
    """))

    # b) uma linha em solicitacoes_saidas para cada solicitação concluída com arquivo já gerado
    #    e que ainda não tenha uma saída correspondente registrada
    import uuid
    solicitacoes_concluidas = conn.execute(sa.text("""
        SELECT s.id, s.tipo_planilha, s.template_id, s.arquivo_saida_path, s.total_notas_processadas,
               COALESCE((SELECT SUM(n.valor_devido) FROM notas_fiscais_processadas n WHERE n.solicitacao_id = s.id), 0) AS total_valor
        FROM solicitacoes s
        WHERE s.status = 'concluido' AND s.arquivo_saida_path IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM solicitacoes_saidas ss WHERE ss.solicitacao_id = s.id AND ss.tipo = s.tipo_planilha
          )
    """)).fetchall()

    for row in solicitacoes_concluidas:
        conn.execute(
            sa.text("""
                INSERT INTO solicitacoes_saidas
                    (id, solicitacao_id, tipo, template_id, arquivo_path, total_notas, total_valor_devido, aviso, criado_em)
                VALUES
                    (:id, :solicitacao_id, :tipo, :template_id, :arquivo_path, :total_notas, :total_valor_devido, NULL, CURRENT_TIMESTAMP)
            """),
            {
                "id": str(uuid.uuid4()),
                "solicitacao_id": row[0],
                "tipo": row[1],
                "template_id": row[2],
                "arquivo_path": row[3],
                "total_notas": row[4] or 0,
                "total_valor_devido": row[5] or 0,
            }
        )

def downgrade() -> None:
    with op.batch_alter_table('solicitacoes') as batch_op:
        batch_op.alter_column('template_id', existing_type=sa.Integer(), nullable=False)

    op.drop_column('solicitacoes', 'cfops_sem_regra')
    op.drop_index('ix_notas_fiscais_processadas_destino_planilha', table_name='notas_fiscais_processadas')
    op.drop_column('notas_fiscais_processadas', 'destino_planilha')
    op.drop_table('solicitacoes_saidas')
    op.drop_table('regras_cfop_destino')
