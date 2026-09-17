import pytest
from app.models.perfil_regras import PerfilRegras
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_reclassificacao_cfop import ExcecaoReclassificacaoCfop, RegraReclassificacaoCfop
from app.services.rules_engine.cfop_resolver import CfopResolver


@pytest.fixture
def cenario_reclassificacao(db_session):
    perfil = PerfilRegras(nome="Perfil Teste Reclassificacao")
    db_session.add(perfil)
    db_session.flush()

    # Roteamento padrão de CFOP:
    # 102 -> antecipacao_parcial
    # 405 -> antecipacao_tributaria
    # 403 -> antecipacao_tributaria
    # 556 -> difal
    for sufixo, destino in [
        ("102", "antecipacao_parcial"),
        ("405", "antecipacao_tributaria"),
        ("403", "antecipacao_tributaria"),
        ("556", "difal"),
    ]:
        db_session.add(RegraCfopDestino(
            perfil_regras_id=perfil.id,
            cfop_sufixo=sufixo,
            destino=destino,
        ))
    db_session.commit()
    return perfil


def test_reclassifica_cfop_por_ncm_e_termo_inclusao(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
        descricao="Grampos sujeitos a ST",
    )
    db_session.add(regra)
    db_session.commit()

    resolver = CfopResolver(db_session)
    res = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo Cb.aco leve..",
        cfop_original="6102",
    )
    assert res.reclassificado is True
    assert res.cfop_efetivo == "6405"
    assert res.sufixo_efetivo == "405"
    assert res.destino == "antecipacao_tributaria"


def test_mantem_cfop_original_quando_descricao_nao_casa(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
    )
    db_session.add(regra)
    db_session.commit()

    resolver = CfopResolver(db_session)
    res = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Estic.P/Cabo aco...",
        cfop_original="6102",
    )
    assert res.reclassificado is False
    assert res.cfop_efetivo == "6102"
    assert res.sufixo_efetivo == "102"
    assert res.destino == "antecipacao_parcial"


def test_preserva_primeiro_digito_da_operacao(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
    )
    db_session.add(regra)
    db_session.commit()

    resolver = CfopResolver(db_session)
    # Entrada interestadual (2xxx)
    res_entrada = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo A",
        cfop_original="2102",
    )
    assert res_entrada.cfop_efetivo == "2405"

    # Saída interna / estadual (5xxx)
    res_interna = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo A",
        cfop_original="5102",
    )
    assert res_interna.cfop_efetivo == "5405"


def test_reclassifica_por_ncm_puro_quando_sem_termos(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="84713012",
        cfop_destino_sufixo="405",
        termos_inclusao=[],  # sem termos = vale para qualquer descrição
    )
    db_session.add(regra)
    db_session.commit()

    resolver = CfopResolver(db_session)
    res = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="84713012",
        descricao="Notebook Dell Latitude",
        cfop_original="6102",
    )
    assert res.reclassificado is True
    assert res.cfop_efetivo == "6405"


def test_regra_com_termos_vence_regra_ncm_puro(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    # Regra genérica para NCM 73269090 -> 403
    regra_generica = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="403",
        termos_inclusao=[],
    )
    # Regra específica para Grampos -> 405
    regra_especifica = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
    )
    db_session.add_all([regra_generica, regra_especifica])
    db_session.commit()

    resolver = CfopResolver(db_session)
    # Grampo deve cair na específica (405)
    res_grampo = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo Cb Aco",
        cfop_original="6102",
    )
    assert res_grampo.cfop_efetivo == "6405"

    # Outro item deve cair na genérica (403)
    res_outro = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Outra peca qualquer",
        cfop_original="6102",
    )
    assert res_outro.cfop_efetivo == "6403"


def test_filtro_cfop_origem(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    # Só reclassifica se o item veio com 102
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_origem_sufixo="102",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
    )
    db_session.add(regra)
    db_session.commit()

    resolver = CfopResolver(db_session)
    # Veio com 6102 (sufixo 102) -> reclassifica
    res_ok = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo A",
        cfop_original="6102",
    )
    assert res_ok.reclassificado is True
    assert res_ok.cfop_efetivo == "6405"

    # Veio com 6556 (sufixo 556) -> não reclassifica
    res_ignorado = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo A",
        cfop_original="6556",
    )
    assert res_ignorado.reclassificado is False
    assert res_ignorado.cfop_efetivo == "6556"
    assert res_ignorado.destino == "difal"


def test_excecao_exata_impede_reclassificacao(db_session, cenario_reclassificacao):
    perfil = cenario_reclassificacao
    regra = RegraReclassificacaoCfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        cfop_destino_sufixo="405",
        termos_inclusao=["GRAMPO*"],
    )
    db_session.add(regra)
    db_session.flush()

    db_session.add(ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra.id,
        descricao_exata="GRAMPO ESPECIAL INOX",
        aplicar=False,
    ))
    db_session.commit()

    resolver = CfopResolver(db_session)
    res = resolver.reclassificar_cfop(
        perfil_regras_id=perfil.id,
        ncm="73269090",
        descricao="Grampo Especial Inox",
        cfop_original="6102",
    )
    assert res.reclassificado is False
    assert res.cfop_efetivo == "6102"
    assert res.destino == "antecipacao_parcial"
