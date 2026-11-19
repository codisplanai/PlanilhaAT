"""Cria tabelas regras_fcp_produto e excecoes_fcp_produto para FCP por produto.

Revision ID: 028_regras_fcp_produto
Revises: 027_template_empresa_id
Create Date: 2026-11-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "028_regras_fcp_produto"
down_revision: Union[str, None] = "027_template_empresa_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_indexes(bind, table_name: str, specs: tuple[tuple[str, list[str]], ...]) -> None:
    existing = {
        idx["name"]
        for idx in sa.inspect(bind).get_indexes(table_name)
        if idx.get("name")
    }
    for name, columns in specs:
        if name not in existing:
            op.create_index(name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "regras_fcp_produto" not in tables:
        op.create_table(
            "regras_fcp_produto",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("perfil_regras_id", sa.Integer(), nullable=False),
            sa.Column("uf", sa.String(length=2), server_default="BA", nullable=False),
            sa.Column("ncm", sa.String(length=8), nullable=False),
            sa.Column("termos_inclusao", sa.JSON(), nullable=False),
            sa.Column("termos_exclusao", sa.JSON(), nullable=False),
            sa.Column("aliquota", sa.Numeric(precision=6, scale=4), nullable=False),
            sa.Column(
                "aplicar_com_termo_acordo",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            ),
            sa.Column("descricao", sa.String(length=255), nullable=True),
            sa.Column("criado_em", sa.DateTime(), nullable=False),
            sa.Column("atualizado_em", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["perfil_regras_id"], ["perfis_regras.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(
                "aliquota > 0 AND aliquota <= 1", name="ck_fcp_aliquota_intervalo"
            ),
            sa.CheckConstraint("uf = upper(uf) AND length(uf) = 2", name="ck_fcp_uf"),
        )

    _ensure_indexes(
        bind,
        "regras_fcp_produto",
        (
            ("ix_regras_fcp_produto_id", ["id"]),
            ("ix_regras_fcp_produto_perfil_regras_id", ["perfil_regras_id"]),
            ("ix_regras_fcp_produto_ncm", ["ncm"]),
            ("ix_fcp_perfil_uf_ncm", ["perfil_regras_id", "uf", "ncm"]),
        ),
    )

    if "excecoes_fcp_produto" not in tables:
        op.create_table(
            "excecoes_fcp_produto",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("regra_fcp_id", sa.Integer(), nullable=False),
            sa.Column("descricao_exata", sa.String(length=255), nullable=False),
            sa.Column("enquadrado", sa.Boolean(), nullable=False),
            sa.Column("observacao", sa.String(length=255), nullable=True),
            sa.Column("criado_em", sa.DateTime(), nullable=False),
            sa.Column("atualizado_em", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["regra_fcp_id"], ["regras_fcp_produto.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "regra_fcp_id",
                "descricao_exata",
                name="uq_excecao_fcp_regra_descricao",
            ),
        )

    _ensure_indexes(
        bind,
        "excecoes_fcp_produto",
        (
            ("ix_excecoes_fcp_produto_id", ["id"]),
            ("ix_excecoes_fcp_produto_regra_fcp_id", ["regra_fcp_id"]),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "excecoes_fcp_produto" in tables:
        op.drop_table("excecoes_fcp_produto")
    if "regras_fcp_produto" in tables:
        op.drop_table("regras_fcp_produto")
