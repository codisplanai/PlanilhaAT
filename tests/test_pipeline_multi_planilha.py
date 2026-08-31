import pytest
from decimal import Decimal
from datetime import date

from app.core.exceptions import ValidationException
from app.models.perfil_regras import PerfilRegras
from app.models.empresa import Empresa
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager

MAPPING_PADRAO = {
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

# NF-e com 3 itens de naturezas diferentes:
#   Item 1 (CFOP 6102): compra para revenda, produto tributado    -> Antecipação Parcial
#   Item 2 (CFOP 6405): compra para revenda, produto antecipado   -> Antecipação Tributária
#   Item 3 (CFOP 6556): material de uso/consumo                   -> DIFAL
# vNF/vBC da nota = soma exata dos 3 itens (1000 + 2000 + 500 = 3500)
XML_NFE_TRES_DESTINOS = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260112345678000195550010000099991000009999">
      <ide>
        <nNF>9999</nNF>
        <serie>1</serie>
        <dhEmi>2026-03-10T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>11222333000181</CNPJ>
        <xNome>Fornecedor Multi SP</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>Comercial Bahia LTDA</xNome>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <total>
        <ICMSTot>
          <vNF>3500.00</vNF>
          <vBC>3500.00</vBC>
        </ICMSTot>
      </total>
      <det nItem="1">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6102</CFOP>
          <vProd>1000.00</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS>
        </imposto>
      </det>
      <det nItem="2">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6405</CFOP>
          <vProd>2000.00</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>2000.00</vBC><pICMS>7.00</pICMS></ICMS00></ICMS>
        </imposto>
      </det>
      <det nItem="3">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6556</CFOP>
          <vProd>500.00</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>500.00</vBC><pICMS>18.00</pICMS></ICMS00></ICMS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>
""".encode("utf-8")

# NF-e cujo único item tem um CFOP sem regra cadastrada
XML_NFE_CFOP_SEM_REGRA = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260112345678000195550010000088881000008888">
      <ide>
        <nNF>8888</nNF>
        <serie>1</serie>
        <dhEmi>2026-03-11T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>11222333000181</CNPJ>
        <xNome>Fornecedor Multi SP</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>Comercial Bahia LTDA</xNome>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <total>
        <ICMSTot>
          <vNF>700.00</vNF>
          <vBC>700.00</vBC>
        </ICMSTot>
      </total>
      <det nItem="1">
        <prod>
          <NCM>21069090</NCM>
          <CFOP>6910</CFOP>
          <vProd>700.00</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
        </prod>
        <imposto>
          <ICMS><ICMS00><vBC>700.00</vBC><pICMS>18.00</pICMS></ICMS00></ICMS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>
""".encode("utf-8")


def _setup_empresa(db_session):
    perfil = PerfilRegras(nome="Perfil Multi Planilha")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.1800"),
        descricao="Padrão BA 18%"
    ))
    db_session.commit()

    empresa = Empresa(
        razao_social="Comercial Bahia LTDA",
        cnpj="12345678000195",
        uf="BA",
        perfil_regras_id=perfil.id
    )
    db_session.add(empresa)
    db_session.commit()
    return empresa

def _upload_template(db_session, create_sample_excel_template, tipo):
    template_path = create_sample_excel_template(tipo=tipo)
    with open(template_path, "rb") as f:
        file_bytes = f.read()
    return TemplateManager.upload_new_template_version(
        db=db_session,
        tipo=tipo,
        filename=f"template_{tipo}.xlsx",
        file_bytes=file_bytes,
        mapeamento=MAPPING_PADRAO,
        promover_ativo=True
    )

def _criar_solicitacao_multi(db_session, empresa):
    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 3, 1),
        periodo_fim=date(2026, 3, 31),
        tipo_planilha=None,
        status="pendente"
    )
    db_session.add(solicitacao)
    db_session.commit()
    return solicitacao


def test_nfe_com_tres_naturezas_gera_tres_planilhas_segregadas(db_session, create_sample_excel_template):
    empresa = _setup_empresa(db_session)
    for tipo in ["antecipacao_parcial", "antecipacao_tributaria", "difal"]:
        _upload_template(db_session, create_sample_excel_template, tipo)

    solicitacao = _criar_solicitacao_multi(db_session, empresa)

    pipeline = ProcessingPipelineService(db_session)
    resultado = pipeline.process_solicitacao(solicitacao.id, [("nfe9999.xml", XML_NFE_TRES_DESTINOS)])
    db_session.refresh(resultado)

    assert resultado.status == "concluido"
    assert resultado.total_notas_processadas == 3  # 1 linha por destino, mesma NF-e nas 3 planilhas

    saidas_por_tipo = {s.tipo: s for s in resultado.saidas}
    assert set(saidas_por_tipo.keys()) == {"antecipacao_parcial", "antecipacao_tributaria", "difal"}

    for tipo in saidas_por_tipo:
        saida = saidas_por_tipo[tipo]
        assert saida.arquivo_path is not None
        assert saida.aviso is None
        assert saida.total_notas == 1

    # A mesma NF-e (9999) aparece nas 3 planilhas, cada uma só com o valor do item correspondente
    notas = resultado.notas_processadas
    assert all(n.numero_nota == "9999" for n in notas)
    valores_por_destino = {n.destino_planilha: n.v_total for n in notas}
    assert valores_por_destino["antecipacao_parcial"] == Decimal("1000.00")
    assert valores_por_destino["antecipacao_tributaria"] == Decimal("2000.00")
    assert valores_por_destino["difal"] == Decimal("500.00")

    # A soma dos 3 valores segregados bate com o total da nota
    assert sum(valores_por_destino.values()) == Decimal("3500.00")


def test_bucket_sem_template_ativo_gera_aviso_mas_nao_bloqueia_as_demais(db_session, create_sample_excel_template):
    empresa = _setup_empresa(db_session)
    # Propositalmente NÃO sobe template de antecipacao_tributaria
    for tipo in ["antecipacao_parcial", "difal"]:
        _upload_template(db_session, create_sample_excel_template, tipo)

    solicitacao = _criar_solicitacao_multi(db_session, empresa)

    pipeline = ProcessingPipelineService(db_session)
    resultado = pipeline.process_solicitacao(solicitacao.id, [("nfe9999.xml", XML_NFE_TRES_DESTINOS)])
    db_session.refresh(resultado)

    assert resultado.status == "concluido"
    saidas_por_tipo = {s.tipo: s for s in resultado.saidas}

    assert saidas_por_tipo["antecipacao_parcial"].arquivo_path is not None
    assert saidas_por_tipo["difal"].arquivo_path is not None

    saida_tributaria = saidas_por_tipo["antecipacao_tributaria"]
    assert saida_tributaria.arquivo_path is None
    assert saida_tributaria.aviso is not None
    assert saida_tributaria.total_notas == 1  # o item foi roteado e contabilizado, só não foi escrito em Excel


def test_nenhum_item_roteavel_gera_erro_de_validacao(db_session, create_sample_excel_template):
    empresa = _setup_empresa(db_session)
    for tipo in ["antecipacao_parcial", "antecipacao_tributaria", "difal"]:
        _upload_template(db_session, create_sample_excel_template, tipo)

    solicitacao = _criar_solicitacao_multi(db_session, empresa)

    pipeline = ProcessingPipelineService(db_session)
    with pytest.raises(ValidationException):
        pipeline.process_solicitacao(solicitacao.id, [("nfe8888.xml", XML_NFE_CFOP_SEM_REGRA)])

    db_session.refresh(solicitacao)
    assert solicitacao.status == "erro"
