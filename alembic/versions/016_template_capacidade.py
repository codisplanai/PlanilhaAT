"""Adiciona capacidade aos templates e permite oficialidade por tipo + capacidade.

Revision ID: 016_template_capacidade
Revises: 015_template_arquivo_blob
Create Date: 2026-09-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "016_template_capacidade"
down_revision: Union[str, None] = "015_template_arquivo_blob"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector) -> set[str]:
    return {
        index["name"]
        for index in inspector.get_indexes("templates_xlsx")
        if index.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "templates_xlsx" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("templates_xlsx")}
    indexes = _index_names(inspector)

    if "capacidade_linhas" not in columns:
        with op.batch_alter_table("templates_xlsx") as batch_op:
            batch_op.add_column(sa.Column("capacidade_linhas", sa.Integer(), nullable=True))
            batch_op.create_check_constraint(
                "ck_template_capacidade_linhas_positiva",
                "capacidade_linhas IS NULL OR capacidade_linhas > 0",
            )

    # O índice antigo impedia mais de um modelo ativo por tipo.
    if "uq_template_ativo_por_tipo" in indexes:
        op.drop_index("uq_template_ativo_por_tipo", table_name="templates_xlsx")

    inspector = sa.inspect(bind)
    indexes = _index_names(inspector)

    if "ix_templates_xlsx_capacidade_linhas" not in indexes:
        op.create_index(
            "ix_templates_xlsx_capacidade_linhas",
            "templates_xlsx",
            ["capacidade_linhas"],
            unique=False,
        )

    if "uq_template_ativo_tipo_capacidade" not in indexes:
        op.create_index(
            "uq_template_ativo_tipo_capacidade",
            "templates_xlsx",
            ["tipo", "capacidade_linhas"],
            unique=True,
            postgresql_where=sa.text("ativo IS TRUE AND capacidade_linhas IS NOT NULL"),
            sqlite_where=sa.text("ativo = 1 AND capacidade_linhas IS NOT NULL"),
        )

    if "uq_template_ativo_tipo_legado" not in indexes:
        op.create_index(
            "uq_template_ativo_tipo_legado",
            "templates_xlsx",
            ["tipo"],
            unique=True,
            postgresql_where=sa.text("ativo IS TRUE AND capacidade_linhas IS NULL"),
            sqlite_where=sa.text("ativo = 1 AND capacidade_linhas IS NULL"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "templates_xlsx" not in inspector.get_table_names():
        return

    indexes = _index_names(inspector)
    for name in (
        "uq_template_ativo_tipo_capacidade",
        "uq_template_ativo_tipo_legado",
        "ix_templates_xlsx_capacidade_linhas",
    ):
        if name in indexes:
            op.drop_index(name, table_name="templates_xlsx")

    columns = {column["name"] for column in sa.inspect(bind).get_columns("templates_xlsx")}
    if "capacidade_linhas" in columns:
        with op.batch_alter_table("templates_xlsx") as batch_op:
            batch_op.drop_constraint("ck_template_capacidade_linhas_positiva", type_="check")
            batch_op.drop_column("capacidade_linhas")

    # Restaura a regra antiga apenas se os dados permitirem um único ativo por tipo.
    duplicates = bind.execute(
        sa.text(
            "SELECT tipo, COUNT(*) AS total FROM templates_xlsx "
            "WHERE ativo = :ativo GROUP BY tipo HAVING COUNT(*) > 1"
        ),
        {"ativo": True},
    ).fetchall()
    if not duplicates:
        op.create_index(
            "uq_template_ativo_por_tipo",
            "templates_xlsx",
            ["tipo"],
            unique=True,
            postgresql_where=sa.text("ativo IS TRUE"),
            sqlite_where=sa.text("ativo = 1"),
        )
