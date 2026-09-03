from app.services.rules_engine.descricao_matcher import casa_algum, casa_termo, normalizar


def test_normalizar_remove_acento_pontuacao_e_caixa():
    assert normalizar("Vergalhão CA-50 10,0mm") == "VERGALHAO CA 50 10 0MM"


def test_normalizar_texto_ausente_vira_string_vazia():
    assert normalizar(None) == ""
    assert normalizar("   ") == ""
    assert normalizar("---") == ""


def test_pontuacao_diferente_converge_para_a_mesma_forma():
    assert normalizar("VERG. CA50") == normalizar("VERG CA50")


def test_termo_casa_token_completo():
    assert casa_termo(normalizar("Vergalhão CA-50"), "vergalhao") is True


def test_termo_nao_casa_pedaco_de_palavra():
    # "ferro" dentro de "FERROVIARIO" não é o produto "ferro"
    assert casa_termo(normalizar("Dormente ferroviario"), "ferro") is False
    assert casa_termo(normalizar("Tecido acolchoado"), "aco") is False


def test_termo_singular_nao_casa_plural_sem_wildcard():
    assert casa_termo(normalizar("Vergalhoes CA-50"), "vergalhao") is False


def test_wildcard_casa_prefixo():
    assert casa_termo(normalizar("Vergalhões CA-50"), "vergalh*") is True
    assert casa_termo(normalizar("Vergalhão CA-50"), "vergalh*") is True


def test_wildcard_nao_casa_prefixo_mais_curto():
    assert casa_termo(normalizar("Verga de madeira"), "vergalh*") is False


def test_termo_multi_token_exige_sequencia_contigua():
    assert casa_termo(normalizar("VERG CA 50 10MM"), "verg ca") is True
    assert casa_termo(normalizar("VERG 10MM CA"), "verg ca") is False


def test_termo_com_acento_cadastrado_casa_descricao_sem_acento():
    assert casa_termo(normalizar("VERGALHAO CA 50"), "vergalhão") is True


def test_casa_algum_com_lista_vazia_ou_nula_e_falso():
    assert casa_algum(normalizar("Vergalhao"), []) is False
    assert casa_algum(normalizar("Vergalhao"), None) is False


def test_casa_algum_encontra_o_segundo_termo():
    assert casa_algum(normalizar("VG CA50 10.0"), ["vergalhao", "vg ca50"]) is True
