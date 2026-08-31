from decimal import Decimal
from app.models.perfil_regras import PerfilRegras
from app.models.empresa import Empresa
from app.models.regra_aliquota import RegraAliquotaDestino

def test_criar_perfil_e_empresa(db_session):
    perfil = PerfilRegras(
        nome="Perfil Comércio BA",
        descricao="Perfil padrão para empresas baianas",
        configuracoes_extras={"regime": "lucro_presumido"}
    )
    db_session.add(perfil)
    db_session.commit()
    db_session.refresh(perfil)

    assert perfil.id is not None
    assert perfil.nome == "Perfil Comércio BA"

    # Criar empresa vinculada
    empresa = Empresa(
        razao_social="Alpha Comercial LTDA",
        cnpj="12345678000195",
        uf="BA",
        perfil_regras_id=perfil.id
    )
    db_session.add(empresa)
    db_session.commit()
    db_session.refresh(empresa)

    assert empresa.id is not None
    assert empresa.perfil_regras.nome == "Perfil Comércio BA"

def test_criar_regras_aliquotas_padrao_e_excecao(db_session):
    perfil = PerfilRegras(nome="Perfil Padrão")
    db_session.add(perfil)
    db_session.commit()

    # Regra padrão estadual BA (NCM = None) -> 18%
    regra_padrao = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.1800"),
        descricao="Alíquota interna padrão BA"
    )
    # Regra exceção informática BA (NCM = 84713012) -> 12% ou 20.5%
    regra_excecao = RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="84713012",
        aliquota=Decimal("0.2050"),
        descricao="Alíquota com FECOP BA"
    )
    db_session.add_all([regra_padrao, regra_excecao])
    db_session.commit()

    regras = db_session.query(RegraAliquotaDestino).filter_by(perfil_regras_id=perfil.id).all()
    assert len(regras) == 2
