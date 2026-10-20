from datetime import datetime
from decimal import Decimal

from app.constants import ANTECIPACAO_TRIBUTARIA
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData
from app.services.pipeline_service import ProcessingPipelineService


PASSO_CNPJ = "33906322000153"
PASSO_CONFIG = {
    "mva_revenda_antecipacao_tributaria": {
        "enabled": True,
        "empresa_cnpj": PASSO_CNPJ,
        "special_ncms": ["42022100", "64029990"],
        "description_fallback_ncms": [],
        "special_keywords": [],
        "exclusion_keywords": ["MOCHILA"],
        "mvas": {
            "especial": {"4": "61.81", "7": "56.75", "12": "48.33", "original": "34.00"},
            "demais": {"4": "69.06", "7": "63.77", "12": "54.97", "original": "40.00"},
        },
    }
}


def test_itens_com_ncms_distintos_e_mesma_mva_nao_desdobram(
    db_session, cenario_janeiro, monkeypatch
):
    solicitacao = cenario_janeiro(tipos=(ANTECIPACAO_TRIBUTARIA,))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()
    empresa.cnpj = PASSO_CNPJ
    empresa.razao_social = "Passo a Passo Calçados"
    empresa.perfil_regras.configuracoes_extras = PASSO_CONFIG
    db_session.commit()

    # Dois itens com NCMs diferentes, mas ambos no grupo especial com a mesma MVA 56.75%
    item1 = ExtractedItemNF(
        item_numero=1,
        ncm="42022100",
        cfop="6102",
        descricao="BOLSA FEMININA",
        descricao_confiavel=True,
        v_item=Decimal("2771.91"),
        v_total=Decimal("2952.07"),
        base_calculo=Decimal("2771.91"),
        ipi_despesas=Decimal("180.16"),
        a_ori=Decimal("0.07"),
    )
    item2 = ExtractedItemNF(
        item_numero=2,
        ncm="64029990",
        cfop="6102",
        descricao="SANDALIA RASTEIRA",
        descricao_confiavel=True,
        v_item=Decimal("1461.36"),
        v_total=Decimal("1461.36"),
        base_calculo=Decimal("1461.36"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.07"),
    )

    nf = ExtractedNFData(
        numero_nota="220588",
        serie="1",
        chave_acesso="35260198765432000180550010002205881000220588",
        cnpj_emitente="98765432000180",
        uf_emitente="SP",
        cnpj_destinatario=PASSO_CNPJ,
        uf_destinatario="BA",
        data_emissao=datetime(2026, 1, 15),
        v_total_nota=Decimal("4413.43"),
        v_bc_nota=Decimal("4233.27"),
        itens=[item1, item2],
        raw_metadata={"crt": "3"},
    )

    pipeline = ProcessingPipelineService(db_session)
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kw: type(
            "Sources",
            (),
            {
                "notes": [("220588.xml", nf)],
                "entry_records": {},
                "sped_company_info": None,
                "ignored_notes": [],
            },
        )(),
    )

    pipeline.process_solicitacao(
        solicitacao.id,
        xml_files_bytes=[("dummy.xml", b"<xml></xml>")],
    )

    notas = (
        db_session.query(NotaFiscalProcessada)
        .filter_by(solicitacao_id=solicitacao.id)
        .all()
    )

    # Deve gerar apenas 1 linha consolidada (sem desdobramento)
    assert len(notas) == 1
    assert notas[0].numero_nota == "220588"
    assert notas[0].item_numero == 1
    assert notas[0].metadados_extras["desdobramento"] is False
    assert notas[0].v_total == Decimal("4413.43")
    assert Decimal(str(notas[0].metadados_extras["mva"])) == Decimal("56.75")


def test_itens_com_mvas_distintas_desdobram_em_duas_linhas(
    db_session, cenario_janeiro, monkeypatch
):
    solicitacao = cenario_janeiro(tipos=(ANTECIPACAO_TRIBUTARIA,))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()
    empresa.cnpj = PASSO_CNPJ
    empresa.razao_social = "Passo a Passo Calçados"
    empresa.perfil_regras.configuracoes_extras = PASSO_CONFIG
    db_session.commit()

    # Item 1: NCM especial -> MVA 56.75%
    item1 = ExtractedItemNF(
        item_numero=1,
        ncm="42022100",
        cfop="6102",
        descricao="BOLSA FEMININA",
        descricao_confiavel=True,
        v_item=Decimal("2000.00"),
        v_total=Decimal("2000.00"),
        base_calculo=Decimal("2000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.07"),
    )
    # Item 2: NCM excluded por descrição MOCHILA -> vai para grupo 'demais' -> MVA 63.77%
    item2 = ExtractedItemNF(
        item_numero=2,
        ncm="42022100",
        cfop="6102",
        descricao="MOCHILA ESCOLAR",
        descricao_confiavel=True,
        v_item=Decimal("1000.00"),
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.07"),
    )

    nf = ExtractedNFData(
        numero_nota="220589",
        serie="1",
        chave_acesso="35260198765432000180550010002205891000220589",
        cnpj_emitente="98765432000180",
        uf_emitente="SP",
        cnpj_destinatario=PASSO_CNPJ,
        uf_destinatario="BA",
        data_emissao=datetime(2026, 1, 15),
        v_total_nota=Decimal("3000.00"),
        v_bc_nota=Decimal("3000.00"),
        itens=[item1, item2],
        raw_metadata={"crt": "3"},
    )

    pipeline = ProcessingPipelineService(db_session)
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kw: type(
            "Sources",
            (),
            {
                "notes": [("220589.xml", nf)],
                "entry_records": {},
                "sped_company_info": None,
                "ignored_notes": [],
            },
        )(),
    )

    pipeline.process_solicitacao(
        solicitacao.id,
        xml_files_bytes=[("dummy.xml", b"<xml></xml>")],
    )

    notas = (
        db_session.query(NotaFiscalProcessada)
        .filter_by(solicitacao_id=solicitacao.id)
        .order_by(NotaFiscalProcessada.item_numero)
        .all()
    )

    # Com MVAs diferentes (56.75% vs 63.77%), deve desdobrar em 2 linhas
    assert len(notas) == 2
    assert notas[0].metadados_extras["desdobramento"] is True
    assert notas[1].metadados_extras["desdobramento"] is True
    assert Decimal(str(notas[0].metadados_extras["mva"])) == Decimal("56.75")
    assert Decimal(str(notas[1].metadados_extras["mva"])) == Decimal("63.77")
