from datetime import datetime
from decimal import Decimal
import pytest

from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData
from app.services.pipeline_service import ProcessingPipelineService


def test_pipeline_reclassifica_produto_e_separa_em_planilhas_distintas(
    db_session, cenario_janeiro, monkeypatch
):
    # cenario_janeiro prepara empresa, perfil e templates ativos para os tipos informados
    solicitacao = cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_tributaria"))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()
    perfil_id = empresa.perfil_regras_id

    # Garante roteamento de CFOP 102 -> parcial e 405 -> tributária
    db_session.add_all([
        RegraCfopDestino(perfil_regras_id=perfil_id, cfop_sufixo="102", destino="antecipacao_parcial"),
        RegraCfopDestino(perfil_regras_id=perfil_id, cfop_sufixo="405", destino="antecipacao_tributaria"),
    ])

    # Regra: NCM 73269090 com 'GRAMPO*' deve ser reclassificado de 102 para 405 (ST)
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil_id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
        descricao="Grampos de aco sujeitos a ST",
    )
    db_session.add(regra)
    db_session.commit()

    # Nota com os dois produtos do exemplo do usuário, ambos emitidos com CFOP 6102
    item1 = ExtractedItemNF(
        item_numero=1,
        ncm="73269090",
        cfop="6102",
        descricao="Estic.P/Cabo aco...",
        descricao_confiavel=True,
        v_item=Decimal("100.00"),
        v_total=Decimal("100.00"),
        base_calculo=Decimal("100.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.12"),
    )
    item2 = ExtractedItemNF(
        item_numero=2,
        ncm="73269090",
        cfop="6102",
        descricao="Grampo Cb.aco leve..",
        descricao_confiavel=True,
        v_item=Decimal("200.00"),
        v_total=Decimal("200.00"),
        base_calculo=Decimal("200.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.12"),
    )
    nf_data = ExtractedNFData(
        chave_acesso="35260112345678000195550010000000011000000010",
        numero_nota="1",
        serie="1",
        cnpj_emitente="99999999000199",
        uf_emitente="SP",
        cnpj_destinatario=empresa.cnpj,
        uf_destinatario=empresa.uf,
        data_emissao=datetime(2026, 1, 15),
        v_total_nota=Decimal("300.00"),
        v_bc_nota=Decimal("300.00"),
        itens=[item1, item2],
    )

    pipeline = ProcessingPipelineService(db_session)
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kw: type("Sources", (), {
            "notes": [("dummy.xml", nf_data)],
            "entry_records": {},
            "sped_company_info": None,
            "ignored_notes": [],
        })(),
    )

    sol_processada = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("dummy.xml", b"<xml/>")],
    )

    assert sol_processada.status == "concluido"

    notas = db_session.query(NotaFiscalProcessada).filter_by(solicitacao_id=solicitacao.id).all()
    assert len(notas) == 2

    # Nota 1: Esticador permaneceu no 6102 -> Antecipação Parcial
    nota_parcial = next(n for n in notas if n.destino_planilha == "antecipacao_parcial")
    assert nota_parcial.cfop == "6102"
    assert nota_parcial.metadados_extras.get("cfop_reclassificado") is False

    # Nota 2: Grampo foi reclassificado para 6405 -> Antecipação Tributária
    nota_st = next(n for n in notas if n.destino_planilha == "antecipacao_tributaria")
    assert nota_st.cfop == "6405"
    assert nota_st.metadados_extras.get("cfop_reclassificado") is True
    assert "Grampos de aco sujeitos a ST" in nota_st.metadados_extras.get("detalhe_cfop", "")
