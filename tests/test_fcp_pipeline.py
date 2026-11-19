from datetime import date, datetime
from decimal import Decimal

import openpyxl
import pytest

from app.api.endpoints.regras_fcp import (
    PRESET_BEBIDAS_BA_ALIQUOTAS,
    PRESET_BEBIDAS_BA_FCP,
)
from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
)
from app.core.config import settings
from app.core.exceptions import ValidationException
from app.core.seeds import seed_default_templates
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_fcp_produto import RegraFcpProduto
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.models.solicitacao import Solicitacao
from app.services.calculation.base import round_currency
from app.services.pipeline_service import ProcessingPipelineService
from app.services.validation.sanity_checker import SanityChecker
from tests.conftest import build_sped_entradas, chave_nfe
from tests.test_cte_pipeline import build_xml_cte, chave_cte

CNPJ_EMPRESA = "12345678000195"
CNPJ_FORNECEDOR = "98765432000180"


def _xml_nfe_itens(
    *,
    numero: str,
    chave: str,
    itens: list[dict],
    dia: str = "10",
    mes: str = "01",
    ano: str = "2026",
    v_st_nota: str = "0.00",
) -> bytes:
    total_nf = sum((Decimal(it["v_prod"]) for it in itens), Decimal("0.00"))
    det_blocks = []
    for idx, it in enumerate(itens, start=1):
        cest_xml = f"<CEST>{it['cest']}</CEST>" if it.get("cest") else ""
        p_icms = it.get("p_icms", "12.00")
        v_prod = it["v_prod"]
        v_icms = f"{Decimal(v_prod) * Decimal(p_icms) / 100:.2f}"
        v_st_item = it.get("v_icms_st", "0.00")
        if Decimal(v_st_item) > 0:
            icms_xml = (
                f"<ICMS10><orig>0</orig><CST>10</CST><vBC>{v_prod}</vBC>"
                f"<pICMS>{p_icms}</pICMS><vICMS>{v_icms}</vICMS>"
                f"<vBCST>{v_prod}</vBCST><pICMSST>20.50</pICMSST>"
                f"<vICMSST>{v_st_item}</vICMSST></ICMS10>"
            )
        else:
            icms_xml = (
                f"<ICMS00><orig>0</orig><CST>00</CST><vBC>{v_prod}</vBC>"
                f"<pICMS>{p_icms}</pICMS><vICMS>{v_icms}</vICMS></ICMS00>"
            )
        det_blocks.append(
            f"""
      <det nItem="{idx}">
        <prod>
          <NCM>{it['ncm']}</NCM>
          {cest_xml}
          <CFOP>{it['cfop']}</CFOP>
          <xProd>{it['x_prod']}</xProd>
          <vProd>{v_prod}</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro>
          <vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS>{icms_xml}</ICMS>
        </imposto>
      </det>"""
        )

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{chave}">
      <ide><nNF>{numero}</nNF><serie>1</serie><dhEmi>{ano}-{mes}-{dia}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>{CNPJ_FORNECEDOR}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>{CNPJ_EMPRESA}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>{total_nf:.2f}</vNF><vBC>{total_nf:.2f}</vBC><vST>{v_st_nota}</vST></ICMSTot></total>
      {''.join(det_blocks)}
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


_PERFIL_SEQ = 0


