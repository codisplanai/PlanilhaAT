"""Reforça unicidade e invariantes de domínio no banco.

Revision ID: 009_integrity_constraints
Revises: 008_profiles_user_ownership
Create Date: 2026-09-01
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "009_integrity_constraints"
down_revision: Union[str, None] = "008_profiles_user_ownership"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _assert_no_duplicates(connection) -> None:
    checks = {
        "regras de alíquota": """
            SELECT 1 FROM regras_aliquotas_destino
            GROUP BY perfil_regras_id, uf, COALESCE(ncm, '') HAVING COUNT(*) > 1 LIMIT 1
        """,
        "regras de CFOP": """
            SELECT 1 FROM regras_cfop_destino
            GROUP BY COALESCE(perfil_regras_id, 0), cfop_sufixo HAVING COUNT(*) > 1 LIMIT 1
        """,
        "templates ativos": """
            SELECT 1 FROM templates_xlsx WHERE ativo = true
            GROUP BY tipo HAVING COUNT(*) > 1 LIMIT 1
        """,
    }
    for label, query in checks.items():
        if connection.execute(sa.text(query)).first():
            raise RuntimeError(f"Existem {label} duplicados; corrija-os antes de aplicar a migração 009.")


def upgrade() -> None:
    connection = op.get_bind()
    _assert_no_duplicates(connection)

    op.execute(sa.text(
        "CREATE UNIQUE INDEX uq_perfil_uf_ncm_normalizado "
        "ON regras_aliquotas_destino (perfil_regras_id, uf, COALESCE(ncm, ''))"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX uq_perfil_cfop_sufixo_normalizado "
        "ON regras_cfop_destino (COALESCE(perfil_regras_id, 0), cfop_sufixo)"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX uq_template_ativo_por_tipo "
        "ON templates_xlsx (tipo) WHERE ativo = true"
    ))

    if connection.dialect.name == "postgresql":
        op.create_check_constraint("ck_profiles_role", "profiles", "role IN ('admin', 'operador')")
        op.create_check_constraint(
            "ck_solicitacoes_status",
            "solicitacoes",
            "status IN ('pendente', 'processando', 'concluido', 'erro')",
        )
        op.create_check_constraint("ck_solicitacoes_periodo", "solicitacoes", "periodo_fim >= periodo_inicio")
        op.create_check_constraint(
            "ck_regra_aliquota_intervalo",
            "regras_aliquotas_destino",
            "aliquota >= 0 AND aliquota <= 1",
        )
        op.create_check_constraint(
            "ck_regra_cfop_destino",
            "regras_cfop_destino",
            "destino IN ('antecipacao_parcial', 'antecipacao_parcial_antecipado', 'antecipacao_tributaria', 'difal', 'ignorar')",
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        op.drop_constraint("ck_regra_cfop_destino", "regras_cfop_destino", type_="check")
        op.drop_constraint("ck_regra_aliquota_intervalo", "regras_aliquotas_destino", type_="check")
        op.drop_constraint("ck_solicitacoes_periodo", "solicitacoes", type_="check")
        op.drop_constraint("ck_solicitacoes_status", "solicitacoes", type_="check")
        op.drop_constraint("ck_profiles_role", "profiles", type_="check")
    op.drop_index("uq_template_ativo_por_tipo", table_name="templates_xlsx")
    op.drop_index("uq_perfil_cfop_sufixo_normalizado", table_name="regras_cfop_destino")
    op.drop_index("uq_perfil_uf_ncm_normalizado", table_name="regras_aliquotas_destino")
