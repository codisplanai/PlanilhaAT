"""Configuração de fornecedores de uso e consumo por empresa."""
from alembic import op
import sqlalchemy as sa

revision = "029_fornecedores_uso_consumo"
down_revision = "028_regras_fcp_produto"
branch_labels = None
depends_on = None


def upgrade():
    if "fornecedores_uso_consumo" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("empresas")}:
        op.add_column("empresas", sa.Column("fornecedores_uso_consumo", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade():
    if "fornecedores_uso_consumo" in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("empresas")}:
        op.drop_column("empresas", "fornecedores_uso_consumo")
