import pytest
from datetime import date

from app.core.exceptions import ValidationException
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor

SPED_JANEIRO = """|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|
|0200|P1|PRODUTO|||UN|01|21069090|||18,00||
|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO|1,000|UN|2000,00|0,00|0|000|6102||2000,00|12,00|240,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
"""


def test_extrai_periodo_do_registro_0000():
    ini, fim = SpedFiscalExtractor.extract_periodo(SPED_JANEIRO.encode("utf-8"))
    assert ini == date(2026, 1, 1)
    assert fim == date(2026, 1, 31)


def test_periodo_none_quando_nao_ha_registro_0000():
    sped_sem_0000 = "|C100|0|1|F1|55|00|1|901|||10012026|20012026|2000,00|\n"
    ini, fim = SpedFiscalExtractor.extract_periodo(sped_sem_0000.encode("utf-8"))
    assert ini is None
    assert fim is None


def test_pipeline_bloqueia_sped_de_competencia_divergente(db_session, create_sample_excel_template):
    """Subir o SPED de fevereiro na apuração de janeiro deve falhar alto, não silenciosamente."""
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.empresa import Empresa
    from app.models.regra_aliquota import RegraAliquotaDestino
    from app.models.solicitacao import Solicitacao
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.templates_admin.template_manager import TemplateManager

    template_path = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(template_path, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session, tipo="antecipacao_parcial", filename="t.xlsx", file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    perfil = PerfilRegras(nome="Perfil Periodo SPED")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195", uf="BA",
                      perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    # Solicitação de FEVEREIRO, arquivo de JANEIRO
    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 2, 1),
                      periodo_fim=date(2026, 2, 28), tipo_planilha=None, status="pendente")
    db_session.add(sol)
    db_session.commit()

    pipeline = ProcessingPipelineService(db_session)
    with pytest.raises(ValidationException) as exc:
        pipeline.process_solicitacao(sol.id, sped_file_bytes=SPED_JANEIRO.encode("utf-8"))

    assert "01/2026" in str(exc.value) or "01/01/2026" in str(exc.value)


def test_pipeline_aceita_sped_da_competencia_correta(db_session, create_sample_excel_template):
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.empresa import Empresa
    from app.models.regra_aliquota import RegraAliquotaDestino
    from app.models.solicitacao import Solicitacao
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.templates_admin.template_manager import TemplateManager

    template_path = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(template_path, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session, tipo="antecipacao_parcial", filename="t.xlsx", file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    perfil = PerfilRegras(nome="Perfil Periodo SPED OK")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195", uf="BA",
                      perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                      periodo_fim=date(2026, 1, 31), tipo_planilha=None, status="pendente")
    db_session.add(sol)
    db_session.commit()

    pipeline = ProcessingPipelineService(db_session)
    res = pipeline.process_solicitacao(sol.id, sped_file_bytes=SPED_JANEIRO.encode("utf-8"))
    assert res.status == "concluido"