def _setup_empresa_ba(
    db_session,
    *,
    simples: bool = False,
    preset_bebidas: bool = False,
    razao_social: str = "BEBIDAS BAHIA LTDA",
    configuracoes_extras: dict | None = None,
    aliq_padrao_ba: str = "0.2050",
) -> tuple[Solicitacao, Empresa, PerfilRegras]:
    global _PERFIL_SEQ
    _PERFIL_SEQ += 1
    seed_default_templates(db_session)
    perfil = PerfilRegras(
        nome=f"Perfil BA FCP {_PERFIL_SEQ}",
        configuracoes_extras=configuracoes_extras or {},
    )
    db_session.add(perfil)
    db_session.commit()

    db_session.add(
        RegraAliquotaDestino(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm=None,
            aliquota=Decimal(aliq_padrao_ba),
            descricao="Padrão BA",
        )
    )
    if preset_bebidas:
        for item in PRESET_BEBIDAS_BA_FCP:
            db_session.add(
                RegraFcpProduto(
                    perfil_regras_id=perfil.id,
                    uf="BA",
                    ncm=item["ncm"],
                    termos_inclusao=list(item["termos_inclusao"]),
                    termos_exclusao=list(item["termos_exclusao"]),
                    aliquota=Decimal("0.0200"),
                    aplicar_com_termo_acordo=True,
                    descricao=item["descricao"],
                )
            )
        for aliq_item in PRESET_BEBIDAS_BA_ALIQUOTAS:
            db_session.add(
                RegraAliquotaDestino(
                    perfil_regras_id=perfil.id,
                    uf="BA",
                    ncm=aliq_item["ncm"],
                    aliquota=Decimal("0.2500"),
                    descricao=aliq_item["descricao"],
                    parametros_extras={},
                )
            )

    empresa = Empresa(
        razao_social=razao_social,
        cnpj=CNPJ_EMPRESA,
        inscricao_estadual="83592715",
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


def test_at_regime_normal_bebidas_ba_gera_duas_abas_e_separa_fcp(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))
    sol, _emp, _perfil = _setup_empresa_ba(db_session, simples=False, preset_bebidas=True)

    chv = chave_nfe("2601", 101)
    xml_bytes = _xml_nfe_itens(
        numero="101",
        chave=chv,
        itens=[
            {
                "ncm": "22030000",
                "cest": "0302103",
                "cfop": "6403",
                "x_prod": "CERVEJA PILSEN 350ML",
                "v_prod": "1000.00",
            },
            {
                "ncm": "22021000",
                "cest": "0301001",
                "cfop": "6403",
                "x_prod": "REFRIGERANTE COLA 2L",
                "v_prod": "500.00",
            },
            {
                "ncm": "22011000",
                "cest": "0300500",
                "cfop": "6403",
                "x_prod": "AGUA MINERAL 500ML",
                "v_prod": "300.00",
            },
        ],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("101.xml", xml_bytes)],
    )
    db_session.refresh(res)

    assert len(res.notas_processadas) == 3
    por_ncm = {n.ncm: n for n in res.notas_processadas}

    cerveja = por_ncm["22030000"]
    assert cerveja.a_dst_resolvida == Decimal("0.2500")
    assert cerveja.metadados_extras["a_dst_base"] == "0.2500"
    assert cerveja.metadados_extras["fcp_aliquota"] == "0.0200"
    assert cerveja.metadados_extras["fcp_origem"].startswith("fcp_produto:")
    assert cerveja.metadados_extras["fcp_separado"] is True
    base_st_cerveja = Decimal(cerveja.metadados_extras["fcp_base_st"])
    assert cerveja.metadados_extras["fcp_valor_devido"] == str(
        round_currency(base_st_cerveja * Decimal("0.02"))
    )

    refri = por_ncm["22021000"]
    assert refri.a_dst_resolvida == Decimal("0.2050")
    assert refri.metadados_extras["fcp_separado"] is True
    assert refri.metadados_extras["fcp_aliquota"] == "0.0200"
    base_st_refri = Decimal(refri.metadados_extras["fcp_base_st"])
    assert refri.metadados_extras["fcp_valor_devido"] == str(
        round_currency(base_st_refri * Decimal("0.02"))
    )

    agua = por_ncm["22011000"]
    assert agua.a_dst_resolvida == Decimal("0.2050")
    assert agua.metadados_extras.get("fcp_aliquota") is None
    assert agua.metadados_extras.get("fcp_separado") is False

    saida = next(s for s in res.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    soma_icms_at = sum((n.valor_devido for n in res.notas_processadas), Decimal("0.00"))
    assert saida.total_valor_devido == soma_icms_at

    wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert wb.sheetnames == ["01-2026", "01-2026 FCP"]
    ws_main = wb["01-2026"]
    ws_fcp = wb["01-2026 FCP"]

    assert [ws_main[f"E{r}"].value for r in (4, 5, 6)] == [1000.0, 500.0, 300.0]
    assert [ws_main[f"J{r}"].value for r in (4, 5, 6)] == [25.0, 20.5, 20.5]
    assert ws_main["D7"].value is None

    assert [ws_fcp[f"E{r}"].value for r in (4, 5)] == [1000.0, 500.0]
    assert [ws_fcp[f"J{r}"].value for r in (4, 5)] == [2.0, 2.0]
    assert [ws_fcp[f"K{r}"].value for r in (4, 5)] == [0, 0]
    assert [ws_fcp[f"S{r}"].value for r in (4, 5)] == [0, 0]
    assert ws_fcp["D6"].value is None
    wb.close()


def test_at_regime_normal_nfe_mista_mesma_aliquota_base_separa_grupos(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))
    sol, _emp, _perfil = _setup_empresa_ba(db_session, simples=False, preset_bebidas=True)

    # Ambos com mesma A.DST base (20,5%), mesma A.ORI (12%), mesmo NCM/MVA (136,88% com CEST 0300700 vs 0300500)
    chv = chave_nfe("2601", 102)
    xml_bytes = _xml_nfe_itens(
        numero="102",
        chave=chv,
        itens=[
            {
                "ncm": "22021000",
                "cest": "0300700",
                "cfop": "6403",
                "x_prod": "REFRIGERANTE COLA 2L",
                "v_prod": "700.00",
            },
            {
                "ncm": "22011000",
                "cest": "0300500",
                "cfop": "6403",
                "x_prod": "AGUA MINERAL 500ML",
                "v_prod": "300.00",
            },
        ],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("102.xml", xml_bytes)],
    )
    db_session.refresh(res)

    assert len(res.notas_processadas) == 2
    saida = next(s for s in res.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert wb.sheetnames == ["01-2026", "01-2026 FCP"]

    ws_main = wb["01-2026"]
    assert ws_main["D4"].value == "102"
    assert ws_main["D5"].value == "102*"
    assert ws_main["J4"].value == 20.5
    assert ws_main["J5"].value == 20.5
    assert ws_main["D6"].value is None

    ws_fcp = wb["01-2026 FCP"]
    assert ws_fcp["D4"].value == "102"
    assert ws_fcp["E4"].value == 700.0
    assert ws_fcp["J4"].value == 2.0
    assert ws_fcp["K4"].value == 0
    assert ws_fcp["S4"].value == 0
    assert ws_fcp["D5"].value is None
    wb.close()


def test_at_antecipado_regime_normal_gera_aba_fcp_sem_data_entrada(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))
    sol, _emp, _perfil = _setup_empresa_ba(db_session, simples=False, preset_bebidas=True)

    chv_xml = chave_nfe("2601", 103)
    chv_sped = chave_nfe("2601", 990)
    xml_bytes = _xml_nfe_itens(
        numero="103",
        chave=chv_xml,
        itens=[
            {
                "ncm": "22030000",
                "cest": "0302103",
                "cfop": "6403",
                "x_prod": "CERVEJA LATA 350ML",
                "v_prod": "800.00",
            },
        ],
    )
    sped_bytes = build_sped_entradas(
        [
            {
                "numero": "990",
                "chave": chv_sped,
                "dt_doc": "05012026",
                "dt_entrada": "12012026",
                "itens": [("6102", "100,00")],
            }
        ]
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("103.xml", xml_bytes)],
        sped_file_bytes=sped_bytes,
    )
    db_session.refresh(res)

    notas_at = [
        n for n in res.notas_processadas
        if n.destino_planilha == ANTECIPACAO_TRIBUTARIA_ANTECIPADO
    ]
    assert len(notas_at) == 1
    assert notas_at[0].data_entrada is None
    assert notas_at[0].metadados_extras["fcp_separado"] is True

    saida = next(s for s in res.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA_ANTECIPADO)
    wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert wb.sheetnames == ["01-2026", "01-2026 FCP"]
    assert wb["01-2026"]["B4"].value is None
    assert wb["01-2026 FCP"]["B4"].value is None
    assert wb["01-2026 FCP"]["J4"].value == 2.0
    assert wb["01-2026 FCP"]["K4"].value == 0
    assert wb["01-2026 FCP"]["S4"].value == 0
    wb.close()


