"""Habilita Convênio ICMS 52/91 no perfil Padrão Geral.

Revision ID: 018_convenio_52_91
Revises: 017_passo_a_passo_mva
Create Date: 2026-09-24
"""

from copy import deepcopy
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "018_convenio_52_91"
down_revision: Union[str, None] = "017_passo_a_passo_mva"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONFIG_KEY = "convenio_icms_52_91_anexo_i"
DEFAULT_CONFIG = {
    "enabled": True,
    "aplicar_automaticamente_seguros": True,
    "solicitar_confirmacao_duvidosos": True,
    "considerar_cst20_como_indicio": True,
    "ajustes": [],
}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "perfis_regras" not in inspector.get_table_names():
        return
    metadata = sa.MetaData()
    perfis = sa.Table("perfis_regras", metadata, autoload_with=bind)
    padrao = bind.execute(
        sa.select(perfis).where(perfis.c.nome == "Padrão Geral")
    ).mappings().first()
    if not padrao:
        return

    config = deepcopy(padrao.get("configuracoes_extras") or {})
    if CONFIG_KEY not in config:
        config[CONFIG_KEY] = deepcopy(DEFAULT_CONFIG)
        bind.execute(
            perfis.update()
            .where(perfis.c.id == padrao["id"])
            .values(configuracoes_extras=config, atualizado_em=datetime.utcnow())
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "perfis_regras" not in inspector.get_table_names():
        return
    metadata = sa.MetaData()
    perfis = sa.Table("perfis_regras", metadata, autoload_with=bind)
    padrao = bind.execute(
        sa.select(perfis).where(perfis.c.nome == "Padrão Geral")
    ).mappings().first()
    if not padrao:
        return
    config = deepcopy(padrao.get("configuracoes_extras") or {})
    if CONFIG_KEY in config:
        config.pop(CONFIG_KEY, None)
        bind.execute(
            perfis.update()
            .where(perfis.c.id == padrao["id"])
            .values(configuracoes_extras=config, atualizado_em=datetime.utcnow())
        )
