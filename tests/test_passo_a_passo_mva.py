from datetime import date, datetime
from decimal import Decimal

import pytest

from app.constants import ANTECIPACAO_PARCIAL, ANTECIPACAO_TRIBUTARIA
from app.core.exceptions import ValidationException
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData
from app.services.pipeline_outputs import GeneratedArtifacts
from app.services.pipeline_service import ProcessingPipelineService
from app.services.rules_engine.revenda_antecipacao_policy import (
    PROFILE_CONFIG_KEY,
    RevendaAntecipacaoTributariaPolicy,
)


POLICY_CONFIG = {
    "enabled": True,
    "empresa_cnpj": "33906322000153",
    "special_ncms": ["64039990"],
    "description_fallback_ncms": ["61178090"],
    "special_keywords": ["CINTO", "CINTOS"],
    "exclusion_keywords": ["MOCHILA", "PALMILHA", "CALCANHEIRA"],
    "mvas": {
        "especial": {"4": "61.81", "7": "56.75", "12": "48.33", "original": "34.00"},
        "demais": {"4": "69.06", "7": "63.77", "12": "54.97", "original": "40.00"},
    },
}


def test_politica_especial_exige_cnpj_configurado():
    configuracoes = {PROFILE_CONFIG_KEY: POLICY_CONFIG}

    assert RevendaAntecipacaoTributariaPolicy.config_for_empresa(
        configuracoes,
        "33.906.322/0001-53",
    ) is not None
    assert RevendaAntecipacaoTributariaPolicy.config_for_empresa(
        configuracoes,
        "12345678000195",
    ) is None


@pytest.mark.parametrize(
    ("grupo", "a_ori", "simples", "esperado"),
    [
        ("especial", Decimal("0.04"), False, Decimal("61.81")),
        ("especial", Decimal("0.07"), False, Decimal("56.75")),
        ("especial", Decimal("0.12"), False, Decimal("48.33")),
        ("especial", Decimal("0.12"), True, Decimal("34.00")),
        ("demais", Decimal("0.04"), False, Decimal("69.06")),
        ("demais", Decimal("0.07"), False, Decimal("63.77")),
        ("demais", Decimal("0.12"), False, Decimal("54.97")),
        ("demais", Decimal("0.12"), True, Decimal("40.00")),
    ],
)
def test_tabela_mva_passo_a_passo(grupo, a_ori, simples, esperado):
    assert RevendaAntecipacaoTributariaPolicy.resolve_mva(
        config=POLICY_CONFIG,
        grupo=grupo,
        a_ori=a_ori,
        fornecedor_simples=simples,
    ) == esperado


def test_classificacao_especial_por_ncm_e_fallback_controlado():
    exato = RevendaAntecipacaoTributariaPolicy.classify(
        config=POLICY_CONFIG,
        ncm="64039990",
        descricao="SAPATO FEMININO",
        descricao_confiavel=True,
    )
    assert exato.grupo == "especial"
    assert exato.fonte == "ncm_exato"

    fallback = RevendaAntecipacaoTributariaPolicy.classify(
        config=POLICY_CONFIG,
        ncm="61178090",
        descricao="CINTO MASCULINO COURO",
        descricao_confiavel=True,
    )
    assert fallback.grupo == "especial"
    assert fallback.fonte == "ncm_fallback_descricao"

    generico = RevendaAntecipacaoTributariaPolicy.classify(
        config=POLICY_CONFIG,
        ncm="61178090",
        descricao="ACESSORIO TEXTIL",
        descricao_confiavel=True,
    )
    assert generico.grupo == "demais"


def test_exclusoes_de_descricao_nao_entram_no_grupo_especial():
    classificado = RevendaAntecipacaoTributariaPolicy.classify(
        config=POLICY_CONFIG,
        ncm="64039990",
        descricao="PALMILHA CONFORTO",
        descricao_confiavel=True,
    )
    assert classificado.grupo == "demais"
    assert classificado.fonte == "descricao_exclusao"


def _criar_cenario(db_session, *, config_especial: bool):
    perfil = PerfilRegras(
        nome="Passo a Passo Teste" if config_especial else "Outra Empresa Teste",
        configuracoes_extras={PROFILE_CONFIG_KEY: POLICY_CONFIG} if config_especial else {},
    )
    db_session.add(perfil)
    db_session.commit()

    db_session.add(
        RegraAliquotaDestino(
            perfil_regras_id=perfil.id,
            uf="BA",
            ncm=None,
            aliquota=Decimal("0.2050"),
            descricao="Alíquota BA",
            parametros_extras={},
        )
    )
    db_session.commit()

    empresa = Empresa(
        razao_social="Passo a Passo calcados" if config_especial else "Outra Empresa",
        cnpj="33906322000153" if config_especial else "12345678000195",
        inscricao_estadual="26058360" if config_especial else None,
        uf="BA",
        perfil_regras_id=perfil.id,
        optante_simples_nacional=False,
    )
    db_session.add(empresa)
    db_session.commit()

    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 8, 1),
        periodo_fim=date(2026, 8, 31),
        tipo_planilha=None,
        status="pendente",
    )
    db_session.add(solicitacao)
    db_session.commit()
    return empresa, solicitacao


