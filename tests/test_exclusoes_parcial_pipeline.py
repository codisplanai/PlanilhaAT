from datetime import date
from decimal import Decimal
import pytest

from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.models.solicitacao import Solicitacao
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager


def _montar_xml_itens(itens_xml: list, num_nota="101", total_nf="1000.00", total_bc="1000.00") -> bytes:
    itens_str = "\n".join(itens_xml)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe3526019876543200018055001000000{num_nota}1000000{num_nota}">
      <ide><nNF>{num_nota}</nNF><serie>1</serie><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>{total_nf}</vNF><vBC>{total_bc}</vBC></ICMSTot></total>
      {itens_str}
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


def _det_item(nItem: int, ncm: str, xProd: str, vProd: str, pICMS: str, vBC: str = None, vIPI: str = "0.00", vOutro: str = "0.00") -> str:
    vbc_val = vBC if vBC is not None else vProd
    return f"""
      <det nItem="{nItem}">
        <prod>
          <NCM>{ncm}</NCM>
          <CFOP>6102</CFOP>
          <xProd>{xProd}</xProd>
          <vProd>{vProd}</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>{vOutro}</vOutro>
          <vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <vBC>{vbc_val}</vBC>
              <pICMS>{pICMS}</pICMS>
            </ICMS00>
          </ICMS>
          <IPI>
            <IPITrib>
              <vIPI>{vIPI}</vIPI>
            </IPITrib>
          </IPI>
        </imposto>
      </det>"""


def _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=True, is_simples=False):
    path = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(path, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session,
            tipo="antecipacao_parcial",
            filename="template_parcial.xlsx",
            file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    perfil = PerfilRegras(
        nome="Perfil Fiscal Bahia Exclusões",
        descricao="Perfil com exclusões da Parcial",
        configuracoes_extras={
            "politica_aliquotas_iguais_parcial": {"BA": politica_aliquotas_iguais}
        } if politica_aliquotas_iguais else {},
    )
    db_session.add(perfil)
    db_session.flush()

    # CFOP 6102 -> antecipacao_parcial
    db_session.add(RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="102",
        destino="antecipacao_parcial",
    ))

    # Alíquota padrão BA: 20.50%
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.2050"),
        descricao="Alíquota Padrão Bahia",
    ))

    # Alíquota especial para NCM de milho 10059010 -> 7%
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="10059010",
        aliquota=Decimal("0.0700"),
        descricao="Milho em grão 7%",
    ))

    # Regras de exclusão da lista da Bahia
    regras_ba = [
        ("02102000", "Charque", ["CHARQUE"], "imposto_pago_entrada"),
        ("19012090", "Mistura para bolo", ["MISTURA", "BOLO"], "imposto_pago_entrada"),
        ("11041900", "Flocão de milho", ["FLOCAO", "MILHO"], "isencao"),
        ("11022000", "Farinha de milho", ["FARINHA", "MILHO"], "isencao"),
        ("07133399", "Feijão", ["FEIJAO"], "isencao"),
        ("25010020", "Sal", ["SAL"], "isencao"),
        ("17019900", "Açúcar", ["ACUCAR"], "imposto_pago_entrada"),
    ]
    for ncm, desc, termos, motivo in regras_ba:
        db_session.add(RegraExclusaoParcial(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm=ncm,
            descricao=desc,
            termos_obrigatorios=termos,
            motivo=motivo,
            ativo=True,
        ))

    empresa = Empresa(
        razao_social="Empresa Teste Bahia Ltda",
        cnpj="12345678000195",
        uf="BA",
        optante_simples_nacional=is_simples,
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.commit()

    return empresa, perfil


def test_exclusao_das_7_mercadorias_padrao_da_bahia(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=True)

    # XML com os 7 itens das mercadorias da Bahia
    itens = [
        _det_item(1, "02102000", "CHARQUE BOVINO PONTA DE AGULHA", "100.00", "12.00"),
        _det_item(2, "19012090", "MISTURA PRONTA PARA BOLO DE CHOCOLATE", "50.00", "12.00"),
        _det_item(3, "11041900", "FLOCAO DE MILHO NUTRITIVO 500G", "30.00", "12.00"),
        _det_item(4, "11022000", "FARINHA DE MILHO FINA 1KG", "40.00", "12.00"),
        _det_item(5, "07133399", "FEIJAO CARIOCA TIPO 1", "60.00", "12.00"),
        _det_item(6, "25010020", "SAL REFINADO IODADO", "20.00", "12.00"),
        _det_item(7, "17019900", "ACUCAR CRISTAL BRANCO", "80.00", "12.00"),
    ]
    xml_bytes = _montar_xml_itens(itens, total_nf="380.00", total_bc="380.00")

    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("todas_excluidas.xml", xml_bytes)]
    )
    db_session.refresh(res)

    assert res.status == "concluido"
    assert res.total_notas_processadas == 0
    assert res.mensagem_erro == "Nenhum item a recolher na Parcial"
    assert len(res.itens_excluidos) == 7

    motivos_esperados = {
        "02102000": "Imposto pago na entrada",
        "19012090": "Imposto pago na entrada",
        "11041900": "Isenção",
        "11022000": "Isenção",
        "07133399": "Isenção",
        "25010020": "Isenção",
        "17019900": "Imposto pago na entrada",
    }
    for exc in res.itens_excluidos:
        assert exc["tipo_exclusao"] == "mercadoria"
        assert exc["motivo"] == motivos_esperados[exc["ncm"]]
        assert exc["debito"] is None
        assert exc["valor_devido"] is None


