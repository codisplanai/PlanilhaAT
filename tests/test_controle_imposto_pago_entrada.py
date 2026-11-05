"""Planilha de controle das mercadorias excluídas por 'imposto pago na entrada'."""

from datetime import date
from decimal import Decimal

import openpyxl

from app.constants import CONTROLE_IMPOSTO_PAGO_ENTRADA, TIPOS_PLANILHA
from app.models.solicitacao import Solicitacao
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager
from tests.test_exclusoes_parcial_pipeline import (
    _det_item,
    _montar_xml_itens,
    _setup_ambiente,
)

MAPEAMENTO_CONTROLE = {
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
        "a_ori": "I",
    },
}


def _subir_template_controle(db_session, tmp_path):
    """Modelo de controle: dados em A-I, fórmulas em J-N, O/P em branco (manuais)."""
    path = str(tmp_path / "modelo_controle.xlsx")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Controle"
    ws["O3"], ws["P3"] = "Valor pago", "Data de pagamento"
    for r in range(4, 11):
        ws[f"J{r}"] = f"=F{r}*0"
    wb.save(path)
    wb.close()
    with open(path, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session,
            tipo=CONTROLE_IMPOSTO_PAGO_ENTRADA,
            filename="template_controle.xlsx",
            file_bytes=f.read(),
            mapeamento=MAPEAMENTO_CONTROLE,
            promover_ativo=True,
        )


def _processar(db_session, empresa, itens, total):
    xml_bytes = _montar_xml_itens(itens, total_nf=total, total_bc=total)
    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()
    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("nota.xml", xml_bytes)]
    )
    db_session.refresh(res)
    return res


def _saida(res, tipo):
    return next((s for s in res.saidas if s.tipo == tipo), None)


def test_tipo_controle_e_valido():
    assert CONTROLE_IMPOSTO_PAGO_ENTRADA in TIPOS_PLANILHA


def test_item_imposto_pago_entrada_gera_planilha_de_controle(db_session, create_sample_excel_template, tmp_path):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)
    _subir_template_controle(db_session, tmp_path)

    itens = [
        _det_item(1, "02102000", "CHARQUE BOVINO PONTA DE AGULHA", "100.00", "12.00"),
        _det_item(2, "25010020", "SAL REFINADO IODADO", "20.00", "12.00"),  # isenção: fora do controle
        _det_item(3, "10059010", "MILHO EM GRAO A GRANEL", "1000.00", "4.00"),  # segue a apuração
    ]
    res = _processar(db_session, empresa, itens, "1120.00")

    assert res.status == "concluido"
    # A mercadoria de controle não entra na apuração nem na contagem de notas.
    assert res.total_notas_processadas == 1
    assert len(res.itens_excluidos) == 2

    controle = _saida(res, CONTROLE_IMPOSTO_PAGO_ENTRADA)
    assert controle is not None and controle.arquivo_path
    assert controle.total_notas == 1
    assert controle.total_valor_devido == Decimal("0.00")

    ws = openpyxl.load_workbook(controle.arquivo_path, data_only=False).worksheets[0]
    assert ws["E4"].value == 100  # valor total do charque
    assert ws["I4"].value is not None  # A.ORI informada
    assert ws["H4"].value == 0.205  # A.DST resolvida normalmente (padrão da UF)
    assert ws["E5"].value is None  # isenção (sal) não consta
    # Colunas O (valor pago) e P (data de pagamento) ficam para preenchimento manual.
    assert ws["O4"].value is None and ws["P4"].value is None


def test_isencao_nao_gera_planilha_de_controle(db_session, create_sample_excel_template, tmp_path):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)
    _subir_template_controle(db_session, tmp_path)

    itens = [
        _det_item(1, "25010020", "SAL REFINADO IODADO", "20.00", "12.00"),
        _det_item(2, "10059010", "MILHO EM GRAO A GRANEL", "1000.00", "4.00"),
    ]
    res = _processar(db_session, empresa, itens, "1020.00")

    assert _saida(res, CONTROLE_IMPOSTO_PAGO_ENTRADA) is None


