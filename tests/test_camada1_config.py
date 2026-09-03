import pytest
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


def test_mesmo_ncm_aceita_mais_de_uma_regra_de_reducao(db_session):
    """O mesmo NCM comporta produtos que se enquadram e produtos que não:
    7214.20 tem vergalhão a 12% e barra chata a 18%."""
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Reducao")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"), descricao="Vergalhoes"))
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["barra chata"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas"))
    db_session.commit()

    regras = db_session.query(RegraReducaoProduto).filter(
        RegraReducaoProduto.ncm == "72142000").all()
    assert len(regras) == 2


def test_excecao_nao_aceita_descricao_duplicada_na_mesma_regra(db_session):
    from decimal import Decimal
    from sqlalchemy.exc import IntegrityError
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Excecao")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"))
    db_session.add(regra)
    db_session.commit()

    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.commit()

    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=True))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_empresa_tem_no_maximo_um_termo_de_acordo(db_session):
    from decimal import Decimal
    from sqlalchemy.exc import IntegrityError
    from app.models.empresa import Empresa
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa

    perfil = PerfilRegras(nome="Perfil Acordo")
    db_session.add(perfil)
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195",
                      uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()

    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1000")))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_excluir_regra_de_reducao_leva_as_excecoes_junto(db_session):
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Cascade")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"))
    regra.excecoes.append(ExcecaoReducaoProduto(
        descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.add(regra)
    db_session.commit()

    db_session.delete(regra)
    db_session.commit()
    assert db_session.query(ExcecaoReducaoProduto).count() == 0
