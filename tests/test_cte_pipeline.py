import os
from datetime import date
from decimal import Decimal

import openpyxl
import pytest

from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
)
from app.core.seeds import seed_default_templates
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.models.solicitacao import Solicitacao
from app.services.extraction.base import extrair_numero_serie_chave_nfe
from app.services.extraction.cte_xml_extractor import CTeXMLExtractor
from app.services.pipeline_service import ProcessingPipelineService
from tests.conftest import build_sped_entradas, build_xml_nfe, chave_nfe

CNPJ_EMPRESA = "12345678000195"
CNPJ_FORNECEDOR = "98765432000180"
CNPJ_TRANSPORTADORA = "11222333000181"


def chave_cte(aamm: str, numero: int) -> str:
    return f"35{aamm}{CNPJ_TRANSPORTADORA}57001{numero:09d}1{numero:08d}0"


def build_xml_cte(
    *,
    numero: str,
    chave: str,
    v_tprest: str,
    dia: str = "15",
    mes: str = "01",
    ano: str = "2026",
    toma: str = "3",
    cnpj_tomador_toma4: str = "",
    cnpj_rem: str = CNPJ_FORNECEDOR,
    cnpj_dest: str = CNPJ_EMPRESA,
    uf_emit: str = "SP",
    uf_ini: str = "SP",
    c_uf: str = "35",
    cfop: str = "6352",
    p_icms: str = "12.00",
    icms_tag: str = "ICMS00",
    crt: str = "3",
    chaves_nfe: list[str] | None = None,
) -> bytes:
    toma_xml = (
        f"<toma4><toma>4</toma><CNPJ>{cnpj_tomador_toma4}</CNPJ></toma4>"
        if toma == "4"
        else f"<toma3><toma>{toma}</toma></toma3>"
    )
    if icms_tag == "ICMSSN":
        icms_inner = "<ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN>"
    elif p_icms and Decimal(p_icms) > Decimal("0.00"):
        icms_inner = (
            f"<{icms_tag}><CST>00</CST><vBC>{v_tprest}</vBC>"
            f"<pICMS>{p_icms}</pICMS><vICMS>{Decimal(v_tprest) * Decimal(p_icms) / 100:.2f}</vICMS></{icms_tag}>"
        )
    else:
        icms_inner = f"<{icms_tag}><CST>40</CST></{icms_tag}>"

    nfes_xml = "".join(
        f"<infNFe><chave>{chv}</chave></infNFe>" for chv in (chaves_nfe or [])
    )
    ender_emit_xml = f"<enderEmit><UF>{uf_emit}</UF></enderEmit>" if uf_emit else ""

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe{chave}" versao="4.00">
      <ide>
        <cUF>{c_uf}</cUF>
        <nCT>{numero}</nCT>
        <serie>1</serie>
        <CFOP>{cfop}</CFOP>
        <dhEmi>{ano}-{mes}-{dia}T10:00:00-03:00</dhEmi>
        <UFIni>{uf_ini}</UFIni>
        <UFFim>BA</UFFim>
        {toma_xml}
      </ide>
      <emit>
        <CNPJ>{CNPJ_TRANSPORTADORA}</CNPJ>
        <xNome>TRANSPORTADORA TESTE LTDA</xNome>
        <CRT>{crt}</CRT>
        {ender_emit_xml}
      </emit>
      <rem><CNPJ>{cnpj_rem}</CNPJ><enderReme><UF>{uf_ini}</UF></enderReme></rem>
      <dest><CNPJ>{cnpj_dest}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <vPrest><vTPrest>{v_tprest}</vTPrest><vRec>{v_tprest}</vRec></vPrest>
      <imp><ICMS>{icms_inner}</ICMS></imp>
      <infCTeNorm><infDoc>{nfes_xml}</infDoc></infCTeNorm>
    </infCte>
  </CTe>
