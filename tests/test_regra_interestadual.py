from app.services.validation.sanity_checker import SanityChecker


def test_operacao_interestadual_ufs_diferentes():
    assert SanityChecker.is_interestadual("SP", "BA") is True
    assert SanityChecker.is_interestadual("PE", "BA") is True


def test_operacao_interna_mesma_uf():
    assert SanityChecker.is_interestadual("BA", "BA") is False
    assert SanityChecker.is_interestadual("sp", "SP") is False


def test_uf_ausente_nao_bloqueia_apuracao():
    assert SanityChecker.is_interestadual("", "BA") is True
    assert SanityChecker.is_interestadual("SP", "") is True
    assert SanityChecker.is_interestadual(None, "BA") is True