def test_at_simples_nacional_soma_fcp_na_a_dst_sem_aba_fcp(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))
    sol, _emp, _perfil = _setup_empresa_ba(db_session, simples=True, preset_bebidas=True)

    chv = chave_nfe("2601", 104)
    xml_bytes = _xml_nfe_itens(
        numero="104",
        chave=chv,
        itens=[
            {
                "ncm": "22030000",
                "cest": "0302103",
                "cfop": "6403",
                "x_prod": "CERVEJA PILSEN 350ML",
                "v_prod": "1000.00",
            },
            {
                "ncm": "22021000",
                "cest": "0301001",
                "cfop": "6403",
                "x_prod": "REFRIGERANTE COLA 2L",
                "v_prod": "500.00",
            },
            {
                "ncm": "22011000",
                "cest": "0300500",
                "cfop": "6403",
                "x_prod": "AGUA MINERAL 500ML",
                "v_prod": "200.00",
            },
        ],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("104.xml", xml_bytes)],
    )
    db_session.refresh(res)

    por_ncm = {n.ncm: n for n in res.notas_processadas}
    assert por_ncm["22030000"].a_dst_resolvida == Decimal("0.2700")
    assert por_ncm["22030000"].metadados_extras["a_dst_base"] == "0.2500"
    assert por_ncm["22030000"].metadados_extras["fcp_aliquota"] == "0.0200"
    assert por_ncm["22030000"].metadados_extras["fcp_separado"] is False

    assert por_ncm["22021000"].a_dst_resolvida == Decimal("0.2250")
    assert por_ncm["22021000"].metadados_extras["fcp_separado"] is False

    assert por_ncm["22011000"].a_dst_resolvida == Decimal("0.2050")
    assert por_ncm["22011000"].metadados_extras.get("fcp_aliquota") is None
    assert por_ncm["22011000"].metadados_extras["fcp_separado"] is False

    saida = next(s for s in res.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert wb.sheetnames == ["01-2026"]
    wb.close()


def test_parcial_e_difal_somam_fcp_e_respeitam_aliquotas_iguais_e_termo_acordo(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))
    sol, empresa, perfil = _setup_empresa_ba(
        db_session,
        simples=False,
        preset_bebidas=False,
        configuracoes_extras={
            "politica_aliquotas_iguais_parcial": {"BA": True},
        },
        aliq_padrao_ba="0.2050",
    )

    # Termo de acordo 12% na Parcial
    db_session.add(
        RegraAliquotaEmpresa(
            empresa_id=empresa.id,
            aliquota=Decimal("0.1200"),
            descricao="Termo 12%",
        )
    )
    # Regra FCP que aplica COM termo de acordo (22021000)
    db_session.add(
        RegraFcpProduto(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm="22021000",
            termos_inclusao=["REFRIGERANTE"],
            termos_exclusao=[],
            aliquota=Decimal("0.0200"),
            aplicar_com_termo_acordo=True,
            descricao="FCP Refri 2%",
        )
    )
    # Regra FCP que NÃO aplica com termo de acordo (2203)
    db_session.add(
        RegraFcpProduto(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm="2203",
            termos_inclusao=[],
            termos_exclusao=[],
            aliquota=Decimal("0.0200"),
            aplicar_com_termo_acordo=False,
            descricao="FCP Cerveja sem termo",
        )
    )
    db_session.commit()

    chv = chave_nfe("2601", 105)
    xml_bytes = _xml_nfe_itens(
        numero="105",
        chave=chv,
        itens=[
            # Parcial: A.ORI=12%, Termo=12% + FCP=2% -> A.DST=14% (não excluído por alíquotas iguais)
            {
                "ncm": "22021000",
                "cfop": "6102",
                "x_prod": "REFRIGERANTE COLA 2L",
                "v_prod": "1000.00",
            },
            # Parcial: FCP regra tem aplicar_com_termo_acordo=False -> ignorada -> A.DST=12% == A.ORI=12% -> excluído!
            {
                "ncm": "22030000",
                "cfop": "6102",
                "x_prod": "CERVEJA PILSEN 350ML",
                "v_prod": "500.00",
            },
            # DIFAL (6556): ignora termo de acordo e soma BA padrão 20,5% + FCP 2% = 22,5%
            {
                "ncm": "22021000",
                "cfop": "6556",
                "x_prod": "REFRIGERANTE CONSUMO",
                "v_prod": "400.00",
            },
        ],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("105.xml", xml_bytes)],
    )
    db_session.refresh(res)

    por_destino = {n.destino_planilha: n for n in res.notas_processadas}
    assert set(por_destino.keys()) == {ANTECIPACAO_PARCIAL, DIFAL}

    parcial = por_destino[ANTECIPACAO_PARCIAL]
    assert parcial.ncm == "22021000"
    assert parcial.a_dst_resolvida == Decimal("0.1400")
    assert parcial.a_ori == Decimal("0.1200")
    assert parcial.metadados_extras["a_dst_base"] == "0.1200"
    assert parcial.metadados_extras["fcp_aliquota"] == "0.0200"
    assert parcial.metadados_extras["fcp_separado"] is False

    # Cerveja 22030000 (Parcial sem FCP por termo de acordo) foi excluída por alíquotas iguais
    assert any(
        ex["ncm"] == "22030000" and ex["tipo_exclusao"] == "aliquotas_iguais"
        for ex in (res.itens_excluidos or [])
    )

    difal = por_destino[DIFAL]
    assert difal.a_dst_resolvida == Decimal("0.2250")
    assert difal.metadados_extras["a_dst_base"] == "0.2050"
    assert difal.metadados_extras["fcp_aliquota"] == "0.0200"
    assert difal.metadados_extras["fcp_separado"] is False

    # Nenhuma saída gerou aba FCP
    for saida in res.saidas:
        wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
        assert len(wb.sheetnames) == 1
        assert not any("FCP" in s for s in wb.sheetnames)
        wb.close()

    # Limitar A.ORI a 10% olha origem base (padrao_uf não limita, mesmo com FCP)
    empresa.cnpj = "99888777000166"
    db_session.commit()
    sol_lim, _emp_lim, perfil_lim = _setup_empresa_ba(
        db_session,
        simples=False,
        preset_bebidas=True,
        configuracoes_extras={"limitar_a_ori_reducoes": True},
        aliq_padrao_ba="0.2050",
    )
    xml_lim = _xml_nfe_itens(
        numero="106",
        chave=chave_nfe("2601", 106),
        itens=[
            {
                "ncm": "22021000",
                "cfop": "6102",
                "x_prod": "REFRIGERANTE COLA 2L",
                "v_prod": "1000.00",
            },
        ],
    )
    res_lim = ProcessingPipelineService(db_session).process_solicitacao(
        sol_lim.id,
        xml_files_bytes=[("106.xml", xml_lim)],
    )
    db_session.refresh(res_lim)
    n_lim = res_lim.notas_processadas[0]
    assert n_lim.a_dst_resolvida == Decimal("0.2250")
    assert n_lim.a_ori == Decimal("0.1200")
    assert n_lim.metadados_extras["a_ori_limitada"] is False


