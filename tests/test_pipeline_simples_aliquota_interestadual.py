from datetime import date, datetime
from decimal import Decimal
import pytest

from app.constants import ANTECIPACAO_PARCIAL, DIFAL
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.solicitacao import Solicitacao
from app.services.pipeline_service import ProcessingPipelineService
from app.services.templates_admin.template_manager import TemplateManager


def _build_nfe_xml(
    numero: str,
    uf_emit: str,
    crt: str,
    orig: str,
    csosn: str,
    p_cred: str = "0.00",
    cfop: str = "6102",
    v_prod: str = "1000.00",
) -> bytes:
    p_cred_tag = f"<pCredSN>{p_cred}</pCredSN>" if Decimal(p_cred) > 0 else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe3526019999999900019955001000000{numero.zfill(3)}1000000100">
          <ide>
            <cUF>35</cUF>
            <nNF>{numero}</nNF>
            <serie>1</serie>
            <dhEmi>2026-07-15T10:00:00-03:00</dhEmi>
          </ide>
          <emit>
            <CNPJ>99999999000199</CNPJ>
            <xNome>FORNECEDOR TESTE SIMPLES</xNome>
            <CRT>{crt}</CRT>
            <enderEmit>
              <UF>{uf_emit}</UF>
            </enderEmit>
          </emit>
          <dest>
            <CNPJ>12345678000195</CNPJ>
            <enderDest>
              <UF>BA</UF>
            </enderDest>
          </dest>
          <total>
            <ICMSTot>
              <vNF>{v_prod}</vNF>
              <vBC>0.00</vBC>
              <vICMS>0.00</vICMS>
            </ICMSTot>
          </total>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM>
              <CFOP>{cfop}</CFOP>
              <xProd>NOTEBOOK TESTE</xProd>
              <vProd>{v_prod}</vProd>
            </prod>
            <imposto>
              <ICMS>
                <ICMSSN{csosn}>
                  <orig>{orig}</orig>
                  <CSOSN>{csosn}</CSOSN>
                  {p_cred_tag}
                </ICMSSN{csosn}>
              </ICMS>
            </imposto>
          </det>
        </infNFe>
      </NFe>
    </nfeProc>""".encode("utf-8")


def _setup_pipeline_env(db_session, create_sample_excel_template):
    # Template Parcial
    path_parcial = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(path_parcial, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session,
            tipo="antecipacao_parcial",
            filename="tpl_parcial.xlsx",
            file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    # Template DIFAL
    path_difal = create_sample_excel_template(tipo="difal")
    with open(path_difal, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session,
            tipo="difal",
            filename="tpl_difal.xlsx",
            file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    perfil = PerfilRegras(
        nome="Perfil Simples Aliquota Teste",
        descricao="Perfil para teste de alíquotas interestaduais",
    )
    db_session.add(perfil)
    db_session.flush()

    db_session.add(RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="102",
        destino="antecipacao_parcial",
    ))
    db_session.add(RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="556",
        destino="difal",
    ))

    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.2050"),
        descricao="Alíquota Padrão BA 20.5%",
    ))

    empresa = Empresa(
        razao_social="Empresa Cliente BA",
        cnpj="12345678000195",
        uf="BA",
        optante_simples_nacional=False,
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.commit()

    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        tipo_planilha="multi",
        periodo_inicio=date(2026, 7, 1),
        periodo_fim=date(2026, 7, 31),
        status="pendente",
    )
    db_session.add(solicitacao)
    db_session.commit()

    return empresa, solicitacao


def test_pipeline_simples_sem_destaque_aplica_7_porcento_sp_para_ba(db_session, create_sample_excel_template):
    empresa, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    xml_content = _build_nfe_xml(numero="101", uf_emit="SP", crt="1", orig="0", csosn="102", v_prod="1000.00")

    pipeline = ProcessingPipelineService(db_session)
    solicitacao = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_101.xml", xml_content)],
        sped_file_bytes=None,
    )

    assert len(solicitacao.notas_processadas) == 1
    nota = solicitacao.notas_processadas[0]
    # SP -> BA (Sul/Sudeste para Nordeste): 7%
    assert nota.a_ori == Decimal("0.07")
    assert nota.metadados_extras.get("a_ori_inferida_simples") is True
    # Base = 1000.00, Crédito = 1000.00 * 0.07 = 70.00
    assert nota.credito == Decimal("70.00")
    # Débito = 1000.00 * 0.205 = 205.00
    assert nota.debito == Decimal("205.00")
    assert nota.valor_devido == Decimal("135.00")

    # Verifica presença do aviso informativo de auditoria
    avisos = [a for a in solicitacao.avisos_avaliacao if "Alíquota interestadual de 7% aplicada automaticamente" in a.get("aviso", "")]
    assert len(avisos) >= 1


def test_pipeline_simples_importado_aplica_4_porcento(db_session, create_sample_excel_template):
    empresa, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    # Origem 1 = Importada direta
    xml_content = _build_nfe_xml(numero="102", uf_emit="SP", crt="1", orig="1", csosn="102", v_prod="1000.00")

    pipeline = ProcessingPipelineService(db_session)
    solicitacao = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_102.xml", xml_content)],
        sped_file_bytes=None,
    )

    assert len(solicitacao.notas_processadas) == 1
    nota = solicitacao.notas_processadas[0]
    assert nota.a_ori == Decimal("0.04")
    assert nota.metadados_extras.get("a_ori_inferida_simples") is True
    assert nota.credito == Decimal("40.00")
    assert nota.valor_devido == Decimal("165.00")


def test_pipeline_simples_nordeste_aplica_12_porcento(db_session, create_sample_excel_template):
    empresa, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    # PE -> BA (Nordeste -> Nordeste) = 12%
    xml_content = _build_nfe_xml(numero="103", uf_emit="PE", crt="1", orig="0", csosn="102", v_prod="1000.00")

    pipeline = ProcessingPipelineService(db_session)
    solicitacao = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_103.xml", xml_content)],
        sped_file_bytes=None,
    )

    assert len(solicitacao.notas_processadas) == 1
    nota = solicitacao.notas_processadas[0]
    assert nota.a_ori == Decimal("0.12")
    assert nota.metadados_extras.get("a_ori_inferida_simples") is True
    assert nota.credito == Decimal("120.00")
    assert nota.valor_devido == Decimal("85.00")


def test_pipeline_simples_com_destaque_preserva_aliquota_destacada(db_session, create_sample_excel_template):
    empresa, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    # Simples com pCredSN = 2.5%
    xml_content = _build_nfe_xml(
        numero="104", uf_emit="SP", crt="1", orig="0", csosn="101", p_cred="2.50", v_prod="1000.00"
    )

    pipeline = ProcessingPipelineService(db_session)
    solicitacao = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_104.xml", xml_content)],
        sped_file_bytes=None,
    )

    assert len(solicitacao.notas_processadas) == 1
    nota = solicitacao.notas_processadas[0]
    # Mantém 2.50% (0.025) e NÃO altera para 7%
    assert nota.a_ori == Decimal("0.025")
    assert nota.metadados_extras.get("a_ori_inferida_simples") is not True
    assert nota.credito == Decimal("25.00")
    # Não deve ter aviso de inferência automática
    avisos = [a for a in solicitacao.avisos_avaliacao if "aplicada automaticamente" in a.get("aviso", "")]
    assert len(avisos) == 0


def test_pipeline_simples_difal_sem_destaque_usa_aliquota_interestadual(db_session, create_sample_excel_template):
    empresa, solicitacao = _setup_pipeline_env(db_session, create_sample_excel_template)
    # CFOP 2556 -> DIFAL, SP -> BA
    xml_content = _build_nfe_xml(
        numero="105", uf_emit="SP", crt="1", orig="0", csosn="102", cfop="2556", v_prod="1000.00"
    )

    pipeline = ProcessingPipelineService(db_session)
    solicitacao = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("nfe_105.xml", xml_content)],
        sped_file_bytes=None,
    )

    assert len(solicitacao.notas_processadas) == 1
    nota = solicitacao.notas_processadas[0]
    assert nota.destino_planilha == DIFAL
    assert nota.a_ori == Decimal("0.07")
    assert nota.metadados_extras.get("aliq_simples") == "S"
    assert nota.metadados_extras.get("a_ori_inferida_simples") is True
    # DIFAL formula com aliq_simples == 'S':
    # base_st = 1000.00 / (1 - 0.205) = 1257.86
    # valor_devido = base_st * (0.205 - 0.07) = 1257.86 * 0.135 = 169.81
    assert nota.valor_devido == Decimal("169.81")
