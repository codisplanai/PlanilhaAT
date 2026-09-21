from datetime import datetime
from decimal import Decimal

from app.constants import ANTECIPACAO_TRIBUTARIA
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData
from app.services.pipeline_service import ProcessingPipelineService


PASSO_CNPJ = "33906322000153"
PASSO_CONFIG = {
    "antecipacao_tributaria_revenda": {
        "enabled": True,
        "empresa_cnpj": PASSO_CNPJ,
        "destinos_revenda": ["antecipacao_parcial"],
        "special_ncms": ["64039990"],
        "description_fallback_ncms": ["62171000"],
        "description_fallback_terms": ["CINTO", "CINTOS"],
        "special_exclusion_terms": ["MOCHILA", "MALA", "NECESSAIRE", "PALMILHA", "CALCANHEIRA"],
        "mva": {
            "especial": {"4": "61.81", "7": "56.75", "12": "48.33", "original": "34.00"},
            "demais": {"4": "69.06", "7": "63.77", "12": "54.97", "original": "40.00"},
        },
    }
}


def _nf(*, numero: str, uf_emitente: str, cnpj_destinatario: str) -> ExtractedNFData:
    item = ExtractedItemNF(
        item_numero=1,
        ncm="64039990",
        cfop="6102",
        descricao="CALCADO FEMININO",
        descricao_confiavel=True,
        v_item=Decimal("1000.00"),
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.07"),
    )
    return ExtractedNFData(
        numero_nota=numero,
        serie="1",
        chave_acesso=(numero.zfill(44))[-44:],
        cnpj_emitente="98765432000180",
        uf_emitente=uf_emitente,
        cnpj_destinatario=cnpj_destinatario,
        uf_destinatario="BA",
        data_emissao=datetime(2026, 1, 15),
        v_total_nota=Decimal("1000.00"),
        v_bc_nota=Decimal("1000.00"),
        itens=[item],
        raw_metadata={"crt": "3"},
    )


def test_passo_a_passo_revenda_vai_para_tributaria_sem_alterar_filtro_interestadual(
    db_session, cenario_janeiro, monkeypatch
):
    solicitacao = cenario_janeiro(tipos=(ANTECIPACAO_TRIBUTARIA,))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()
    empresa.cnpj = PASSO_CNPJ
    empresa.razao_social = "Passo a Passo Calçados"
    empresa.perfil_regras.configuracoes_extras = PASSO_CONFIG
    db_session.commit()

    nf_interestadual = _nf(numero="1001", uf_emitente="SP", cnpj_destinatario=PASSO_CNPJ)
    nf_bahia = _nf(numero="1002", uf_emitente="BA", cnpj_destinatario=PASSO_CNPJ)

    pipeline = ProcessingPipelineService(db_session)
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kw: type(
            "Sources",
            (),
            {
                "notes": [("sp.xml", nf_interestadual), ("ba.xml", nf_bahia)],
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
    assert len(notas) == 1
    assert notas[0].numero_nota == "1001"
    assert notas[0].destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert Decimal(str(notas[0].metadados_extras["mva"])) == Decimal("56.75")

    db_session.refresh(solicitacao)
    assert any(
        "Operação interna estadual desconsiderada" in item.get("motivo", "")
        for item in solicitacao.notas_ignoradas
    )


def test_empresa_sem_config_especial_continua_com_roteamento_normal(
    db_session, cenario_janeiro, monkeypatch
):
    solicitacao = cenario_janeiro(tipos=("antecipacao_parcial",))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()

    nf = _nf(numero="2001", uf_emitente="SP", cnpj_destinatario=empresa.cnpj)
    nf.cnpj_destinatario = empresa.cnpj

    pipeline = ProcessingPipelineService(db_session)
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kw: type(
            "Sources",
            (),
            {
                "notes": [("normal.xml", nf)],
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

    nota = (
        db_session.query(NotaFiscalProcessada)
        .filter_by(solicitacao_id=solicitacao.id)
        .one()
    )
    assert nota.destino_planilha == "antecipacao_parcial"