def test_descricao_incompativel_nao_exclui_por_mercadoria(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=False)

    itens = [
        # Salgadinho tem a substring sal mas não a palavra SAL completa
        _det_item(1, "25010020", "SALGADINHO DE MILHO SABOR QUEIJO", "100.00", "12.00"),
        # Mistura sem a palavra bolo
        _det_item(2, "19012090", "MISTURA LACTEA CONDENSADA", "200.00", "12.00"),
    ]
    xml_bytes = _montar_xml_itens(itens, total_nf="300.00", total_bc="300.00")

    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("incompativeis.xml", xml_bytes)]
    )
    db_session.refresh(res)

    assert res.status == "concluido"
    assert res.total_notas_processadas == 1
    assert len(res.itens_excluidos) == 0


def test_milho_10059010_nao_integra_exclusoes_fixas(db_session, create_sample_excel_template):
    """Milho segue fluxo de cálculo (A.dest 7%, A.origem 4% -> devido 3%)."""
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=True)

    itens = [
        _det_item(1, "10059010", "MILHO EM GRAO A GRANEL", "1000.00", "4.00"),
    ]
    xml_bytes = _montar_xml_itens(itens, total_nf="1000.00", total_bc="1000.00")

    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("milho.xml", xml_bytes)]
    )
    db_session.refresh(res)

    assert res.status == "concluido"
    assert res.total_notas_processadas == 1
    assert len(res.itens_excluidos) == 0
    nota_proc = res.notas_processadas[0]
    assert nota_proc.a_dst_resolvida == Decimal("0.0700")
    assert nota_proc.a_ori == Decimal("0.0400")
    assert nota_proc.debito == Decimal("70.00")
    assert nota_proc.credito == Decimal("40.00")
    assert nota_proc.valor_devido == Decimal("30.00")


