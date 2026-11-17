import os
from typing import Any, Callable, Dict, Iterable, Optional
from sqlalchemy.orm import Session

from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
    ANTECIPACAO_PARCIAL_SIMPLES,
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
    DIFAL_ANTECIPADO,
)
from app.models.template_xlsx import TemplateXlsx
from app.models.regra_cfop import RegraCfopDestino
from app.services.templates_admin.template_manager import TemplateManager
from app.core.config import settings

DEFAULT_CFOP_RULES = [
    ("102", ANTECIPACAO_PARCIAL, "Compra para comercialização — produto tributado"),
    ("403", ANTECIPACAO_TRIBUTARIA, "Mercadoria sujeita a ST — conferir com o contador"),
    ("404", ANTECIPACAO_TRIBUTARIA, "ST com imposto retido anteriormente — conferir com o contador"),
    ("405", ANTECIPACAO_TRIBUTARIA, "Compra para comercialização — produto antecipado (substituído)"),
    ("407", DIFAL, "Compra de mercadoria para uso ou consumo com ST"),
    ("551", DIFAL, "Aquisição de bem para o ativo imobilizado"),
    ("556", DIFAL, "Aquisição de material para uso/consumo"),
]

def seed_default_cfop_rules(db: Session) -> None:
    """Registra as regras padrão globais (perfil_regras_id=NULL) de roteamento CFOP -> planilha"""
    existentes = (
        db.query(RegraCfopDestino.cfop_sufixo)
        .filter(RegraCfopDestino.perfil_regras_id == None)
        .all()
    )
    sufixos_existentes = {row[0] for row in existentes}

    for sufixo, destino, descricao in DEFAULT_CFOP_RULES:
        if sufixo in sufixos_existentes:
            continue
        db.add(RegraCfopDestino(
            perfil_regras_id=None,
            cfop_sufixo=sufixo,
            destino=destino,
            descricao=descricao
        ))
    db.commit()

DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_parcial.xlsx"
)

DEFAULT_ANTECIPACAO_PARCIAL_MAPPING = {
    "start_row": 4,
    "columns": {
        "item_index": "A",
        "data_entrada": "B",
        "data_emissao": "C",
        "numero_nota": "D",
        "v_total": "E",
        "base_calculo": "F",
        "ipi_despesas": "G",
        "a_dst": "H",
        "a_ori": "I"
    },
    "header_cell": "A2",
    "extra_options": {
        "header_cell": "A2",
        "aliquota_format": "percent_number"
    }
}

DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_tributaria.xlsx"
)

DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING = {
    "start_row": 4,
    "columns": {
        "item_index": "A",
        "data_entrada": "B",
        "data_emissao": "C",
        "numero_nota": "D",
        "v_total": "E",
        "base_calculo": "F",
        "ipi_despesas": "G",
        "mva": "H",
        "reducao": "I",
        "a_dst": "J",
        "a_ori": "K",
        "red": "L",
        "valor_pago": "S"
    },
    "header_cell": "A2",
    "extra_options": {
        "header_cell": "A2",
        "aliquota_format": "percent_number"
    }
}

DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_tributaria_antecipado.xlsx"
)

DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_MAPPING = {
    **DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
    "sheet_name": "4",
}

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_parcial_antecipado.xlsx"
)

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING = dict(DEFAULT_ANTECIPACAO_PARCIAL_MAPPING)

DEFAULT_DIFAL_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_difal.xlsx"
)

DEFAULT_DIFAL_MAPPING = {
    "start_row": 4,
    "columns": {
        "item_index": "A",
        "data_entrada": "B",
        "data_emissao": "C",
        "numero_nota": "D",
        "v_total": "E",
        "ipi_despesas": "F",
        "aliq_simples": "G",
        "a_dst": "I",
        "a_ori": "J"
    },
    "header_cell": "A2",
    "extra_options": {
        "header_cell": "A2",
        "aliquota_format": "percent_number"
    }
}

DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_parcial_simples.xlsx"
)

DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_MAPPING = dict(DEFAULT_ANTECIPACAO_PARCIAL_MAPPING)

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_parcial_antecipado_simples.xlsx"
)

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_MAPPING = dict(DEFAULT_ANTECIPACAO_PARCIAL_MAPPING)


