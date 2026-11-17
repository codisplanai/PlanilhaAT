"""Adiciona empresa_id aos templates XLSX para suportar modelos personalizados por empresa.

Revision ID: 027_template_empresa_id
Revises: 026_template_reducao_col
Create Date: 2026-11-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "027_template_empresa_id"
down_revision: Union[str, None] = "026_template_reducao_col"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK_NAME = "fk_templates_xlsx_empresa_id"


def _index_names(inspector) -> set[str]:
    return {
        index["name"]
        for index in inspector.get_indexes("templates_xlsx")
        if index.get("name")
    }


def _unique_constraint_names(inspector) -> set[str]:
    return {
        uc["name"]
        for uc in inspector.get_unique_constraints("templates_xlsx")
        if uc.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "templates_xlsx" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("templates_xlsx")}
    indexes = _index_names(inspector)
    unique_constraints = _unique_constraint_names(inspector)

    for old_index in (
        "uq_template_ativo_tipo_capacidade",
        "uq_template_ativo_tipo_legado",
    ):
        if old_index in indexes:
            op.drop_index(old_index, table_name="templates_xlsx")

    if "empresa_id" not in columns or "uq_tipo_versao" in unique_constraints:
        with op.batch_alter_table("templates_xlsx") as batch_op:
            if "uq_tipo_versao" in unique_constraints:
                batch_op.drop_constraint("uq_tipo_versao", type_="unique")
            if "empresa_id" not in columns:
                batch_op.add_column(sa.Column("empresa_id", sa.Integer(), nullable=True))
                batch_op.create_foreign_key(
                    FK_NAME,
                    "empresas",
                    ["empresa_id"],
                    ["id"],
                    ondelete="CASCADE",
                )

    indexes = _index_names(sa.inspect(bind))

    if "ix_templates_xlsx_empresa_id" not in indexes:
        op.create_index(
            "ix_templates_xlsx_empresa_id",
            "templates_xlsx",
            ["empresa_id"],
            unique=False,
        )

    if "uq_template_versao_global" not in indexes:
        op.create_index(
            "uq_template_versao_global",
            "templates_xlsx",
            ["tipo", "versao"],
            unique=True,
            postgresql_where=sa.text("empresa_id IS NULL"),
            sqlite_where=sa.text("empresa_id IS NULL"),
        )

    if "uq_template_versao_empresa" not in indexes:
        op.create_index(
            "uq_template_versao_empresa",
            "templates_xlsx",
            ["empresa_id", "tipo", "versao"],
            unique=True,
            postgresql_where=sa.text("empresa_id IS NOT NULL"),
            sqlite_where=sa.text("empresa_id IS NOT NULL"),
        )

    if "uq_template_ativo_tipo_capacidade" not in indexes:
        op.create_index(
            "uq_template_ativo_tipo_capacidade",
            "templates_xlsx",
            ["tipo", "capacidade_linhas"],
            unique=True,
            postgresql_where=sa.text(
                "ativo IS TRUE AND capacidade_linhas IS NOT NULL AND empresa_id IS NULL"
            ),
            sqlite_where=sa.text(
                "ativo = 1 AND capacidade_linhas IS NOT NULL AND empresa_id IS NULL"
            ),
        )

    if "uq_template_ativo_tipo_legado" not in indexes:
        op.create_index(
            "uq_template_ativo_tipo_legado",
            "templates_xlsx",
            ["tipo"],
            unique=True,
            postgresql_where=sa.text(
                "ativo IS TRUE AND capacidade_linhas IS NULL AND empresa_id IS NULL"
            ),
            sqlite_where=sa.text(
                "ativo = 1 AND capacidade_linhas IS NULL AND empresa_id IS NULL"
            ),
        )

    if "uq_template_ativo_empresa_tipo_capacidade" not in indexes:
        op.create_index(
            "uq_template_ativo_empresa_tipo_capacidade",
            "templates_xlsx",
            ["empresa_id", "tipo", "capacidade_linhas"],
            unique=True,
            postgresql_where=sa.text(
                "ativo IS TRUE AND capacidade_linhas IS NOT NULL AND empresa_id IS NOT NULL"
            ),
            sqlite_where=sa.text(
                "ativo = 1 AND capacidade_linhas IS NOT NULL AND empresa_id IS NOT NULL"
            ),
        )

    if "uq_template_ativo_empresa_tipo_legado" not in indexes:
        op.create_index(
            "uq_template_ativo_empresa_tipo_legado",
            "templates_xlsx",
            ["empresa_id", "tipo"],
            unique=True,
            postgresql_where=sa.text(
                "ativo IS TRUE AND capacidade_linhas IS NULL AND empresa_id IS NOT NULL"
            ),
            sqlite_where=sa.text(
                "ativo = 1 AND capacidade_linhas IS NULL AND empresa_id IS NOT NULL"
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "templates_xlsx" not in inspector.get_table_names():
        return

    indexes = _index_names(inspector)
    for name in (
        "uq_template_ativo_empresa_tipo_legado",
        "uq_template_ativo_empresa_tipo_capacidade",
        "uq_template_ativo_tipo_legado",
        "uq_template_ativo_tipo_capacidade",
        "uq_template_versao_empresa",
        "uq_template_versao_global",
        "ix_templates_xlsx_empresa_id",
    ):
        if name in indexes:
            op.drop_index(name, table_name="templates_xlsx")

    columns = {column["name"] for column in sa.inspect(bind).get_columns("templates_xlsx")}
    if "empresa_id" in columns:
        fk_names = {
            fk["name"]
            for fk in sa.inspect(bind).get_foreign_keys("templates_xlsx")
            if fk.get("name")
        }
        with op.batch_alter_table("templates_xlsx") as batch_op:
            if FK_NAME in fk_names:
                batch_op.drop_constraint(FK_NAME, type_="foreignkey")
            batch_op.drop_column("empresa_id")

    dup_versao = bind.execute(
        sa.text(
            "SELECT tipo, versao FROM templates_xlsx "
            "GROUP BY tipo, versao HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if not dup_versao:
        with op.batch_alter_table("templates_xlsx") as batch_op:
            batch_op.create_unique_constraint("uq_tipo_versao", ["tipo", "versao"])

    dup_cap = bind.execute(
        sa.text(
            "SELECT tipo, capacidade_linhas FROM templates_xlsx "
            "WHERE ativo = :ativo AND capacidade_linhas IS NOT NULL "
            "GROUP BY tipo, capacidade_linhas HAVING COUNT(*) > 1 LIMIT 1"
        ),
        {"ativo": True},
    ).first()
    if not dup_cap:
        op.create_index(
            "uq_template_ativo_tipo_capacidade",
            "templates_xlsx",
            ["tipo", "capacidade_linhas"],
            unique=True,
            postgresql_where=sa.text("ativo IS TRUE AND capacidade_linhas IS NOT NULL"),
            sqlite_where=sa.text("ativo = 1 AND capacidade_linhas IS NOT NULL"),
        )

    dup_leg = bind.execute(
        sa.text(
            "SELECT tipo FROM templates_xlsx "
            "WHERE ativo = :ativo AND capacidade_linhas IS NULL "
            "GROUP BY tipo HAVING COUNT(*) > 1 LIMIT 1"
        ),
        {"ativo": True},
    ).first()
    if not dup_leg:
        op.create_index(
            "uq_template_ativo_tipo_legado",
            "templates_xlsx",
            ["tipo"],
            unique=True,
            postgresql_where=sa.text("ativo IS TRUE AND capacidade_linhas IS NULL"),
            sqlite_where=sa.text("ativo = 1 AND capacidade_linhas IS NULL"),
        )

