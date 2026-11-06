"""Semeia as regras de redução do RICMS/BA Dec. 13.780/12, Art. 266, II nos perfis existentes.

Revision ID: 024_art266_ii_reducoes
Revises: 023_template_difal_antecipado
Create Date: 2026-11-06
"""

from datetime import datetime
from decimal import Decimal
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "024_art266_ii_reducoes"
down_revision: Union[str, None] = "023_template_difal_antecipado"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ART266_II_RULES = [
    (
        "7217",
        [],
        [],
        Decimal("0.1200"),
        "RICMS/BA Dec. 13.780/12, Art. 266, II, 'a' — Fios de ferro ou aço não ligados",
    ),
    (
        "7313",
        [],
        [],
        Decimal("0.1200"),
        "RICMS/BA Dec. 13.780/12, Art. 266, II, 'b' — Arame farpado e arames/tiras para cercas",
    ),
    (
        "731431",
        [],
        [],
        Decimal("0.1200"),
        "RICMS/BA Dec. 13.780/12, Art. 266, II, 'c' — Grades e redes soldadas galvanizadas",
    ),
    (
        "73144",
        [],
        [],
        Decimal("0.1200"),
        "RICMS/BA Dec. 13.780/12, Art. 266, II, 'd' — Telas metálicas, grades e redes galvanizadas/revestidas",
    ),
    (
        "73262",
        [],
        [],
        Decimal("0.1200"),
        "RICMS/BA Dec. 13.780/12, Art. 266, II, 'e' — Obras de fios de ferro ou aço",
    ),
    (
        "7317",
        [],
        ["COBRE"],
        Decimal("0.1200"),
        "RICMS/BA Dec. 13.780/12, Art. 266, II, 'f' — Tachas, pregos, percevejos, escápulas e grampos (exceto cobre)",
    ),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if not {"perfis_regras", "regras_reducao_produto"}.issubset(tables):
        return

    metadata = sa.MetaData()
    perfis = sa.Table("perfis_regras", metadata, autoload_with=bind)
    reducoes = sa.Table("regras_reducao_produto", metadata, autoload_with=bind)
    now = datetime.utcnow()

    perfil_rows = bind.execute(sa.select(perfis.c.id)).fetchall()
    for (perfil_id,) in perfil_rows:
        existentes = bind.execute(
            sa.select(reducoes.c.ncm, reducoes.c.termos_inclusao).where(
                reducoes.c.perfil_regras_id == perfil_id
            )
        ).fetchall()
        chaves = {
            (row[0], tuple(sorted(row[1] or []))) for row in existentes
        }
        for ncm, inclusao, exclusao, aliquota, descricao in ART266_II_RULES:
            if (ncm, tuple(sorted(inclusao))) in chaves:
                continue
            bind.execute(
                reducoes.insert().values(
                    perfil_regras_id=perfil_id,
                    ncm=ncm,
                    termos_inclusao=list(inclusao),
                    termos_exclusao=list(exclusao),
                    aliquota=aliquota,
                    descricao=descricao,
                    criado_em=now,
                    atualizado_em=now,
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "regras_reducao_produto" not in set(inspector.get_table_names()):
        return

    metadata = sa.MetaData()
    reducoes = sa.Table("regras_reducao_produto", metadata, autoload_with=bind)
    descricoes = [r[4] for r in ART266_II_RULES]
    bind.execute(
        reducoes.delete().where(reducoes.c.descricao.in_(descricoes))
    )