def _nf(*, empresa, uf_emitente="SP", ncm="64039990", a_ori="0.12", crt="3"):
    item = ExtractedItemNF(
        item_numero=1,
        ncm=ncm,
        cfop="6102",
        descricao="SAPATO FEMININO",
        descricao_confiavel=True,
        v_item=Decimal("1000.00"),
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal(a_ori),
    )
    return ExtractedNFData(
        numero_nota="1001",
        serie="1",
        chave_acesso="1" * 44,
        cnpj_emitente="98765432000180",
        uf_emitente=uf_emitente,
        cnpj_destinatario=empresa.cnpj,
        uf_destinatario=empresa.uf,
        data_emissao=datetime(2026, 8, 10),
        v_total_nota=Decimal("1000.00"),
        v_bc_nota=Decimal("1000.00"),
        itens=[item],
        raw_metadata={"crt": crt},
    )


def _executar(db_session, empresa, solicitacao, nf, monkeypatch):
    pipeline = ProcessingPipelineService(db_session)
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kwargs: type(
            "Sources",
            (),
            {
                "notes": [("nota.xml", nf)],
                "entry_records": {},
                "sped_company_info": None,
                "ignored_notes": [],
            },
        )(),
    )
    monkeypatch.setattr(
        pipeline.output_service,
        "generate",
        lambda **kwargs: GeneratedArtifacts(),
    )
    pipeline.process_solicitacao(
        solicitacao.id,
        xml_files_bytes=[("nota.xml", b"<xml/>")],
    )
    return (
        db_session.query(NotaFiscalProcessada)
        .filter_by(solicitacao_id=solicitacao.id)
        .one()
    )


def test_perfil_passo_a_passo_redireciona_revenda_para_tributaria(db_session, monkeypatch):
    empresa, solicitacao = _criar_cenario(db_session, config_especial=True)
    processada = _executar(
        db_session,
        empresa,
        solicitacao,
        _nf(empresa=empresa, a_ori="0.07"),
        monkeypatch,
    )

    assert processada.destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert processada.metadados_extras["mva"] == "56.75"
    assert processada.metadados_extras["mva_grupo"] == "especial"
    assert processada.metadados_extras["fornecedor_simples_nacional"] is False


def test_fornecedor_simples_usa_mva_original(db_session, monkeypatch):
    empresa, solicitacao = _criar_cenario(db_session, config_especial=True)
    processada = _executar(
        db_session,
        empresa,
        solicitacao,
        _nf(empresa=empresa, a_ori="0.07", crt="1"),
        monkeypatch,
    )

    assert processada.destino_planilha == ANTECIPACAO_TRIBUTARIA
    assert processada.metadados_extras["mva"] == "34.00"
    assert processada.metadados_extras["fornecedor_simples_nacional"] is True


def test_outra_empresa_permanece_no_fluxo_atual(db_session, monkeypatch):
    empresa, solicitacao = _criar_cenario(db_session, config_especial=False)
    processada = _executar(
        db_session,
        empresa,
        solicitacao,
        _nf(empresa=empresa),
        monkeypatch,
    )
    assert processada.destino_planilha == ANTECIPACAO_PARCIAL


def test_regra_interestadual_continua_precedendo_politica_especial(db_session, monkeypatch):
    empresa, solicitacao = _criar_cenario(db_session, config_especial=True)
    pipeline = ProcessingPipelineService(db_session)
    nf = _nf(empresa=empresa, uf_emitente="BA")
    monkeypatch.setattr(
        pipeline.source_loader,
        "load",
        lambda **kwargs: type(
            "Sources",
            (),
            {
                "notes": [("nota.xml", nf)],
                "entry_records": {},
                "sped_company_info": None,
                "ignored_notes": [],
            },
        )(),
    )

    called = {"generate": False}

    def _generate(**kwargs):
        called["generate"] = True
        return GeneratedArtifacts()

    monkeypatch.setattr(pipeline.output_service, "generate", _generate)

    with pytest.raises(ValidationException, match="interestadual"):
        pipeline.process_solicitacao(
            solicitacao.id,
            xml_files_bytes=[("nota.xml", b"<xml/>")],
        )

    assert called["generate"] is False
    assert (
        db_session.query(NotaFiscalProcessada)
        .filter_by(solicitacao_id=solicitacao.id)
        .count()
        == 0
    )
