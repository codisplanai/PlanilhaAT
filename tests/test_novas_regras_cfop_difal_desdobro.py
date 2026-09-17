import io
import json
from decimal import Decimal
import openpyxl
import pytest

from app.services.pipeline_service import ProcessingPipelineService
from tests.conftest import build_xml_nfe


def _criar_planilha_auxiliar(registros: list, colunas: list = None) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(colunas or ["Chave de Acesso", "Número Nota", "Série", "Data Entrada", "CFOP"])
    for r in registros:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_cfop_6949_detectado_e_decisao_revenda_vai_para_parcial(db_session, cenario_janeiro):
    """CFOP 6949 com decisão de revenda = True é direcionado para Antecipação Parcial."""
    sol = cenario_janeiro(tipos=("antecipacao_parcial", "difal"))
    service = ProcessingPipelineService(db_session)

    xml_6949 = build_xml_nfe("9491", "35260198765432000180550010000094911000009491", "1500.00", "180.00", cfop="6949")

    # 1. Pré-análise detecta 6949 como pendência de destinação
    res_pre = service.pre_analisar(
        solicitacao_id=sol.id,
        xml_files_bytes=[("9491.xml", xml_6949)],
    )
    assert res_pre["requer_decisao"] is True
    assert len(res_pre["notas_bonificacao"]) == 1
    assert "6949" in res_pre["notas_bonificacao"][0]["cfops"]

    # 2. Processar com revenda = True -> Vai para Parcial
    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        xml_files_bytes=[("9491.xml", xml_6949)],
        decisoes_bonificacao={"35260198765432000180550010000094911000009491": True},
    )
    db_session.refresh(res)
    assert res.total_notas_processadas == 1
    assert len(res.notas_processadas) == 1
    nota = res.notas_processadas[0]
    assert nota.numero_nota == "9491"
    assert nota.destino_planilha == "antecipacao_parcial"


def test_cfop_6949_decisao_nao_revenda_vai_para_difal(db_session, cenario_janeiro):
    """CFOP 6949 com decisão de revenda = False é direcionado para DIFAL (uso/consumo)."""
    sol = cenario_janeiro(tipos=("antecipacao_parcial", "difal"))
    service = ProcessingPipelineService(db_session)

    xml_6949 = build_xml_nfe("9492", "35260198765432000180550010000094921000009492", "2000.00", "240.00", cfop="6949")

    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        xml_files_bytes=[("9492.xml", xml_6949)],
        decisoes_bonificacao={"35260198765432000180550010000094921000009492": False},
    )
    db_session.refresh(res)
    assert res.total_notas_processadas == 1
    assert len(res.notas_processadas) == 1
    nota = res.notas_processadas[0]
    assert nota.numero_nota == "9492"
    assert nota.destino_planilha == "difal"


def test_sped_precedencia_cfop_2556_2407_2551_sobre_xml(db_session, cenario_janeiro):
    """
    CFOP 2556, 2407 e 2551 registrados no SPED têm precedência sobre o CFOP do XML (ex: 6101).
    A nota/item é direcionada imediatamente para o DIFAL.
    """
    sol = cenario_janeiro(tipos=("antecipacao_parcial", "difal"))
    service = ProcessingPipelineService(db_session)

    chave_2556 = "35260198765432000180550010000025561000002556"
    # XML emitente vem como 6101 (venda do fornecedor)
    xml_fornecedor = build_xml_nfe("2556", chave_2556, "3000.00", "360.00", cfop="6101")

    # SPED do destinatário escritura como 2556 (Compra de material para uso ou consumo)
    sped_com_2556 = f"""|0000|014|0|01012026|31012026|CLIENTE CONTABILIDADE BAHIA LTDA|12345678000195|BA|123456789|2927408|||A|1|
|0150|F1|FORNECEDOR SP LTDA|1058|98765432000180|||3550308||||
|0200|P1|MATERIAL DE USO E CONSUMO|||UN|01|84713012|||18,00||
|C100|0|1|F1|55|00|1|2556|{chave_2556}|10012026|20012026|3000,00|0|0,00|0,00|3000,00|0|0,00|0,00|0,00|3000,00|360,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|MATERIAL DE USO E CONSUMO|1,000|UN|3000,00|0,00|0|000|2556||3000,00|12,00|360,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
""".encode("utf-8")

    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        xml_files_bytes=[("2556.xml", xml_fornecedor)],
        sped_file_bytes=sped_com_2556,
    )
    db_session.refresh(res)

    assert res.total_notas_processadas == 1
    nota = res.notas_processadas[0]
    assert nota.numero_nota == "2556"
    assert nota.cfop == "2556"  # Precedência do SPED preservada!
    assert nota.destino_planilha == "difal"