def _seed_template_if_needed(
    db: Session,
    *,
    tipo: str,
    path: str,
    filename: str,
    mapeamento: Dict[str, Any],
    observacoes: str,
    capacidade_linhas: Optional[int] = None,
    check_hash: bool = False,
    required_columns: Iterable[str] = (),
) -> None:
    if not os.path.exists(path):
        return

    query = db.query(TemplateXlsx).filter(
        TemplateXlsx.tipo == tipo,
        TemplateXlsx.ativo == True,
        TemplateXlsx.empresa_id.is_(None),
    )
    if capacidade_linhas is not None:
        query = query.filter(TemplateXlsx.capacidade_linhas == capacidade_linhas)
    ativo = query.first()

    with open(path, "rb") as f:
        file_bytes = f.read()

    if ativo is not None:
        if not check_hash and not required_columns:
            return
        cols = ativo.mapeamento_campos.get("columns") or {}
        missing_col = any(col not in cols for col in required_columns)
        hash_mismatch = check_hash and ativo.arquivo_hash != TemplateManager.calculate_file_hash(file_bytes)
        if not missing_col and not hash_mismatch:
            return

    TemplateManager.upload_new_template_version(
        db=db,
        tipo=tipo,
        file_bytes=file_bytes,
        filename=filename,
        mapeamento=mapeamento,
        capacidade_linhas=capacidade_linhas,
        observacoes=observacoes,
        promover_ativo=True,
    )


def seed_default_templates(db: Session) -> None:
    """Registra os templates pré-definidos oficiais no banco se não houver template ativo correspondente"""
    specs = [
        dict(
            tipo=ANTECIPACAO_PARCIAL,
            path=DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH,
            filename="modelo_padrao_antecipacao_parcial.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial (RP-153)",
            check_hash=True,
            required_columns=("base_calculo", "data_entrada"),
        ),
        dict(
            tipo=ANTECIPACAO_TRIBUTARIA,
            path=DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH,
            filename="modelo_padrao_antecipacao_tributaria.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Tributária (RP-151 / Anexo 88)",
            required_columns=("data_entrada",),
        ),
        dict(
            tipo=ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
            path=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH,
            filename="modelo_padrao_antecipacao_tributaria_antecipado.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_MAPPING,
            capacidade_linhas=35,
            observacoes=(
                "Modelo oficial de Antecipação Tributária — DAE pago antecipadamente "
                "(RP-151 / Anexo 88), capacidade de 35 linhas"
            ),
        ),
        dict(
            tipo=DIFAL,
            path=DEFAULT_DIFAL_TEMPLATE_PATH,
            filename="modelo_padrao_difal.xlsx",
            mapeamento=DEFAULT_DIFAL_MAPPING,
            observacoes="Modelo oficial pré-definido de DIFAL (RP-158)",
            required_columns=("data_entrada",),
        ),
        dict(
            tipo=DIFAL_ANTECIPADO,
            path=DEFAULT_DIFAL_TEMPLATE_PATH,
            filename="modelo_padrao_difal_antecipado.xlsx",
            mapeamento=DEFAULT_DIFAL_MAPPING,
            observacoes="Modelo oficial de DIFAL — Pago Antecipadamente (RP-158)",
        ),
        dict(
            tipo=ANTECIPACAO_PARCIAL_ANTECIPADO,
            path=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH,
            filename="modelo_padrao_antecipacao_parcial_antecipado.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial — Pago Antecipadamente (RP-155)",
            check_hash=True,
            required_columns=("base_calculo",),
        ),
        dict(
            tipo=ANTECIPACAO_PARCIAL_SIMPLES,
            path=DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_TEMPLATE_PATH,
            filename="modelo_padrao_antecipacao_parcial_simples.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial — Simples Nacional (RP-154)",
        ),
        dict(
            tipo=ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
            path=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_TEMPLATE_PATH,
            filename="modelo_padrao_antecipacao_parcial_antecipado_simples.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial Pago Antecipadamente — Simples Nacional (RP-156)",
        ),
    ]
    for spec in specs:
        _seed_template_if_needed(db, **spec)