</cteProc>""".encode("utf-8")


def _xml_nfe_mista(chave: str, numero: str, dia: str = "10", mes: str = "01", ano: str = "2026") -> bytes:
    """NF-e total 1000.00:
    - Item 1 (Tributária, CFOP 6403, NCM 73170090, CEST 1005700): vProd=500 + IPI=50 = 550.00 (55%)
    - Item 2 (DIFAL, CFOP 6556): vProd=200.00 (20%)
    - Item 3 (Parcial, CFOP 6102): vProd=250.00 (25%)
    """
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{chave}">
      <ide><nNF>{numero}</nNF><serie>1</serie><dhEmi>{ano}-{mes}-{dia}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>{CNPJ_FORNECEDOR}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>{CNPJ_EMPRESA}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>1000.00</vNF><vBC>950.00</vBC></ICMSTot></total>
      <det nItem="1">
        <prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO ACO</xProd>
          <vProd>500.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS><vICMS>60.00</vICMS></ICMS00></ICMS>
          <IPI><IPITrib><vIPI>50.00</vIPI></IPITrib></IPI>
        </imposto>
      </det>
      <det nItem="2">
        <prod><NCM>39269090</NCM><CFOP>6556</CFOP><xProd>MATERIAL CONSUMO</xProd>
          <vProd>200.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>200.00</vBC><pICMS>12.00</pICMS><vICMS>24.00</vICMS></ICMS00></ICMS>
        </imposto>
      </det>
      <det nItem="3">
        <prod><NCM>21069090</NCM><CFOP>6102</CFOP><xProd>MERCADORIA REVENDA</xProd>
          <vProd>250.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto>
          <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>250.00</vBC><pICMS>12.00</pICMS><vICMS>30.00</vICMS></ICMS00></ICMS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


def _setup_cenario_oficial(db_session, *, aliq_ba: str = "0.2050", simples: bool = False):
    seed_default_templates(db_session)
    perfil = PerfilRegras(nome="Perfil Oficial CT-e")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(
        RegraAliquotaDestino(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm=None,
            aliquota=Decimal(aliq_ba),
            descricao="BA",
        )
    )
    empresa = Empresa(
        razao_social="EMPRESA TESTE CTE LTDA",
        cnpj=CNPJ_EMPRESA,
        uf="BA",
        perfil_regras_id=perfil.id,
        optante_simples_nacional=simples,
    )
    db_session.add(empresa)
    db_session.commit()
    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha=None,
        status="pendente",
    )
    db_session.add(sol)
    db_session.commit()
    return sol, empresa, perfil


def test_cte_extractor_toma3_toma4_e_chave_nfe():
    chv_nfe_1 = chave_nfe("2601", 901)
    chv_nfe_2 = chave_nfe("2601", 902)
    chv_cte_1 = chave_cte("2601", 15420)

    xml_1 = build_xml_cte(
        numero="15420",
        chave=chv_cte_1,
        v_tprest="350.00",
        toma="3",
        p_icms="12.00",
        chaves_nfe=[chv_nfe_1, chv_nfe_2],
    )
    extractor = CTeXMLExtractor()
    assert extractor.is_cte_xml(xml_1) is True
    data = extractor.extract_from_xml(xml_1)

    assert data.numero_cte == "15420"
    assert data.cnpj_tomador == CNPJ_EMPRESA
    assert data.v_total_cte == Decimal("350.00")
    assert data.a_ori == Decimal("0.12")
    assert data.a_ori_destacada is True
    assert data.fornecedor_simples_nacional is False
    assert data.chaves_nfe == [chv_nfe_1, chv_nfe_2]
    assert extrair_numero_serie_chave_nfe(chv_nfe_1) == ("901", "1")

    xml_toma4 = build_xml_cte(
        numero="15421",
        chave=chave_cte("2601", 15421),
        v_tprest="180.00",
        toma="4",
        cnpj_tomador_toma4="99888777000166",
        icms_tag="ICMSSN",
        crt="1",
        chaves_nfe=[chv_nfe_1],
    )
    data4 = extractor.extract_from_xml(xml_toma4)
    assert data4.cnpj_tomador == "99888777000166"
    assert data4.a_ori == Decimal("0.00")
    assert data4.a_ori_destacada is False
    assert data4.fornecedor_simples_nacional is True


def test_cte_ignorado_quando_tomador_nao_e_empresa(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=(ANTECIPACAO_PARCIAL, DIFAL))
    chv_nf = chave_nfe("2601", 903)
    xml_nf = build_xml_nfe("903", chv_nf, "1000.00", "12", cfop="6556")
    # toma="0" -> tomador é o remetente (fornecedor SP), não a empresa
    xml_cte = build_xml_cte(
        numero="500",
        chave=chave_cte("2601", 500),
        v_tprest="200.00",
        toma="0",
        chaves_nfe=[chv_nf],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("903.xml", xml_nf), ("cte500.xml", xml_cte)],
    )
    db_session.refresh(res)

    assert len(res.notas_processadas) == 1
    assert res.notas_processadas[0].numero_nota == "903"
    assert any(
        n["numero_nota"] == "500" and "tomador do serviço" in n["motivo"]
        for n in (res.notas_ignoradas or [])
    )


def test_cte_tributaria_herda_maior_mva_e_reducao_e_aori_vazia_no_excel(db_session):
    sol, _emp, perfil = _setup_cenario_oficial(db_session)
    db_session.add(
        RegraReducaoProduto(
            perfil_regras_id=perfil.id,
            ncm="7317",
            termos_inclusao=[],
            termos_exclusao=[],
            aliquota=Decimal("0.41463"),
            escopo="antecipacao_tributaria",
            descricao="Art. 266, II",
        )
    )
    db_session.commit()

    chv_nf = chave_nfe("2601", 701)
    # 2 itens de Antecipação Tributária:
    # - Item 1: NCM 73089010 (MVA ajustada 12% = 49.43%)
    # - Item 2: NCM 73170090 + CEST 1005700 (MVA ajustada 12% = 45.00% ou NCM 73083000 = 60.50%)
    # Vamos usar 73089010 (MVA 49.43%) e 73170090 (MVA 45.00%) -> maior MVA = 49.43%
    # ou dar redução no 73089010 para testar herança do maior MVA + sua redução!
    db_session.add(
        RegraReducaoProduto(
            perfil_regras_id=perfil.id,
            ncm="73089010",
            termos_inclusao=[],
            termos_exclusao=[],
            aliquota=Decimal("0.41463"),
            escopo="antecipacao_tributaria",
            descricao="Reducao maior MVA",
        )
    )
    db_session.commit()

    xml_nf = f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{chv_nf}">
      <ide><nNF>701</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>{CNPJ_FORNECEDOR}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>{CNPJ_EMPRESA}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>2000.00</vNF><vBC>2000.00</vBC></ICMSTot></total>
      <det nItem="1">
        <prod><NCM>73170090</NCM><CEST>1005700</CEST><CFOP>6403</CFOP><xProd>PREGO</xProd>
          <vProd>1000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
      <det nItem="2">
        <prod><NCM>73089010</NCM><CEST>1004100</CEST><CFOP>6403</CFOP><xProd>BARRA</xProd>
          <vProd>1000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")

    # CT-e sem pICMS destacado (CST 40 isento / sem destaque) -> A.ORI deve ficar em branco no Excel!
    xml_cte = build_xml_cte(
        numero="15420",
        chave=chave_cte("2601", 15420),
        v_tprest="400.00",
        toma="3",
        p_icms="0.00",
        chaves_nfe=[chv_nf],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("701.xml", xml_nf), ("cte15420.xml", xml_cte)],
    )
    db_session.refresh(res)

    cte_proc = next(n for n in res.notas_processadas if n.numero_nota == "15420")
    assert cte_proc.destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert cte_proc.v_total == Decimal("400.00")
    assert cte_proc.a_ori == Decimal("0.00")
    assert cte_proc.metadados_extras["tipo_documento"] == "cte"
    assert cte_proc.metadados_extras["a_ori_destacada"] is False
    # Maior MVA entre 45.00% (73170090) e 49.43% (73089010)
    assert Decimal(str(cte_proc.metadados_extras["mva"])) == Decimal("49.43")
    assert cte_proc.metadados_extras["reducao"] == "0.41463"

    saida_trib = next(s for s in res.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    assert os.path.exists(saida_trib.arquivo_path)
    wb = openpyxl.load_workbook(saida_trib.arquivo_path, data_only=False)
    ws = wb.active
    # Encontrar a linha do CT-e 15420
    cte_row = next(r for r in range(4, 20) if ws[f"D{r}"].value == "15420")
    assert ws[f"E{cte_row}"].value == 400.00
    assert ws[f"H{cte_row}"].value == 49.43
    assert ws[f"I{cte_row}"].value == pytest.approx(41.463, rel=1e-4)
    assert ws[f"K{cte_row}"].value is None  # A.ORI em branco quando não há no CT-e


def test_cte_rateio_misto_tributaria_difal_e_parcial_com_ipi(db_session):
    sol, _emp, _perfil = _setup_cenario_oficial(db_session)
    chv_nf = chave_nfe("2601", 801)
    xml_nf = _xml_nfe_mista(chv_nf, "801")
    xml_cte = build_xml_cte(
        numero="9001",
        chave=chave_cte("2601", 9001),
        v_tprest="300.00",
        toma="3",
        p_icms="12.00",
        chaves_nfe=[chv_nf],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("801.xml", xml_nf), ("cte9001.xml", xml_cte)],
    )
    db_session.refresh(res)

    ctes_proc = [n for n in res.notas_processadas if n.metadados_extras.get("tipo_documento") == "cte"]
    por_destino = {n.destino_planilha: n for n in ctes_proc}

    assert set(por_destino.keys()) == {ANTECIPACAO_TRIBUTARIA, DIFAL}
    assert ANTECIPACAO_PARCIAL not in por_destino

    cte_trib = por_destino[ANTECIPACAO_TRIBUTARIA]
    # 550 / 1000 * 300 = 165.00
    assert cte_trib.v_total == Decimal("165.00")
    assert cte_trib.a_ori == Decimal("0.12")
    assert Decimal(str(cte_trib.metadados_extras["mva"])) == Decimal("45")

    cte_difal = por_destino[DIFAL]
    # 200 / 1000 * 300 = 60.00
    assert cte_difal.v_total == Decimal("60.00")
    assert cte_difal.a_ori == Decimal("0.12")


def test_cte_sem_nfe_originaria_na_pre_analise_e_no_processamento(db_session, cenario_janeiro):
    sol = cenario_janeiro(tipos=(ANTECIPACAO_PARCIAL, ANTECIPACAO_TRIBUTARIA, DIFAL))
    chv_faltante = chave_nfe("2601", 999)
    chv_outra = chave_nfe("2601", 901)
    xml_outra = build_xml_nfe("901", chv_outra, "1000.00", "10", cfop="6102")
    xml_cte = build_xml_cte(
        numero="1200",
        chave=chave_cte("2601", 1200),
        v_tprest="250.00",
        toma="3",
        chaves_nfe=[chv_faltante],
    )

    service = ProcessingPipelineService(db_session)
    pre = service.pre_analisar(
        solicitacao_id=sol.id,
        xml_files_bytes=[("901.xml", xml_outra), ("cte1200.xml", xml_cte)],
    )
    assert pre["requer_decisao"] is True
    assert len(pre["ctes_sem_nfe"]) == 1
    assert pre["ctes_sem_nfe"][0]["cte_numero"] == "1200"
    assert pre["ctes_sem_nfe"][0]["nfes_faltantes"][0]["chave_acesso"] == chv_faltante
    assert pre["ctes_sem_nfe"][0]["nfes_faltantes"][0]["numero_nota"] == "999"

    res = service.process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_outra), ("cte1200.xml", xml_cte)],
    )
    db_session.refresh(res)
    assert any("999" in a["aviso"] and chv_faltante in a["aviso"] for a in (res.avisos_avaliacao or []))
    assert any(n["numero_nota"] == "1200" and chv_faltante in n["motivo"] for n in (res.notas_ignoradas or []))


def test_cte_nfe_de_periodo_anterior_serve_apenas_como_base_sem_gerar_linha_propria(db_session):
    sol, _emp, _perfil = _setup_cenario_oficial(db_session)
    # NF-e emitida em dezembro/2025 (fora do período de janeiro/2026)
    chv_nf_dez = chave_nfe("2512", 400)
    xml_nf_dez = build_xml_nfe("400", chv_nf_dez, "1000.00", "28", cfop="6403", ncm="73170090", mes="12", ano="2025")
    # CT-e emitido em janeiro/2026 vinculando a NF-e de dezembro/2025
    xml_cte_jan = build_xml_cte(
        numero="15500",
        chave=chave_cte("2601", 15500),
        v_tprest="200.00",
        dia="05",
        mes="01",
        ano="2026",
        toma="3",
        p_icms="12.00",
        chaves_nfe=[chv_nf_dez],
    )

    service = ProcessingPipelineService(db_session)
    pre = service.pre_analisar(
        solicitacao_id=sol.id,
        xml_files_bytes=[("nf400_dez.xml", xml_nf_dez), ("cte15500.xml", xml_cte_jan)],
    )
    assert pre["ctes_sem_nfe"] == []

    res = service.process_solicitacao(
        sol.id,
        xml_files_bytes=[("nf400_dez.xml", xml_nf_dez), ("cte15500.xml", xml_cte_jan)],
    )
    db_session.refresh(res)

    assert len(res.notas_processadas) == 1
    assert res.notas_processadas[0].numero_nota == "15500"
    assert res.notas_processadas[0].destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert res.notas_processadas[0].v_total == Decimal("200.00")
    assert (res.notas_ignoradas or []) == []


def test_cte_data_entrada_via_sped_d100_e_heranca_da_nfe(db_session):
    sol, _emp, _perfil = _setup_cenario_oficial(db_session)
    chv_nf_com_entrada = chave_nfe("2601", 501)
    chv_nf_sem_entrada = chave_nfe("2601", 502)
    chv_cte_d100 = chave_cte("2601", 2001)
    chv_cte_herda = chave_cte("2601", 2002)
    chv_cte_antecipado = chave_cte("2601", 2003)

    xml_nf1 = build_xml_nfe("501", chv_nf_com_entrada, "1000.00", "10", cfop="6403", ncm="73170090")
    xml_nf2 = build_xml_nfe("502", chv_nf_sem_entrada, "1000.00", "25", cfop="6403", ncm="73170090")

    # CT-e 2001 vinculado à NF 501, mas com sua própria data no D100 (18/01/2026)
    xml_cte1 = build_xml_cte(numero="2001", chave=chv_cte_d100, v_tprest="100.00", chaves_nfe=[chv_nf_com_entrada])
    # CT-e 2002 vinculado à NF 501, sem D100 -> herda 15/01/2026 da NF 501
    xml_cte2 = build_xml_cte(numero="2002", chave=chv_cte_herda, v_tprest="120.00", chaves_nfe=[chv_nf_com_entrada])
    # CT-e 2003 vinculado à NF 502 (sem entrada no SPED), sem D100 -> vai para Pago Antecipadamente
    xml_cte3 = build_xml_cte(numero="2003", chave=chv_cte_antecipado, v_tprest="150.00", chaves_nfe=[chv_nf_sem_entrada])

    sped_lines = [
        f"|0000|019|0|01012026|31012026|Cliente BA|{CNPJ_EMPRESA}||BA|123|2927408|||A|1|",
        f"|0150|F1|FORNECEDOR SP|1058|{CNPJ_FORNECEDOR}||SP|3550308||R|1||C|",
        f"|0150|T1|TRANSPORTADORA|1058|{CNPJ_TRANSPORTADORA}||SP|3550308||R|1||C|",
        "|0200|P1|PREGO|||UN|01|73170090|||18,00||",
        f"|C100|0|1|F1|55|00|1|501|{chv_nf_com_entrada}|10012026|15012026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|120,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|",
        "|C170|1|P1|PREGO|1,000|UN|1000,00|0,00|0|000|6403||1000,00|12,00|120,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|",
        f"|D100|0|1|T1|57|00|1||2001|{chv_cte_d100}|15012026|18012026|0||100,00|0|0,00|100,00|0,00|100,00|12,00|0,00|||",
        "|9999|8|",
    ]
    sped_bytes = ("\n".join(sped_lines) + "\n").encode("utf-8")

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[
            ("501.xml", xml_nf1),
            ("502.xml", xml_nf2),
            ("cte2001.xml", xml_cte1),
            ("cte2002.xml", xml_cte2),
            ("cte2003.xml", xml_cte3),
        ],
        sped_file_bytes=sped_bytes,
    )
    db_session.refresh(res)

    por_cte = {n.numero_nota: n for n in res.notas_processadas if n.metadados_extras.get("tipo_documento") == "cte"}
    assert por_cte["2001"].destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert por_cte["2001"].data_entrada == date(2026, 1, 18)

    assert por_cte["2002"].destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert por_cte["2002"].data_entrada == date(2026, 1, 15)

    assert por_cte["2003"].destino_planilha == ANTECIPACAO_TRIBUTARIA_ANTECIPADO
    assert por_cte["2003"].data_entrada is None


def test_cte_100_por_cento_difal_simples_sem_picms_celula_aori_vazia(db_session):
    sol, _emp, _perfil = _setup_cenario_oficial(db_session)
    chv_nf = chave_nfe("2601", 601)
    xml_nf = build_xml_nfe("601", chv_nf, "1000.00", "10", cfop="6556")
    xml_cte = build_xml_cte(
        numero="3300",
        chave=chave_cte("2601", 3300),
        v_tprest="250.00",
        toma="3",
        icms_tag="ICMSSN",
        crt="1",
        chaves_nfe=[chv_nf],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("601.xml", xml_nf), ("cte3300.xml", xml_cte)],
    )
    db_session.refresh(res)

    cte_proc = next(n for n in res.notas_processadas if n.numero_nota == "3300")
    assert cte_proc.destino_planilha == DIFAL
    assert cte_proc.v_total == Decimal("250.00")
    assert cte_proc.a_ori == Decimal("0.00")
    assert cte_proc.metadados_extras["aliq_simples"] == "S"
    assert cte_proc.metadados_extras["a_ori_destacada"] is False

    saida_difal = next(s for s in res.saidas if s.tipo == DIFAL)
    wb = openpyxl.load_workbook(saida_difal.arquivo_path, data_only=False)
    ws = wb.active
    cte_row = next(r for r in range(4, 20) if ws[f"D{r}"].value == "3300")
    assert ws[f"E{cte_row}"].value == 250.00
    assert ws[f"G{cte_row}"].value == "S"
    assert ws[f"J{cte_row}"].value is None


def test_cte_interno_mesma_uf_emitente_tomador_ignorado_na_pre_analise_e_processamento(db_session):
    sol, _emp, _perfil = _setup_cenario_oficial(db_session)
    chv_nf_sp = chave_nfe("2601", 610)
    chv_nf_faltante = chave_nfe("2601", 611)
    xml_nf_sp = build_xml_nfe("610", chv_nf_sp, "1000.00", "12", cfop="6403", ncm="73170090")

    # CT-e emitido na BA (mesma UF do tomador BA), mesmo que UFIni seja SP ou BA e mesmo com NF-e faltante
    xml_cte_interno_faltante = build_xml_cte(
        numero="4401",
        chave=f"292601{CNPJ_TRANSPORTADORA}570010000044011000044010",
        v_tprest="200.00",
        toma="3",
        uf_emit="",
        uf_ini="SP",
        c_uf="29",
        cfop="5352",
        chaves_nfe=[chv_nf_faltante],
    )
    xml_cte_interno_com_nf = build_xml_cte(
        numero="4402",
        chave=f"292601{CNPJ_TRANSPORTADORA}570010000044021000044020",
        v_tprest="300.00",
        toma="3",
        uf_emit="BA",
        uf_ini="BA",
        c_uf="29",
        cfop="5352",
        chaves_nfe=[chv_nf_sp],
    )

    service = ProcessingPipelineService(db_session)
    pre = service.pre_analisar(
        solicitacao_id=sol.id,
        xml_files_bytes=[
            ("610.xml", xml_nf_sp),
            ("cte4401.xml", xml_cte_interno_faltante),
            ("cte4402.xml", xml_cte_interno_com_nf),
        ],
    )
    assert pre["requer_decisao"] is False
    assert pre["ctes_sem_nfe"] == []

    res = service.process_solicitacao(
        sol.id,
        xml_files_bytes=[
            ("610.xml", xml_nf_sp),
            ("cte4401.xml", xml_cte_interno_faltante),
            ("cte4402.xml", xml_cte_interno_com_nf),
        ],
    )
    db_session.refresh(res)

    assert len(res.notas_processadas) == 1
    assert res.notas_processadas[0].numero_nota == "610"
    ignoradas_por_num = {n["numero_nota"]: n["motivo"] for n in (res.notas_ignoradas or [])}
    assert "Operação interna estadual desconsiderada" in ignoradas_por_num["4401"]
    assert "Operação interna estadual desconsiderada" in ignoradas_por_num["4402"]


def test_pre_analisar_rejeita_nfe_com_cnpj_destinatario_diferente_antes_de_pendencias(db_session):
    from app.core.exceptions import ValidationException

    sol, _emp, _perfil = _setup_cenario_oficial(db_session)
    chv_faltante = chave_nfe("2601", 999)
    xml_cte = build_xml_cte(
        numero="1200",
        chave=chave_cte("2601", 1200),
        v_tprest="250.00",
        toma="3",
        chaves_nfe=[chv_faltante],
    )
    xml_bonus = build_xml_nfe("901", chave_nfe("2601", 901), "500.00", "12", cfop="6910")
    xml_outro_dest = build_xml_nfe(
        "461118",
        chave_nfe("2601", 461118),
        "1000.00",
        "12",
        cfop="6102",
    ).replace(b"<CNPJ>12345678000195</CNPJ>", b"<CNPJ>14679062000186</CNPJ>")

    service = ProcessingPipelineService(db_session)
    with pytest.raises(ValidationException, match="não corresponde ao CNPJ da empresa selecionada"):
        service.pre_analisar(
            solicitacao_id=sol.id,
            xml_files_bytes=[
                ("cte1200.xml", xml_cte),
                ("901.xml", xml_bonus),
                ("461118.xml", xml_outro_dest),
            ],
        )



