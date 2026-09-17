from decimal import Decimal
from datetime import datetime
from app.models.perfil_regras import PerfilRegras
from app.models.empresa import Empresa
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager

XML_MULTI_ITENS_MESMA_ALIQUOTA = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe29260112345678000195550010000000011000000011">
      <ide>
        <nNF>101</nNF>
        <serie>1</serie>
        <dhEmi>2026-01-10T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>99888777000166</CNPJ>
        <xNome>Fornecedor de Alimentos SP</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>Comercial Bahia LTDA</xNome>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <total>
        <ICMSTot>
          <vNF>3000.00</vNF>
          <vBC>2800.00</vBC>
        </ICMSTot>
      </total>
      <!-- Item 1: 1000.00, BC 900, IPI 100, A.ORI 12% -->
      <det nItem="1">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6102</CFOP>
          <vProd>900.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro>
          <vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>900.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS>
          <IPI><IPITrib><vIPI>100.00</vIPI></IPITrib></IPI>
        </imposto>
      </det>
      <!-- Item 2: 2000.00, BC 1900, IPI 100, A.ORI 12% -->
      <det nItem="2">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6102</CFOP>
          <vProd>1900.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro>
          <vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>1900.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS>
          <IPI><IPITrib><vIPI>100.00</vIPI></IPITrib></IPI>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>
""".encode("utf-8")

XML_MULTI_ITENS_ALIQUOTAS_DIFERENTES = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe29260112345678000195550010000000021000000022">
      <ide>
        <nNF>102</nNF>
        <serie>1</serie>
        <dhEmi>2026-01-15T14:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>99888777000166</CNPJ>
        <xNome>Fornecedor Diversos SP</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>Comercial Bahia LTDA</xNome>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <total>
        <ICMSTot>
          <vNF>5000.00</vNF>
          <vBC>5000.00</vBC>
        </ICMSTot>
      </total>
      <!-- Item 1: 3000.00, A.ORI 12%, NCM padrao (A.DST 20.5%) -->
      <det nItem="1">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6102</CFOP>
          <vProd>3000.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro>
          <vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>3000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS>
        </imposto>
      </det>
      <!-- Item 2: 2000.00, A.ORI 7%, NCM 84713012 (Excecao A.DST 12.0%) -->
      <det nItem="2">
        <prod>
          <NCM>84713012</NCM>
          <CFOP>6102</CFOP>
          <vProd>2000.00</vProd>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro>
          <vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>2000.00</vBC><pICMS>7.00</pICMS></ICMS00></ICMS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>
""".encode("utf-8")

def test_consolidacao_e_desdobramento_nfe(db_session, create_sample_excel_template):
    template_path = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(template_path, "rb") as f:
        file_bytes = f.read()

    mapping = {
        "start_row": 4,
        "columns": {
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        }
    }
    template = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        filename="template_test.xlsx",
        file_bytes=file_bytes,
        mapeamento=mapping,
        promover_ativo=True
    )

    perfil = PerfilRegras(nome="Perfil Consolidacao")
    db_session.add(perfil)
    db_session.commit()

    empresa = Empresa(
        razao_social="Comercial Bahia LTDA",
        cnpj="12345678000195",
        uf="BA",
        perfil_regras_id=perfil.id
    )
    db_session.add(empresa)
    db_session.commit()

    # Regra padrão BA (20.5%)
    r_padrao = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.2050"),
        descricao="Padrao BA 20.5%"
    )
    # Regra exceção NCM 84713012 (12%)
    r_excecao = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="84713012",
        aliquota=Decimal("0.1200"),
        descricao="Excecao Informatica 12%"
    )
    db_session.add_all([r_padrao, r_excecao])
    db_session.commit()

    pipeline = ProcessingPipelineService(db_session)

    # 1. Testar NF 101: 2 itens com mesma alíquota -> Deve gerar exatamente 1 linha consolidada
    sol1 = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=datetime(2026, 1, 1),
        periodo_fim=datetime(2026, 1, 31),
        tipo_planilha="antecipacao_parcial",
        template_id=template.id
    )
    db_session.add(sol1)
    db_session.commit()

    pipeline.process_solicitacao(sol1.id, [("nfe101.xml", XML_MULTI_ITENS_MESMA_ALIQUOTA)])
    db_session.refresh(sol1)

    assert sol1.status == "concluido"
    # Apenas 1 linha na planilha para a NF 101
    assert len(sol1.notas_processadas) == 1
    linha_nfe101 = sol1.notas_processadas[0]
    assert linha_nfe101.numero_nota == "101"
    assert linha_nfe101.v_total == Decimal("3000.00")
    assert linha_nfe101.base_calculo == Decimal("2800.00")
    assert linha_nfe101.ipi_despesas == Decimal("200.00")
    assert linha_nfe101.a_ori == Decimal("0.1200")
    assert linha_nfe101.a_dst_resolvida == Decimal("0.2050")
    assert linha_nfe101.metadados_extras.get("desdobramento") is False

    # 2. Testar NF 102: 2 itens com alíquotas diferentes -> Deve desdobrar em 2 linhas
    sol2 = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=datetime(2026, 1, 1),
        periodo_fim=datetime(2026, 1, 31),
        tipo_planilha="antecipacao_parcial",
        template_id=template.id
    )
    db_session.add(sol2)
    db_session.commit()

    pipeline.process_solicitacao(sol2.id, [("nfe102.xml", XML_MULTI_ITENS_ALIQUOTAS_DIFERENTES)])
    db_session.refresh(sol2)

    assert sol2.status == "concluido"
    # Deve ter 2 linhas para a NF 102
    assert len(sol2.notas_processadas) == 2
    
    # Linha 1: Item de 3000.00 com A.ORI 12% e A.DST 20.5%
    linha_sub1 = [n for n in sol2.notas_processadas if n.a_ori == Decimal("0.1200")][0]
    assert linha_sub1.v_total == Decimal("3000.00")
    assert linha_sub1.a_dst_resolvida == Decimal("0.2050")
    assert linha_sub1.debito == Decimal("3000.00") * Decimal("0.2050") # 615.00
    assert linha_sub1.credito == Decimal("3000.00") * Decimal("0.1200") # 360.00
    assert linha_sub1.valor_devido == Decimal("255.00")
    assert linha_sub1.metadados_extras.get("desdobramento") is True

    # Linha 2: Item de 2000.00 com A.ORI 7% e A.DST 12.0%
    linha_sub2 = [n for n in sol2.notas_processadas if n.a_ori == Decimal("0.0700")][0]
    assert linha_sub2.v_total == Decimal("2000.00")
    assert linha_sub2.a_dst_resolvida == Decimal("0.1200")
    assert linha_sub2.debito == Decimal("2000.00") * Decimal("0.1200") # 240.00
    assert linha_sub2.credito == Decimal("2000.00") * Decimal("0.0700") # 140.00
    assert linha_sub2.valor_devido == Decimal("100.00")
    assert linha_sub2.metadados_extras.get("desdobramento") is True
