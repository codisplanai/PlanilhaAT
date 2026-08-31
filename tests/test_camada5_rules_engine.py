import pytest
from decimal import Decimal
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.services.rules_engine.aliquota_resolver import AliquotaResolver
from app.core.exceptions import RuleResolutionException

def test_rules_engine_precedencia_ncm(db_session):
    perfil = PerfilRegras(nome="Perfil Teste BA")
    db_session.add(perfil)
    db_session.commit()

    # Padrão BA: 18%
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm=None,
        aliquota=Decimal("0.1800")
    ))
    # Exceção NCM 84713012: 20.5%
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id,
        uf="BA",
        ncm="84713012",
        aliquota=Decimal("0.2050")
    ))
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    # 1. Deve resolver a exceção do NCM específico (20.5%)
    aliquota_ncm = resolver.resolve_a_dst(perfil.id, "BA", "84713012")
    assert aliquota_ncm == Decimal("0.2050")

    # 2. Para outro NCM sem exceção, deve usar a regra padrão estadual (18%)
    aliquota_outro_ncm = resolver.resolve_a_dst(perfil.id, "BA", "39269090")
    assert aliquota_outro_ncm == Decimal("0.1800")

    # 3. Para UF sem regra cadastrada, deve lançar exceção explicativa
    with pytest.raises(RuleResolutionException) as exc_info:
        resolver.resolve_a_dst(perfil.id, "SP", "84713012")
    assert "Nenhuma regra de alíquota de destino" in str(exc_info.value)