def test_aliquotas_iguais_com_ipi_mantem_quando_devido_positivo(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=True)

    # Item sem regra de mercadoria: NCM 84713012 (computador).
    # A.ORI = 20.50%, A.DST = 20.50% (iguais).
    # Porém possui IPI de R$ 100,00 -> V.Total R$ 1.100,00, Base R$ 1.000,00.
    # Débito = 1100 * 20.50% = 225.50
    # Crédito = 1000 * 20.50% = 205.00
    # Valor devido = 20.50 > 0 -> Mantido!
    itens = [
        _det_item(1, "84713012", "COMPUTADOR SERVIDOR", "1000.00", "20.50", vBC="1000.00", vIPI="100.00"),
    ]
    xml_bytes = _montar_xml_itens(itens, total_nf="1100.00", total_bc="1000.00")

    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("computador.xml", xml_bytes)]
    )
    db_session.refresh(res)

    assert res.status == "concluido"
    assert res.total_notas_processadas == 1
    assert len(res.itens_excluidos) == 0
    nota = res.notas_processadas[0]
    assert nota.valor_devido == Decimal("20.50")


def test_aliquotas_iguais_sem_diferenca_exclui_com_conferencia(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=True)

    # Item sem regra de mercadoria: NCM 84713012.
    # A.ORI = 20.50%, A.DST = 20.50% (iguais), sem IPI ou despesas.
    # Débito = 1000 * 20.50% = 205.00
    # Crédito = 1000 * 20.50% = 205.00
    # Valor devido = 0.00 -> Excluído por alíquotas iguais!
    itens = [
        _det_item(1, "84713012", "COMPUTADOR SEM IPI", "1000.00", "20.50"),
    ]
    xml_bytes = _montar_xml_itens(itens, total_nf="1000.00", total_bc="1000.00")

    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("comp_zerado.xml", xml_bytes)]
    )
    db_session.refresh(res)

    assert res.status == "concluido"
    assert res.total_notas_processadas == 0
    assert len(res.itens_excluidos) == 1
    exc = res.itens_excluidos[0]
    assert exc["tipo_exclusao"] == "aliquotas_iguais"
    assert exc["debito"] == 205.0
    assert exc["credito"] == 205.0
    assert exc["valor_devido"] == 0.0


def test_nota_mista_mantidos_e_excluidos(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template, politica_aliquotas_iguais=True)

    # Item 1: Charque (excluído por mercadoria) -> R$ 500,00
    # Item 2: Sal (excluído por mercadoria) -> R$ 100,00
    # Item 3: Computador sem IPI (excluído por alíquotas iguais 20.50% = 20.50%) -> R$ 1000,00
    # Item 4: Produto normal A.ORI 12% vs A.DST 20.50% (mantido) -> R$ 2000,00
    itens = [
        _det_item(1, "02102000", "CHARQUE BOVINO", "500.00", "12.00"),
        _det_item(2, "25010020", "SAL REFINADO", "100.00", "12.00"),
        _det_item(3, "84713012", "COMPUTADOR SERVIDOR", "1000.00", "20.50"),
        _det_item(4, "39269090", "ARTEFATO DE PLASTICO", "2000.00", "12.00"),
    ]
    xml_bytes = _montar_xml_itens(itens, num_nota="555", total_nf="3600.00", total_bc="3600.00")

    sol = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 1, 1),
        periodo_fim=date(2026, 1, 31),
        tipo_planilha="multi",
    )
    db_session.add(sol)
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("mista.xml", xml_bytes)]
    )
    db_session.refresh(res)

    assert res.status == "concluido"
    assert res.total_notas_processadas == 1
    assert len(res.itens_excluidos) == 3

    # Apenas o Item 4 gerou linha
    nota_proc = res.notas_processadas[0]
    assert nota_proc.numero_nota == "555"
    assert nota_proc.ncm == "39269090"
    assert nota_proc.v_total == Decimal("2000.00")  # Não traz de volta os outros R$ 1.600
    assert nota_proc.debito == Decimal("410.00")     # 2000 * 20.50%
    assert nota_proc.credito == Decimal("240.00")    # 2000 * 12.00%
    assert nota_proc.valor_devido == Decimal("170.00")


