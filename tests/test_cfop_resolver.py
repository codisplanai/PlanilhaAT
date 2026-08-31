from app.models.perfil_regras import PerfilRegras
from app.models.regra_cfop import RegraCfopDestino
from app.services.rules_engine.cfop_resolver import CfopResolver

def _criar_perfil(db_session, nome="Perfil CFOP Teste"):
    perfil = PerfilRegras(nome=nome)
    db_session.add(perfil)
    db_session.commit()
    return perfil

def test_xml_e_sped_mesmo_sufixo_resolvem_para_o_mesmo_destino(db_session):
    """CFOP de saída no XML do emitente (6102) e de entrada no SPED do destinatário (2102)
    compartilham o mesmo sufixo de 3 dígitos e devem resolver para o mesmo destino."""
    perfil = _criar_perfil(db_session)
    resolver = CfopResolver(db_session)

    destino_xml = resolver.resolve_destino(perfil.id, "6102")
    destino_sped = resolver.resolve_destino(perfil.id, "2102")

    assert destino_xml == "antecipacao_parcial"
    assert destino_sped == "antecipacao_parcial"
    assert destino_xml == destino_sped

def test_regra_do_perfil_tem_precedencia_sobre_padrao_global(db_session):
    perfil = _criar_perfil(db_session)

    # Sobrescreve o padrão global (405 -> antecipacao_tributaria) para este perfil
    db_session.add(RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="405",
        destino="difal",
        descricao="Exceção deste perfil"
    ))
    db_session.commit()

    resolver = CfopResolver(db_session)
    assert resolver.resolve_destino(perfil.id, "6405") == "difal"

    # Outro perfil sem sobrescrita continua usando o padrão global
    outro_perfil = _criar_perfil(db_session, nome="Outro Perfil")
    assert resolver.resolve_destino(outro_perfil.id, "6405") == "antecipacao_tributaria"

def test_cfop_sem_regra_cadastrada_retorna_none(db_session):
    perfil = _criar_perfil(db_session)
    resolver = CfopResolver(db_session)
    assert resolver.resolve_destino(perfil.id, "6949") is None

def test_cfop_operacao_exterior_retorna_none(db_session):
    perfil = _criar_perfil(db_session)
    resolver = CfopResolver(db_session)
    # Séries 3xxx (importação) e 7xxx (exportação) não se aplicam ao roteamento de antecipação/DIFAL
    assert resolver.resolve_destino(perfil.id, "3102") is None
    assert resolver.resolve_destino(perfil.id, "7102") is None

def test_regra_ignorar_descarta_o_item(db_session):
    perfil = _criar_perfil(db_session)
    db_session.add(RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="910",
        destino="ignorar",
        descricao="Bonificação, doação, brinde"
    ))
    db_session.commit()

    resolver = CfopResolver(db_session)
    assert resolver.resolve_destino(perfil.id, "6910") is None

def test_cache_nao_retorna_resultado_obsoleto_entre_instancias(db_session):
    """O cache é interno à instância (um resolver por execução do pipeline); uma nova
    instância deve sempre refletir o estado atual do banco, não um valor global obsoleto."""
    perfil = _criar_perfil(db_session)

    resolver1 = CfopResolver(db_session)
    assert resolver1.resolve_destino(perfil.id, "6910") is None  # ainda sem regra cadastrada

    db_session.add(RegraCfopDestino(
        perfil_regras_id=perfil.id,
        cfop_sufixo="910",
        destino="difal",
        descricao="Regra criada após a primeira consulta"
    ))
    db_session.commit()

    resolver2 = CfopResolver(db_session)
    assert resolver2.resolve_destino(perfil.id, "6910") == "difal"
