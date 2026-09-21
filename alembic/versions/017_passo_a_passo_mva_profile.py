"""Cria perfil dedicado da Passo a Passo e habilita política de MVA por revenda.

Revision ID: 017_passo_a_passo_mva
Revises: 016_template_capacidade
Create Date: 2026-09-21
"""

from copy import deepcopy
from datetime import datetime
from typing import Dict, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "017_passo_a_passo_mva"
down_revision: Union[str, None] = "016_template_capacidade"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COMPANY_CNPJ = "33906322000153"
PROFILE_NAME = "Passo a Passo Calçados"
CONFIG_KEY = "mva_revenda_antecipacao_tributaria"

POLICY_CONFIG = {
    "enabled": True,
    "empresa_cnpj": COMPANY_CNPJ,
    "empresa_cnpj": COMPANY_CNPJ,
    "special_ncms": [
        "42022100", "42022210", "42022220", "42022900",
        "42023100", "42023200", "42023900", "42033000",
        "64019990", "64021900", "64022000", "64029190",
        "64029990", "64035990", "64039190", "64039990",
        "64041100", "64041900", "64059000",
    ],
    "description_fallback_ncms": ["61178090", "62171000", "63072000"],
    "special_keywords": ["CINTO", "CINTOS"],
    "exclusion_keywords": [
        "MOCHILA", "MOCHILAS", "MALA", "MALAS", "PASTA", "PASTAS",
        "NECESSAIRE", "NECESSAIRES", "PALMILHA", "PALMILHAS",
        "CALCANHEIRA", "CALCANHEIRAS",
    ],
    "mvas": {
        "especial": {"4": "61.81", "7": "56.75", "12": "48.33", "original": "34.00"},
        "demais": {"4": "69.06", "7": "63.77", "12": "54.97", "original": "40.00"},
    },
}


def _table(bind, name: str):
    metadata = sa.MetaData()
    return sa.Table(name, metadata, autoload_with=bind)


def _copy_profile_rows(bind, table_name: str, source_profile_id: int, target_profile_id: int) -> Dict[int, int]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return {}

    table = _table(bind, table_name)
    rows = bind.execute(
        sa.select(table).where(table.c.perfil_regras_id == source_profile_id)
    ).mappings().all()

    id_map: Dict[int, int] = {}
    for row in rows:
        payload = dict(row)
        old_id = int(payload.pop("id"))
        payload["perfil_regras_id"] = target_profile_id
        result = bind.execute(table.insert().values(**payload))
        new_id = result.inserted_primary_key[0]
        if new_id is not None:
            id_map[old_id] = int(new_id)
    return id_map


def _copy_child_rows(bind, table_name: str, fk_column: str, id_map: Dict[int, int]) -> None:
    if not id_map:
        return
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return

    table = _table(bind, table_name)
    fk = table.c[fk_column]
    for old_id, new_id in id_map.items():
        rows = bind.execute(sa.select(table).where(fk == old_id)).mappings().all()
        for row in rows:
            payload = dict(row)
            payload.pop("id", None)
            payload[fk_column] = new_id
            bind.execute(table.insert().values(**payload))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    required = {"perfis_regras", "empresas"}
    if not required.issubset(set(inspector.get_table_names())):
        return

    perfis = _table(bind, "perfis_regras")
    empresas = _table(bind, "empresas")
    now = datetime.utcnow()

    empresa = bind.execute(
        sa.select(empresas).where(empresas.c.cnpj == COMPANY_CNPJ)
    ).mappings().first()

    source_profile_id = int(empresa["perfil_regras_id"]) if empresa else None
    if source_profile_id is None:
        padrao = bind.execute(
            sa.select(perfis).where(perfis.c.nome == "Padrão Geral")
        ).mappings().first()
        if padrao:
            source_profile_id = int(padrao["id"])

    existing = bind.execute(
        sa.select(perfis).where(perfis.c.nome == PROFILE_NAME)
    ).mappings().first()

    created_profile = existing is None
    if existing:
        target_profile_id = int(existing["id"])
        config = deepcopy(existing.get("configuracoes_extras") or {})
        config[CONFIG_KEY] = deepcopy(POLICY_CONFIG)
        bind.execute(
            perfis.update()
            .where(perfis.c.id == target_profile_id)
            .values(configuracoes_extras=config, atualizado_em=now)
        )
    else:
        source_config = {}
        source_description = None
        if source_profile_id is not None:
            source = bind.execute(
                sa.select(perfis).where(perfis.c.id == source_profile_id)
            ).mappings().first()
            if source:
                source_config = deepcopy(source.get("configuracoes_extras") or {})
                source_description = source.get("descricao")

        source_config[CONFIG_KEY] = deepcopy(POLICY_CONFIG)
        values = {
            "nome": PROFILE_NAME,
            "descricao": source_description or (
                "Perfil exclusivo da Passo a Passo Calçados, com revenda direcionada "
                "à Antecipação Tributária e MVA parametrizada."
            ),
            "configuracoes_extras": source_config,
            "criado_em": now,
            "atualizado_em": now,
        }
        result = bind.execute(perfis.insert().values(**values))
        target_profile_id = int(result.inserted_primary_key[0])

    if created_profile and source_profile_id is not None and source_profile_id != target_profile_id:
        _copy_profile_rows(bind, "regras_aliquotas_destino", source_profile_id, target_profile_id)
        _copy_profile_rows(bind, "regras_cfop_destino", source_profile_id, target_profile_id)
        reducao_map = _copy_profile_rows(
            bind, "regras_reducao_produto", source_profile_id, target_profile_id
        )
        _copy_child_rows(
            bind, "excecoes_reducao_produto", "regra_reducao_id", reducao_map
        )
        reclass_map = _copy_profile_rows(
            bind, "regras_reclassificacao_cfop", source_profile_id, target_profile_id
        )
        _copy_child_rows(
            bind,
            "excecoes_reclassificacao_cfop",
            "regra_reclassificacao_id",
            reclass_map,
        )
        _copy_profile_rows(bind, "regras_exclusao_parcial", source_profile_id, target_profile_id)

    if empresa:
        bind.execute(
            empresas.update()
            .where(empresas.c.id == empresa["id"])
            .values(perfil_regras_id=target_profile_id, atualizado_em=now)
        )
    else:
        values = {
            "razao_social": "Passo a Passo calcados",
            "cnpj": COMPANY_CNPJ,
            "uf": "BA",
            "perfil_regras_id": target_profile_id,
            "ativo": True,
            "criado_em": now,
            "atualizado_em": now,
        }
        if "inscricao_estadual" in empresas.c:
            values["inscricao_estadual"] = "26058360"
        if "optante_simples_nacional" in empresas.c:
            values["optante_simples_nacional"] = False
        bind.execute(empresas.insert().values(**values))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not {"perfis_regras", "empresas"}.issubset(set(inspector.get_table_names())):
        return

    perfis = _table(bind, "perfis_regras")
    empresas = _table(bind, "empresas")
    target = bind.execute(
        sa.select(perfis).where(perfis.c.nome == PROFILE_NAME)
    ).mappings().first()
    padrao = bind.execute(
        sa.select(perfis).where(perfis.c.nome == "Padrão Geral")
    ).mappings().first()

    if target and padrao:
        bind.execute(
            empresas.update()
            .where(
                sa.and_(
                    empresas.c.cnpj == COMPANY_CNPJ,
                    empresas.c.perfil_regras_id == target["id"],
                )
            )
            .values(perfil_regras_id=padrao["id"], atualizado_em=datetime.utcnow())
        )
