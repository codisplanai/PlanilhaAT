from decimal import Decimal
from datetime import date
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.models.template_xlsx import TemplateXlsx
from app.services.pipeline_service import ProcessingPipelineService
from app.core.seeds import seed_default_templates

def test_pipeline_frete_not_mapped_to_ipi(db_session):
    seed_default_templates(db_session)
    template = db_session.query(TemplateXlsx).filter(TemplateXlsx.tipo == "antecipacao_parcial", TemplateXlsx.ativo == True).first()
    perfil = PerfilRegras(nome="Perfil Teste Frete")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(perfil_regras_id=perfil.id, uf="BA", aliquota=Decimal("0.2050"), descricao="BA"))
    empresa = Empresa(razao_social="EMPRESA TESTE", cnpj="12345678000195", uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    # XML com vProd 1000, Frete 100, Base 1100, Total 1100, IPI 0
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260198765432000180550010000009991000000999">
          <ide><nNF>999</nNF><serie>1</serie><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
          <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM><CFOP>6102</CFOP><xProd>TESTE FRETE</xProd>
              <vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
            </prod>
            <imposto>
              <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1100.00</vBC><pICMS>12.00</pICMS><vICMS>132.00</vICMS></ICMS00></ICMS>
            </imposto>
          </det>
          <total><ICMSTot><vBC>1100.00</vBC><vICMS>132.00</vICMS><vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vIPI>0.00</vIPI><vNF>1100.00</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
    </nfeProc>""".encode("utf-8")

    solicitacao = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1), periodo_fim=date(2026, 1, 31), tipo_planilha="antecipacao_parcial", template_id=template.id, status="pendente")
    db_session.add(solicitacao)
    db_session.commit()

    service = ProcessingPipelineService(db_session)
    res = service.process_solicitacao(solicitacao.id, xml_files_bytes=[("999.xml", xml)])
    assert res.status == "concluido"
    nota = res.notas_processadas[0]
    assert nota.v_total == Decimal("1100.00")
    assert nota.base_calculo == Decimal("1100.00")
    assert nota.ipi_despesas == Decimal("0.00")

def test_pipeline_does_not_infer_ipi_when_total_greater_than_base(db_session):
    seed_default_templates(db_session)
    template = db_session.query(TemplateXlsx).filter(TemplateXlsx.tipo == "antecipacao_parcial", TemplateXlsx.ativo == True).first()
    perfil = PerfilRegras(nome="Perfil Teste Diff Base")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(perfil_regras_id=perfil.id, uf="BA", aliquota=Decimal("0.2050"), descricao="BA"))
    empresa = Empresa(razao_social="EMPRESA TESTE", cnpj="12345678000195", uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    # XML onde V.Total é 1200 e Base é 1000 (ex: desconto não tributável ou base reduzida de ICMS na origem), sem IPI destacado
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260198765432000180550010000008881000000888">
          <ide><nNF>888</nNF><serie>1</serie><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
          <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM><CFOP>6102</CFOP><xProd>TESTE BASE DIFERENTE</xProd>
              <vProd>1200.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
            </prod>
            <imposto>
              <ICMS><ICMS20><orig>0</orig><CST>20</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS></ICMS20></ICMS>
            </imposto>
          </det>
          <total><ICMSTot><vBC>1000.00</vBC><vICMS>120.00</vICMS><vProd>1200.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vIPI>0.00</vIPI><vNF>1200.00</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
    </nfeProc>""".encode("utf-8")

    solicitacao = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1), periodo_fim=date(2026, 1, 31), tipo_planilha="antecipacao_parcial", template_id=template.id, status="pendente")
    db_session.add(solicitacao)
    db_session.commit()

    service = ProcessingPipelineService(db_session)
    res = service.process_solicitacao(solicitacao.id, xml_files_bytes=[("888.xml", xml)])
    assert res.status == "concluido"
    nota = res.notas_processadas[0]
    assert nota.v_total == Decimal("1200.00")
    assert nota.base_calculo == Decimal("1000.00")
    # NÃO deve inventar R$ 200.00 de IPI pela diferença v_total - base_calculo!
    assert nota.ipi_despesas == Decimal("0.00")
