import os
from sqlalchemy.orm import Session

from app.models.template_xlsx import TemplateXlsx
from app.models.regra_cfop import RegraCfopDestino
from app.services.templates_admin.template_manager import TemplateManager
from app.core.config import settings

DEFAULT_CFOP_RULES = [
    ("102", "antecipacao_parcial", "Compra para comercialização — produto tributado"),
    ("403", "antecipacao_tributaria", "Mercadoria sujeita a ST — conferir com o contador"),
    ("404", "antecipacao_tributaria", "ST com imposto retido anteriormente — conferir com o contador"),
    ("405", "antecipacao_tributaria", "Compra para comercialização — produto antecipado (substituído)"),
    ("407", "difal", "Compra de mercadoria para uso ou consumo com ST"),
    ("551", "difal", "Aquisição de bem para o ativo imobilizado"),
    ("556", "difal", "Aquisição de material para uso/consumo"),
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
        "red": "L"
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
        "red": "L"
    },
    "sheet_name": "4",
    "header_cell": "A2",
    "extra_options": {
        "header_cell": "A2",
        "aliquota_format": "percent_number"
    }
}

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_parcial_antecipado.xlsx"
)

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING = {
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

DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_MAPPING = {
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

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_TEMPLATE_PATH = os.path.join(
    settings.TEMPLATES_DIR, "modelo_padrao_antecipacao_parcial_antecipado_simples.xlsx"
)

DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_MAPPING = {
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

def seed_default_templates(db: Session) -> None:
    """Registra os templates pré-definidos oficiais no banco se não houver template ativo correspondente"""
    # 1. Antecipação Parcial (RP-153)
    template_parcial_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "antecipacao_parcial", TemplateXlsx.ativo == True)
        .first()
    )

    deve_subir_parcial = False
    if template_parcial_ativo is None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH):
        deve_subir_parcial = True
    elif template_parcial_ativo is not None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()
        cur_hash = TemplateManager.calculate_file_hash(file_bytes)
        cols = template_parcial_ativo.mapeamento_campos.get("columns") or {}
        if template_parcial_ativo.arquivo_hash != cur_hash or "base_calculo" not in cols or "data_entrada" not in cols:
            deve_subir_parcial = True

    if deve_subir_parcial and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_parcial",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_parcial.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial (RP-153)",
            promover_ativo=True
        )

    # 2. Antecipação Tributária / ST (RP-151 / Anexo 88)
    template_tributaria_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "antecipacao_tributaria", TemplateXlsx.ativo == True)
        .first()
    )

    if template_tributaria_ativo is None and os.path.exists(DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_tributaria",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_tributaria.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Tributária (RP-151 / Anexo 88)",
            promover_ativo=True
        )

    # 3. Antecipação Tributária / ST — Pago Antecipadamente (RP-151 / Anexo 88)
    template_tributaria_antecipado_ativo = (
        db.query(TemplateXlsx)
        .filter(
            TemplateXlsx.tipo == "antecipacao_tributaria_antecipado",
            TemplateXlsx.capacidade_linhas == 35,
            TemplateXlsx.ativo == True,
        )
        .first()
    )

    if (
        template_tributaria_antecipado_ativo is None
        and os.path.exists(DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH)
    ):
        with open(DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_tributaria_antecipado",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_tributaria_antecipado.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_MAPPING,
            capacidade_linhas=35,
            observacoes=(
                "Modelo oficial de Antecipação Tributária — DAE pago antecipadamente "
                "(RP-151 / Anexo 88), capacidade de 35 linhas"
            ),
            promover_ativo=True,
        )

    # 4. DIFAL (RP-158)
    template_difal_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "difal", TemplateXlsx.ativo == True)
        .first()
    )

    if template_difal_ativo is None and os.path.exists(DEFAULT_DIFAL_TEMPLATE_PATH):
        with open(DEFAULT_DIFAL_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="difal",
            file_bytes=file_bytes,
            filename="modelo_padrao_difal.xlsx",
            mapeamento=DEFAULT_DIFAL_MAPPING,
            observacoes="Modelo oficial pré-definido de DIFAL (RP-158)",
            promover_ativo=True
        )

    # 5. Antecipação Parcial — Pago Antecipadamente (RP-155)
    template_antecipado_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "antecipacao_parcial_antecipado", TemplateXlsx.ativo == True)
        .first()
    )

    deve_subir_antecipado = False
    if template_antecipado_ativo is None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH):
        deve_subir_antecipado = True
    elif template_antecipado_ativo is not None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()
        cur_hash = TemplateManager.calculate_file_hash(file_bytes)
        cols = template_antecipado_ativo.mapeamento_campos.get("columns") or {}
        if template_antecipado_ativo.arquivo_hash != cur_hash or "base_calculo" not in cols:
            deve_subir_antecipado = True

    if deve_subir_antecipado and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_parcial_antecipado",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_parcial_antecipado.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial — Pago Antecipadamente (RP-155)",
            promover_ativo=True
        )

    # 6. Antecipação Parcial — Simples Nacional (RP-154)
    template_parcial_simples_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "antecipacao_parcial_simples", TemplateXlsx.ativo == True)
        .first()
    )

    if template_parcial_simples_ativo is None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_parcial_simples",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_parcial_simples.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_SIMPLES_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial — Simples Nacional (RP-154)",
            promover_ativo=True
        )

    # 7. Antecipação Parcial Pago Antecipadamente — Simples Nacional (RP-156)
    template_antecipado_simples_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "antecipacao_parcial_antecipado_simples", TemplateXlsx.ativo == True)
        .first()
    )

    if template_antecipado_simples_ativo is None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_parcial_antecipado_simples",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_parcial_antecipado_simples.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES_MAPPING,
            observacoes="Modelo oficial pré-definido de Antecipação Parcial Pago Antecipadamente — Simples Nacional (RP-156)",
            promover_ativo=True
        )