def test_planilha_auxiliar_cfop_direciona_para_difal_sem_sped(db_session, cenario_janeiro):
    """
    Na ausência do SPED Fiscal, a coluna CFOP da Planilha Auxiliar contendo 2556 (ou 2407/2551)
    faz com que a nota seja roteada diretamente para o DIFAL.
    """
    sol = cenario_janeiro(tipos=("antecipacao_parcial", "difal"))
    service = ProcessingPipelineService(db_session)

    chave_aux = "35260198765432000180550010000077771000007777"
    # XML vem com 6102 (venda)
    xml_doc = build_xml_nfe("7777", chave_aux, "1200.00", "144.00", cfop="6102")

    # Planilha auxiliar contendo coluna CFOP com 2556
    planilha_bytes = _criar_planilha_auxiliar([
        [chave_aux, "7777", "1", "20/01/2026", "2556"]
    ])

    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        xml_files_bytes=[("7777.xml", xml_doc)],
        planilha_entradas_bytes=planilha_bytes,
        planilha_entradas_filename="entradas.xlsx",
    )
    db_session.refresh(res)

    assert res.total_notas_processadas == 1
    nota = res.notas_processadas[0]
    assert nota.numero_nota == "7777"
    assert nota.cfop == "2556"
    assert nota.destino_planilha == "difal"


def test_desdobramento_nota_adiciona_asterisco_nas_linhas_subsequentes(db_session, cenario_janeiro):
    """
    Quando uma nota fiscal é desdobrada em mais de uma linha na mesma planilha (ex: alíquotas de 7% e 4%),
    a primeira linha recebe o número normal (ex: 01111) e as linhas seguintes recebem o asterisco (ex: 01111*).
    """
    sol = cenario_janeiro(tipos=("antecipacao_parcial",))
    service = ProcessingPipelineService(db_session)

    # XML com dois itens que possuem alíquotas diferentes (item 1 a 12%, item 2 a 4%)
    xml_desdobrada = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35260198765432000180550010000011111000001111" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA MERCADORIA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>01111</nNF>
        <dhEmi>2026-01-15T10:00:00-03:00</dhEmi>
        <tpNF>1</tpNF>
      </ide>
      <emit>
        <CNPJ>98765432000180</CNPJ>
        <xNome>FORNECEDOR SP LTDA</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>CLIENTE CONTABILIDADE BAHIA LTDA</xNome>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>P1</cProd>
          <xProd>PRODUTO ALIQUOTA 12</xProd>
          <NCM>21069090</NCM>
          <CFOP>6102</CFOP>
          <vProd>1000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <modBC>3</modBC>
              <vBC>1000.00</vBC>
              <pICMS>12.00</pICMS>
              <vICMS>120.00</vICMS>
            </ICMS00>
          </ICMS>
        </imposto>
      </det>
      <det nItem="2">
        <prod>
          <cProd>P2</cProd>
          <xProd>PRODUTO ALIQUOTA 4 IMPORTADO</xProd>
          <NCM>21069090</NCM>
          <CFOP>6102</CFOP>
          <vProd>2000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>1</orig>
              <CST>00</CST>
              <modBC>3</modBC>
              <vBC>2000.00</vBC>
              <pICMS>4.00</pICMS>
              <vICMS>80.00</vICMS>
            </ICMS00>
          </ICMS>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vBC>3000.00</vBC>
          <vICMS>200.00</vICMS>
          <vProd>3000.00</vProd>
          <vNF>3000.00</vNF>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vIPI>0.00</vIPI>
          <vOutro>0.00</vOutro>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>
""".encode("utf-8")

    res = service.process_solicitacao(
        solicitacao_id=sol.id,
        xml_files_bytes=[("01111.xml", xml_desdobrada)],
    )
    db_session.refresh(res)

    assert res.total_notas_processadas == 2
    notas = sorted(res.notas_processadas, key=lambda n: n.item_numero)
    assert len(notas) == 2

    # No banco de dados, o número da nota permanece limpo '01111'
    assert notas[0].numero_nota == "01111"
    assert notas[1].numero_nota == "01111"
    assert notas[0].item_numero == 1
    assert notas[1].item_numero == 2

    # Na conversão para linha da planilha Excel (processed_note_to_row), a 2ª linha ganha o '*'
    from app.services.pipeline_outputs import processed_note_to_row
    row_1 = processed_note_to_row(notas[0])
    row_2 = processed_note_to_row(notas[1])

    assert row_1["numero_nota"] == "01111"
    assert row_2["numero_nota"] == "01111*"
