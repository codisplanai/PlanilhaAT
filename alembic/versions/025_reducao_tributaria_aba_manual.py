"""Adiciona escopo (Parcial vs Tributária) em regras_reducao_produto e remove seed automático do Art. 266, II.

Revision ID: 025_reducao_tributaria_manual
Revises: 024_art266_ii_reducoes
Create Date: 2026-11-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "025_reducao_tributaria_manual"
down_revision: Union[str, None] = "024_art266_ii_reducoes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ART266_II_SEED_DESCRIPTIONS = [
    "RICMS/BA Dec. 13.780/12, Art. 266, II, 'a' — Fios de ferro ou aço não ligados",
    "RICMS/BA Dec. 13.780/12, Art. 266, II, 'b' — Arame farpado e arames/tiras para cercas",
    "RICMS/BA Dec. 13.780/12, Art. 266, II, 'c' — Grades e redes soldadas galvanizadas",
    "RICMS/BA Dec. 13.780/12, Art. 266, II, 'd' — Telas metálicas, grades e redes galvanizadas/revestidas",
    "RICMS/BA Dec. 13.780/12, Art. 266, II, 'e' — Obras de fios de ferro ou aço",
    "RICMS/BA Dec. 13.780/12, Art. 266, II, 'f' — Tachas, pregos, percevejos, escápulas e grampos (exceto cobre)",
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "regras_reducao_produto" not in tables:
        return

    metadata = sa.MetaData()
    reducoes = sa.Table("regras_reducao_produto", metadata, autoload_with=bind)
    bind.execute(
        reducoes.delete().where(reducoes.c.descricao.in_(ART266_II_SEED_DESCRIPTIONS))
    )

    columns = {col["name"] for col in inspector.get_columns("regras_reducao_produto")}
    if "escopo" not in columns:
        op.add_column(
            "regras_reducao_produto",
            sa.Column(
                "escopo",
                sa.String(length=30),
                nullable=False,
                server_default="antecipacao_parcial",
            ),
        )
        op.create_index(
            "ix_regras_reducao_produto_escopo",
            "regras_reducao_produto",
            ["escopo"],
        )

    if bind.dialect.name == "postgresql":
        op.alter_column(
            "regras_reducao_produto",
            "aliquota",
            existing_type=sa.Numeric(precision=6, scale=4),
            type_=sa.Numeric(precision=8, scale=5),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "regras_reducao_produto" not in set(inspector.get_table_names()):
        return

    columns = {col["name"] for col in inspector.get_columns("regras_reducao_produto")}
    if "escopo" in columns:
        op.drop_index("ix_regras_reducao_produto_escopo", table_name="regras_reducao_produto")
        op.drop_column("regras_reducao_produto", "escopo")

