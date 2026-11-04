"""Adiciona mapeamento de valor_pago na coluna S para templates de antecipacao_tributaria e antecipacao_tributaria_antecipado.

Revision ID: 021_valor_pago_st
Revises: 020_fix_template_data_entrada
Create Date: 2026-10-28
"""

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "021_valor_pago_st"
down_revision: Union[str, None] = "020_fix_template_data_entrada"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "templates_xlsx" not in inspector.get_table_names():
        return

    templates_table = sa.table(
        "templates_xlsx",
        sa.column("id", sa.Integer),
        sa.column("tipo", sa.String),
        sa.column("mapeamento_campos", sa.JSON),
    )

    rows = bind.execute(
        sa.select(
            templates_table.c.id,
            templates_table.c.tipo,
            templates_table.c.mapeamento_campos,
        ).where(
            templates_table.c.tipo.in_(
                ["antecipacao_tributaria", "antecipacao_tributaria_antecipado"]
            )
        )
    ).fetchall()

    for row in rows:
        template_id = row[0]
        mapping = row[2]
        if not mapping:
            continue

        if isinstance(mapping, str):
            try:
                mapping_dict = json.loads(mapping)
            except Exception:
                continue
        else:
            mapping_dict = dict(mapping)

        columns = dict(mapping_dict.get("columns") or {})
        if "valor_pago" not in columns:
            columns["valor_pago"] = "S"
            mapping_dict["columns"] = columns

            bind.execute(
                templates_table.update()
                .where(templates_table.c.id == template_id)
                .values(mapeamento_campos=mapping_dict)
            )


def downgrade() -> None:
    pass