def test_cte_at_acompanha_fcp_regime_normal_e_simples(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))

    # --- Parte A: Regime Normal ---
    sol_norm, _emp_norm, _perfil_norm = _setup_empresa_ba(
        db_session, simples=False, preset_bebidas=True
    )
    chv_nf_norm = chave_nfe("2601", 201)
    xml_nf_norm = _xml_nfe_itens(
        numero="201",
        chave=chv_nf_norm,
        itens=[
            {
                "ncm": "22030000",
                "cest": "0302103",
                "cfop": "6403",
                "x_prod": "CERVEJA PILSEN 350ML",
                "v_prod": "500.00",
            },
            {
                "ncm": "73170090",
                "cest": "1005700",
                "cfop": "6403",
                "x_prod": "PREGO ACO",
                "v_prod": "500.00",
            },
        ],
    )
    xml_cte_norm = build_xml_cte(
        numero="15420",
        chave=chave_cte("2601", 15420),
        v_tprest="200.00",
        toma="3",
        p_icms="12.00",
        chaves_nfe=[chv_nf_norm],
    )

    service = ProcessingPipelineService(db_session)
    res_norm = service.process_solicitacao(
        sol_norm.id,
        xml_files_bytes=[("201.xml", xml_nf_norm), ("cte15420.xml", xml_cte_norm)],
    )
    db_session.refresh(res_norm)

    cte_norm = next(
        n for n in res_norm.notas_processadas
        if n.metadados_extras.get("tipo_documento") == "cte"
    )
    assert cte_norm.v_total == Decimal("200.00")
    assert cte_norm.a_dst_resolvida == Decimal("0.2050")
    assert cte_norm.metadados_extras["fcp_separado"] is True
    assert cte_norm.metadados_extras["fcp_aliquota"] == "0.0200"
    assert Decimal(cte_norm.metadados_extras["fcp_cte_v_total"]) == Decimal("100.00")
    assert Decimal(cte_norm.metadados_extras["fcp_cte_mva"]) == Decimal("189.32")
    assert cte_norm.metadados_extras["fcp_cte_reducao"] is None
    assert Decimal(cte_norm.metadados_extras["fcp_percentual_rateio"]) == Decimal("50.0000")

    saida_norm = next(s for s in res_norm.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    wb_norm = openpyxl.load_workbook(saida_norm.arquivo_path, data_only=False)
    assert wb_norm.sheetnames == ["01-2026", "01-2026 FCP"]
    ws_fcp_norm = wb_norm["01-2026 FCP"]
    cte_fcp_row = next(r for r in range(4, 15) if ws_fcp_norm[f"D{r}"].value == "15420")
    assert ws_fcp_norm[f"E{cte_fcp_row}"].value == 100.0
    assert ws_fcp_norm[f"H{cte_fcp_row}"].value == 189.32
    assert ws_fcp_norm[f"J{cte_fcp_row}"].value == 2.0
    assert ws_fcp_norm[f"K{cte_fcp_row}"].value == 0
    assert ws_fcp_norm[f"S{cte_fcp_row}"].value == 0
    wb_norm.close()

    # Editar data_entrada e regenerar: ambas as abas refletem a nova data
    cte_norm.data_entrada = date(2026, 1, 22)
    cte_norm.origem_data_entrada = "manual"
    db_session.commit()
    service.regenerate_outputs(res_norm)
    db_session.refresh(saida_norm)

    wb_reg = openpyxl.load_workbook(saida_norm.arquivo_path, data_only=False)
    for sheet_name in ("01-2026", "01-2026 FCP"):
        ws = wb_reg[sheet_name]
        row_idx = next(r for r in range(4, 15) if ws[f"D{r}"].value == "15420")
        assert ws[f"B{row_idx}"].value == datetime(2026, 1, 22, 0, 0)
    wb_reg.close()

    # --- Parte B: Simples Nacional ---
    _emp_norm.cnpj = "99888777000166"
    db_session.commit()
    sol_sn, _emp_sn, _perfil_sn = _setup_empresa_ba(
        db_session, simples=True, preset_bebidas=True, razao_social="BEBIDAS SN LTDA"
    )

    service_sn = ProcessingPipelineService(db_session)
    res_sn = service_sn.process_solicitacao(
        sol_sn.id,
        xml_files_bytes=[("201.xml", xml_nf_norm), ("cte15420.xml", xml_cte_norm)],
    )
    db_session.refresh(res_sn)

    ctes_sn = sorted(
        [
            n for n in res_sn.notas_processadas
            if n.metadados_extras.get("tipo_documento") == "cte"
        ],
        key=lambda n: n.item_numero,
    )
    assert len(ctes_sn) == 2
    por_a_dst = {n.a_dst_resolvida: n for n in ctes_sn}
    assert set(por_a_dst.keys()) == {Decimal("0.2050"), Decimal("0.2250")}
    assert por_a_dst[Decimal("0.2050")].v_total == Decimal("100.00")
    assert Decimal(por_a_dst[Decimal("0.2050")].metadados_extras["mva"]) == Decimal("45")
    assert por_a_dst[Decimal("0.2050")].metadados_extras.get("fcp_aliquota") is None

    assert por_a_dst[Decimal("0.2250")].v_total == Decimal("100.00")
    assert Decimal(por_a_dst[Decimal("0.2250")].metadados_extras["mva"]) == Decimal("189.32")
    assert por_a_dst[Decimal("0.2250")].metadados_extras["fcp_aliquota"] == "0.0200"
    assert por_a_dst[Decimal("0.2250")].metadados_extras["fcp_separado"] is False

    saida_sn = next(s for s in res_sn.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    wb_sn = openpyxl.load_workbook(saida_sn.arquivo_path, data_only=False)
    assert wb_sn.sheetnames == ["01-2026"]
    ws_sn = wb_sn["01-2026"]
    cte_nums = [ws_sn[f"D{r}"].value for r in range(4, 15) if ws_sn[f"D{r}"].value and "15420" in str(ws_sn[f"D{r}"].value)]
    assert cte_nums == ["15420", "15420*"]
    wb_sn.close()

    for cte_row_sn in ctes_sn:
        cte_row_sn.data_entrada = date(2026, 1, 25)
        cte_row_sn.origem_data_entrada = "manual"
    db_session.commit()
    service_sn.regenerate_outputs(res_sn)
    wb_sn_reg = openpyxl.load_workbook(saida_sn.arquivo_path, data_only=False)
    assert wb_sn_reg.sheetnames == ["01-2026"]
    ws_sn_reg = wb_sn_reg["01-2026"]
    cte_rows_reg = [r for r in range(4, 15) if ws_sn_reg[f"D{r}"].value and "15420" in str(ws_sn_reg[f"D{r}"].value)]
    assert len(cte_rows_reg) == 2
    for r in cte_rows_reg:
        assert ws_sn_reg[f"B{r}"].value == datetime(2026, 1, 25, 0, 0)
    wb_sn_reg.close()


def test_cte_at_multiplas_aliquotas_fcp_grava_parcelas_e_regenera(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))
    sol, _emp, perfil = _setup_empresa_ba(db_session, simples=False, preset_bebidas=True)

    # Segunda faixa FCP (1%) para prego 73170090 + redução 41,463%
    db_session.add(
        RegraFcpProduto(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm="7317",
            termos_inclusao=[],
            termos_exclusao=[],
            aliquota=Decimal("0.0100"),
            aplicar_com_termo_acordo=True,
            descricao="FCP 1% Ferragens",
        )
    )
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

    chv_nf = chave_nfe("2601", 202)
    xml_nf = _xml_nfe_itens(
        numero="202",
        chave=chv_nf,
        itens=[
            {
                "ncm": "22030000",
                "cest": "0302103",
                "cfop": "6403",
                "x_prod": "CERVEJA PILSEN 350ML",
                "v_prod": "600.00",
            },
            {
                "ncm": "73170090",
                "cest": "1005700",
                "cfop": "6403",
                "x_prod": "PREGO ACO",
                "v_prod": "400.00",
            },
        ],
    )
    xml_cte = build_xml_cte(
        numero="15425",
        chave=chave_cte("2601", 15425),
        v_tprest="100.00",
        toma="3",
        p_icms="12.00",
        chaves_nfe=[chv_nf],
    )

    service = ProcessingPipelineService(db_session)
    res = service.process_solicitacao(
        sol.id,
        xml_files_bytes=[("202.xml", xml_nf), ("cte15425.xml", xml_cte)],
    )
    db_session.refresh(res)

    cte_proc = next(
        n for n in res.notas_processadas
        if n.metadados_extras.get("tipo_documento") == "cte"
    )
    assert cte_proc.metadados_extras["fcp_separado"] is True
    parcelas = cte_proc.metadados_extras.get("fcp_parcelas")
    assert isinstance(parcelas, list) and len(parcelas) == 2

    expected_keys = {
        "v_total",
        "base_calculo",
        "mva",
        "reducao",
        "fcp_aliquota",
        "fcp_base_st",
        "debito",
        "fcp_valor_devido",
        "percentual_rateio",
        "fcp_origem",
        "fcp_detalhe",
    }
    for parcela in parcelas:
        assert set(parcela.keys()) == expected_keys

    por_aliq = {Decimal(p["fcp_aliquota"]): p for p in parcelas}
    assert Decimal("0.0200") in por_aliq
    assert Decimal("0.0100") in por_aliq
    assert Decimal(por_aliq[Decimal("0.0200")]["v_total"]) == Decimal("60.00")
    assert Decimal(por_aliq[Decimal("0.0100")]["v_total"]) == Decimal("40.00")
    assert por_aliq[Decimal("0.0100")]["reducao"] == "0.41463"

    # Editar data_entrada e regenerar preserva todas as parcelas na aba FCP
    cte_proc.data_entrada = date(2026, 1, 29)
    cte_proc.origem_data_entrada = "manual"
    db_session.commit()
    service.regenerate_outputs(res)

    saida = next(s for s in res.saidas if s.tipo == ANTECIPACAO_TRIBUTARIA)
    wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    ws_fcp = wb["01-2026 FCP"]
    cte_rows_fcp = [
        r for r in range(4, 15) if ws_fcp[f"D{r}"].value == "15425"
    ]
    assert len(cte_rows_fcp) == 2
    for r in cte_rows_fcp:
        assert ws_fcp[f"B{r}"].value == datetime(2026, 1, 29, 0, 0)
        assert ws_fcp[f"K{r}"].value == 0
        assert ws_fcp[f"S{r}"].value == 0
    wb.close()


def test_fcp_itens_excluidos_avisos_redundancia_e_sanity_checker(
    db_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))

    # SanityChecker valida faixa [0, 1] de fcp_separado
    with pytest.raises(ValidationException):
        SanityChecker.validate_numeric_values(
            "101",
            Decimal("100.00"),
            Decimal("100.00"),
            Decimal("0.12"),
            Decimal("0.2050"),
            fcp_separado=Decimal("1.50"),
        )

    # Empresa com exclusão de ST na Tributária ("CASA VIP") não gera FCP
    sol_excl, _emp, perfil = _setup_empresa_ba(
        db_session,
        simples=False,
        preset_bebidas=True,
        razao_social="CASA VIP LTDA",
    )
    # Adiciona segunda regra FCP redundante (mesma alíquota 2%) para validar aviso
    db_session.add(
        RegraFcpProduto(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm="22021000",
            termos_inclusao=["REFRI"],
            termos_exclusao=[],
            aliquota=Decimal("0.0200"),
            aplicar_com_termo_acordo=True,
            descricao="Regra FCP Redundante",
        )
    )
    db_session.commit()

    chv_st = chave_nfe("2601", 301)
    xml_st = _xml_nfe_itens(
        numero="301",
        chave=chv_st,
        v_st_nota="50.00",
        itens=[
            # Excluído por CASA VIP + vST > 0
            {
                "ncm": "22030000",
                "cest": "0302103",
                "cfop": "6403",
                "x_prod": "CERVEJA PILSEN 350ML",
                "v_prod": "500.00",
                "v_icms_st": "50.00",
            },
            # Parcial com regra FCP redundante -> gera aviso de redundância FCP sem aba FCP
            {
                "ncm": "22021000",
                "cfop": "6102",
                "x_prod": "REFRI COLA 2L",
                "v_prod": "200.00",
            },
        ],
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol_excl.id,
        xml_files_bytes=[("301.xml", xml_st)],
    )
    db_session.refresh(res)

    # Cerveja excluída na Tributária não gerou nota nem aba FCP; só o item Parcial gerou saída (sem aba FCP)
    assert len(res.notas_processadas) == 1
    assert res.notas_processadas[0].destino_planilha == ANTECIPACAO_PARCIAL
    assert any(
        "FCP" in (a.get("aviso") or "") for a in (res.avisos_avaliacao or [])
    )
    saida = res.saidas[0]
    wb = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert len(wb.sheetnames) == 1
    assert not any("FCP" in s for s in wb.sheetnames)
    wb.close()

    # MVA pendente (22021000 sem CEST na Tributária) também não gera linha nem aba FCP
    _emp.cnpj = "99888777000166"
    db_session.commit()
    sol_mva, _emp_mva, _perfil_mva = _setup_empresa_ba(
        db_session, simples=False, preset_bebidas=True, razao_social="EMPRESA MVA LTDA"
    )
    chv_mva = chave_nfe("2601", 302)
    xml_mva = _xml_nfe_itens(
        numero="302",
        chave=chv_mva,
        itens=[
            {
                "ncm": "22021000",
                "cfop": "6403",
                "x_prod": "REFRIGERANTE COLA 2L",
                "v_prod": "400.00",
            },
            {
                "ncm": "22011000",
                "cest": "0300500",
                "cfop": "6403",
                "x_prod": "AGUA MINERAL 500ML",
                "v_prod": "300.00",
            },
        ],
    )
    res_mva = ProcessingPipelineService(db_session).process_solicitacao(
        sol_mva.id,
        xml_files_bytes=[("302.xml", xml_mva)],
    )
    db_session.refresh(res_mva)
    assert any(
        ex["ncm"] == "22021000" and ex["tipo_exclusao"] == "mva_pendente"
        for ex in (res_mva.itens_excluidos or [])
    )
    assert len(res_mva.notas_processadas) == 1
    assert res_mva.notas_processadas[0].ncm == "22011000"
    wb_mva = openpyxl.load_workbook(res_mva.saidas[0].arquivo_path, data_only=False)
    assert wb_mva.sheetnames == ["01-2026"]
    wb_mva.close()