def test_so_imposto_pago_entrada_gera_apenas_o_controle(db_session, create_sample_excel_template, tmp_path):
    """Nenhum item a recolher, mas o controle continua sendo gerado."""
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)
    _subir_template_controle(db_session, tmp_path)

    itens = [_det_item(1, "17019900", "ACUCAR CRISTAL BRANCO", "80.00", "12.00")]
    res = _processar(db_session, empresa, itens, "80.00")

    assert res.status == "concluido"
    assert res.total_notas_processadas == 0
    assert res.mensagem_erro == "Nenhum item a recolher na Parcial"
    assert [s.tipo for s in res.saidas] == [CONTROLE_IMPOSTO_PAGO_ENTRADA]


def test_sem_template_de_controle_nao_quebra_a_apuracao(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)

    itens = [
        _det_item(1, "02102000", "CHARQUE BOVINO PONTA DE AGULHA", "100.00", "12.00"),
        _det_item(2, "10059010", "MILHO EM GRAO A GRANEL", "1000.00", "4.00"),
    ]
    res = _processar(db_session, empresa, itens, "1100.00")

    assert res.status == "concluido"
    assert res.total_notas_processadas == 1
    assert _saida(res, "antecipacao_parcial") is not None
    controle = _saida(res, CONTROLE_IMPOSTO_PAGO_ENTRADA)
    assert controle is None or (controle.arquivo_path is None and controle.aviso)


def _linhas_controle(res):
    controle = _saida(res, CONTROLE_IMPOSTO_PAGO_ENTRADA)
    ws = openpyxl.load_workbook(controle.arquivo_path, data_only=False).worksheets[0]
    linhas = []
    for r in range(4, 20):
        if ws[f"E{r}"].value is None:
            break
        linhas.append({
            "nota": ws[f"D{r}"].value,
            "v_total": ws[f"E{r}"].value,
            "base": ws[f"F{r}"].value,
            "a_dst": ws[f"H{r}"].value,
            "a_ori": ws[f"I{r}"].value,
        })
    return linhas


def test_controle_soma_itens_da_mesma_nota_com_mesmas_aliquotas(db_session, create_sample_excel_template, tmp_path):
    """Sem alíquotas diferentes não há desdobramento: uma linha por nota, valores somados."""
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)
    _subir_template_controle(db_session, tmp_path)

    itens = [
        _det_item(1, "02102000", "CHARQUE BOVINO PONTA DE AGULHA", "100.00", "12.00"),
        _det_item(2, "17019900", "ACUCAR CRISTAL BRANCO", "80.00", "12.00"),
        _det_item(3, "17019900", "ACUCAR CRISTAL REFINADO", "20.00", "12.00"),
    ]
    res = _processar(db_session, empresa, itens, "200.00")

    linhas = _linhas_controle(res)
    assert len(linhas) == 1
    assert linhas[0]["v_total"] == 200
    assert linhas[0]["base"] == 200
    assert "*" not in str(linhas[0]["nota"])


def test_controle_desdobra_somente_quando_a_aliquota_de_origem_difere(db_session, create_sample_excel_template, tmp_path):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)
    _subir_template_controle(db_session, tmp_path)

    itens = [
        _det_item(1, "02102000", "CHARQUE BOVINO PONTA DE AGULHA", "100.00", "12.00"),
        _det_item(2, "17019900", "ACUCAR CRISTAL BRANCO", "80.00", "12.00"),
        _det_item(3, "17019900", "ACUCAR CRISTAL REFINADO", "50.00", "7.00"),
    ]
    res = _processar(db_session, empresa, itens, "230.00")

    linhas = _linhas_controle(res)
    assert len(linhas) == 2
    assert linhas[0]["v_total"] == 180 and linhas[0]["a_ori"] == 0.12
    assert linhas[1]["v_total"] == 50 and linhas[1]["a_ori"] == 0.07
    assert not str(linhas[0]["nota"]).endswith("*")
    assert str(linhas[1]["nota"]).endswith("*")
