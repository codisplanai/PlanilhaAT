"""Cria o template ativo da DIFAL Pago Antecipadamente a partir do template DIFAL.

Produção roda com SEED_DEFAULTS=false: sem esta migração não haveria template
ativo do tipo difal_antecipado, e as linhas desse destino ficariam sem planilha.
O modelo oficial é o mesmo da DIFAL (RP-158), então copiamos o template DIFAL
ativo (arquivo, blob e mapeamento). Não faz nada se já houver um ativo.

Revision ID: 023_template_difal_antecipado
Revises: 022_empresa_atividade
Create Date: 2026-11-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "023_template_difal_antecipado"
down_revision: Union[str, None] = "022_empresa_atividade"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OBSERVACAO = "Modelo oficial de DIFAL — Pago Antecipadamente (RP-158) [migração 023]"

templates = sa.table(
    "templates_xlsx",
    sa.column("id", sa.Integer),
    sa.column("tipo", sa.String),
    sa.column("versao", sa.Integer),
    sa.column("capacidade_linhas", sa.Integer),
    sa.column("arquivo_path", sa.String),
    sa.column("arquivo_hash", sa.String),
    sa.column("arquivo_blob", sa.LargeBinary),
    sa.column("mapeamento_campos", sa.JSON),
    sa.column("ativo", sa.Boolean),
    sa.column("observacoes", sa.Text),
    sa.column("criado_em", sa.DateTime),
)


def upgrade() -> None:
    bind = op.get_bind()
    if "templates_xlsx" not in sa.inspect(bind).get_table_names():
        return

    ja_existe = bind.execute(
        sa.select(templates.c.id).where(
            templates.c.tipo == "difal_antecipado", templates.c.ativo.is_(True)
        )
    ).first()
    if ja_existe:
        return

    difal_ativos = bind.execute(
        sa.select(
            templates.c.capacidade_linhas,
            templates.c.arquivo_path,
            templates.c.arquivo_hash,
            templates.c.arquivo_blob,
            templates.c.mapeamento_campos,
        )
        .where(templates.c.tipo == "difal", templates.c.ativo.is_(True))
        .order_by(templates.c.versao.desc())
    ).fetchall()

    proxima_versao = (
        bind.execute(
            sa.select(sa.func.max(templates.c.versao)).where(templates.c.tipo == "difal_antecipado")
        ).scalar()
        or 0
    ) + 1
    for capacidade, path, file_hash, blob, mapeamento in difal_ativos:
        bind.execute(
            templates.insert().values(
                tipo="difal_antecipado",
                versao=proxima_versao,
                capacidade_linhas=capacidade,
                arquivo_path=path,
                arquivo_hash=file_hash,
                arquivo_blob=blob,
                mapeamento_campos=mapeamento,
                ativo=True,
                observacoes=OBSERVACAO,
                criado_em=sa.func.current_timestamp(),
            )
        )
        proxima_versao += 1


def downgrade() -> None:
    bind = op.get_bind()
    if "templates_xlsx" not in sa.inspect(bind).get_table_names():
        return
    bind.execute(
        templates.delete().where(
            templates.c.tipo == "difal_antecipado", templates.c.observacoes == OBSERVACAO
        )
    )
