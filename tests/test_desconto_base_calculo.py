from decimal import Decimal
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData

def test_dataclasses_suportam_v_desc():
    item = ExtractedItemNF(
        item_numero=1,
        ncm="12345678",
        cest="",
        cfop="6102",
        descricao="Teste",
        v_item=Decimal("8268.00"),
        v_total=Decimal("7275.84"),
        base_calculo=Decimal("7275.84"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.12"),
        p_cred_sn=Decimal("0.00"),
        v_icms=Decimal("873.10"),
        v_desc=Decimal("992.16"),
    )
    assert item.v_desc == Decimal("992.16")

    nota = ExtractedNFData(
        chave_acesso="35260000000000000000550010000012341000012345",
        numero_nota="1234",
        serie="1",
        cnpj_emitente="11111111000191",
        uf_emitente="SP",
        cnpj_destinatario="22222222000192",
        uf_destinatario="BA",
        data_emissao=None,
        data_entrada=None,
        v_total_nota=Decimal("7275.84"),
        v_bc_nota=Decimal("7275.84"),
        v_icms_nota=Decimal("873.10"),
        v_desc_nota=Decimal("992.16"),
        itens=[item],
    )
    assert nota.v_desc_nota == Decimal("992.16")