def test_excluded_commodity_does_not_require_destination_rate(db_session, create_sample_excel_template):
    from app.services.rules_engine.aliquota_resolver import RegraAliquotaDestino
    empresa, perfil = _setup_ambiente(db_session, create_sample_excel_template)
    db_session.query(RegraAliquotaDestino).filter_by(perfil_regras_id=perfil.id).delete()
    db_session.commit()

    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                      periodo_fim=date(2026, 1, 31), tipo_planilha="multi")
    db_session.add(sol)
    db_session.commit()
    xml = _montar_xml_itens([_det_item(1, "02102000", "CHARQUE", "100.00", "12.00")])
    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("review.xml", xml)])
    assert res.status == "concluido"
    assert len(res.itens_excluidos) == 1
    assert res.itens_excluidos[0]["a_dst"] is None


def test_excluded_item_does_not_mask_unknown_cfop(db_session, create_sample_excel_template):
    from app.core.exceptions import ValidationException
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template)
    excluded = _det_item(1, "02102000", "CHARQUE", "100.00", "12.00")
    unknown = _det_item(2, "39269090", "PLASTICO", "100.00", "12.00").replace("6102", "6999")
    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                      periodo_fim=date(2026, 1, 31), tipo_planilha="multi")
    db_session.add(sol)
    db_session.commit()
    xml = _montar_xml_itens([excluded, unknown], total_nf="200.00", total_bc="200.00")
    with pytest.raises(ValidationException):
        ProcessingPipelineService(db_session).process_solicitacao(
            sol.id, xml_files_bytes=[("review.xml", xml)])


@pytest.mark.parametrize("ncm,description", [("00000000", "PRODUTO"), ("02102000", "")])
def test_incomplete_product_data_produces_warning(db_session, create_sample_excel_template, ncm, description):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template)
    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                      periodo_fim=date(2026, 1, 31), tipo_planilha="multi")
    db_session.add(sol)
    db_session.commit()
    xml = _montar_xml_itens([_det_item(1, ncm, description, "100.00", "12.00")])
    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("review.xml", xml)])
    assert res.avisos_avaliacao, "Missing NCM/description was not reported"


@pytest.mark.parametrize("destino,is_simples", [
    ("antecipacao_parcial", False),
    ("antecipacao_parcial_simples", True),
    ("antecipacao_parcial_antecipado", False),
    ("antecipacao_parcial_antecipado_simples", True),
])
@pytest.mark.parametrize("v_total,base,expenses,expected_excluded", [
    ("100.00", "100.00", "0.00", True),
    ("100.00", "110.00", "0.00", True),
    ("110.00", "100.00", "10.00", False),
    ("100.00", "99.99", "0.01", True),
])
def test_numeric_edge_cases_all_four_modalities(db_session, create_sample_excel_template,
        destino, is_simples, v_total, base, expenses, expected_excluded):
    from app.services.rules_engine.parcial_decision import ParcialExclusionService
    perfil = PerfilRegras(nome="Review numeric edges", configuracoes_extras={
        "politica_aliquotas_iguais_parcial": {"BA": True}})
    db_session.add(perfil)
    db_session.commit()
    service = ParcialExclusionService(db_session)
    service.preload(perfil.id)
    result = service.avaliar_item(perfil_regras_id=perfil.id, uf_empresa="BA", destino=destino,
        ncm="39269090", descricao="PLASTICO", descricao_confiavel=True,
        v_total=Decimal(v_total), base_calculo=Decimal(base), ipi_despesas=Decimal(expenses),
        a_ori=Decimal("0.07"), a_dst=Decimal("0.07"), is_simples=is_simples)
    assert result.excluido is expected_excluded


def test_negative_result_is_retained_in_api(db_session, create_sample_excel_template):
    empresa, _ = _setup_ambiente(db_session, create_sample_excel_template)
    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                      periodo_fim=date(2026, 1, 31), tipo_planilha="multi")
    db_session.add(sol)
    db_session.commit()
    xml = _montar_xml_itens([_det_item(1, "10059010", "MILHO", "100.00", "7.00", vBC="110.00")],
                            total_nf="100.00", total_bc="110.00")
    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("review.xml", xml)])
    assert res.itens_excluidos[0]["valor_devido"] == -0.7
