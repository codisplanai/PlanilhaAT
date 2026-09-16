from app.services.pipeline_service import ProcessingPipelineService


def test_nota_presente_nas_duas_fontes_nao_duplica(
        db_session, cenario_janeiro, xml_nf901, sped_janeiro_com_nf901):
    """A NF 901 está no XML e no SPED. Deve ser apurada UMA vez, não duas."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    numeros = [n.numero_nota for n in res.notas_processadas]
    assert numeros.count("901") == 1


def test_nota_so_no_xml_entra_na_apuracao(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """Antes desta task os XMLs eram descartados quando havia SPED. Agora a 902 tem que aparecer."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_nota_so_no_sped_entra_na_apuracao(
        db_session, cenario_janeiro, xml_nf902, sped_janeiro_com_nf901):
    """A 901 está só no SPED (XML não baixado da SEFAZ). Ela foi emitida e entrou em
    janeiro, então não pode sumir da apuração só porque faltou o XML."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_cruzamento_por_cnpj_serie_numero_quando_falta_a_chave(
        db_session, cenario_janeiro, xml_nf901, sped_janeiro_com_nf901):
    """Se a chave de acesso faltar no XML, o cruzamento cai para CNPJ+série+número.
    Sem essa reserva a mesma NF-e seria contada duas vezes e o imposto sairia em dobro."""
    from tests.conftest import CHAVE_NF901

    sol = cenario_janeiro()
    xml_sem_chave = xml_nf901.replace(f'Id="NFe{CHAVE_NF901}"'.encode(), b'Id=""')

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_sem_chave)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    numeros = [n.numero_nota for n in res.notas_processadas]
    assert numeros.count("901") == 1


def test_apenas_xmls_continua_funcionando(
        db_session, cenario_janeiro, xml_nf901, xml_nf902):
    """Quem só envia XML não deve notar diferença nenhuma."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)])
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_enriquecimento_ipi_do_xml_quando_presente_no_sped(
        db_session, cenario_janeiro, sped_janeiro_com_nf901):
    """
    Quando uma nota consta do SPED (sem IPI destacado pelo sistema contábil)
    e o XML da SEFAZ possui IPI/despesas, o processamento deve enriquecer a nota
    com o IPI do XML, preservando a data de entrada do SPED.
    """
    from tests.conftest import CHAVE_NF901, build_xml_nfe
    from decimal import Decimal

    sol = cenario_janeiro()
    # XML da 901 com R$ 100 de IPI e Base de Cálculo de R$ 1.000 (Total R$ 1.100)
    xml_901_com_ipi = build_xml_nfe(
        numero="901",
        chave=CHAVE_NF901,
        valor="1100.00",
        dia="10",
        cfop="6102",
        v_ipi="100.00",
        v_bc="1000.00"
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_901_com_ipi)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    nota_901 = next(n for n in res.notas_processadas if n.numero_nota == "901")
    assert nota_901.origem_data_entrada == "sped_fiscal"
    assert nota_901.numero_nota == "901"
    assert nota_901.ipi_despesas == Decimal("100.00")


def test_ncm_do_xml_prevalece_sobre_ncm_do_sped(
        db_session, cenario_janeiro, sped_janeiro_com_nf901):
    """
    O NCM da mercadoria deve ser consultado sempre no XML da SEFAZ quando houver XML,
    pois é o documento fiscal oficial emitido pelo fornecedor e mais confiável que
    o cadastro interno do SPED (Registro 0200).
    """
    from tests.conftest import CHAVE_NF901, build_xml_nfe

    sol = cenario_janeiro()
    # SPED original possui NCM 21069090 no 0200.
    # Alteramos o SPED para ter NCM 84713012 no 0200.
    sped_com_outro_ncm = sped_janeiro_com_nf901.replace(b"21069090", b"84713012")

    # XML da SEFAZ possui o NCM real 21069090
    xml_901 = build_xml_nfe(
        numero="901",
        chave=CHAVE_NF901,
        valor="2000.00",
        dia="10",
        ncm="21069090"
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_901)],
        sped_file_bytes=sped_com_outro_ncm,
    )
    db_session.refresh(res)

    nota_901 = next(n for n in res.notas_processadas if n.numero_nota == "901")
    # NCM apurado deve ser o do XML (21069090), e não o divergente do SPED (84713012)
    assert nota_901.ncm == "21069090"
    # A data de entrada física permanece a do SPED
    assert nota_901.origem_data_entrada == "sped_fiscal"


def test_sped_sem_c170_adota_itens_e_ncm_do_xml(
        db_session, cenario_janeiro):
    """
    Quando o SPED Fiscal não contém o Registro C170 (apenas C190 ou consolidação C100),
    mas há XML para a nota, a lista detalhada de itens com seus NCMs e descrições confiáveis
    do XML deve ser adotada, preservando a data de entrada do SPED.
    """
    from tests.conftest import CHAVE_NF901, build_xml_nfe
    from datetime import date

    sol = cenario_janeiro()

    # SPED sem C170 (apenas C100 com entrada em 20/01/2026 e C190 analítico)
    sped_sem_c170 = (
        "|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|\n"
        "|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|\n"
        f"|C100|0|1|F1|55|00|1|901|{CHAVE_NF901}|10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|\n"
        "|C190|000|6102|12,00|2000,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|\n"
        "|9999|5|\n"
    ).encode("utf-8")

    xml_901 = build_xml_nfe(
        numero="901",
        chave=CHAVE_NF901,
        valor="2000.00",
        dia="10",
        ncm="21069090"
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_901)],
        sped_file_bytes=sped_sem_c170,
    )
    db_session.refresh(res)

    nota_901 = next(n for n in res.notas_processadas if n.numero_nota == "901")
    # Adotou o NCM real do XML da SEFAZ
    assert nota_901.ncm == "21069090"
    # Preservou a data de entrada do SPED
    assert nota_901.origem_data_entrada == "sped_fiscal"
    assert nota_901.data_entrada == date(2026, 1, 20)


def test_sped_com_itens_agrupados_adota_detalhamento_do_xml():
    """
    Quando o SPED possui C170 agrupado em menos linhas que o XML, as regras fiscais
    precisam ser avaliadas item a item pelo XML. A data de entrada continua no SPED.
    """
    from datetime import date, datetime
    from decimal import Decimal
    from app.services.extraction.base import ExtractedItemNF, ExtractedNFData
    from app.services.pipeline_helpers import enrich_sped_with_xml

    nf_sped = ExtractedNFData(
        chave_acesso="28260808369748000178550050006864111452556219",
        numero_nota="686411",
        serie="5",
        cnpj_emitente="08369748000178",
        uf_emitente="SE",
        cnpj_destinatario="05159012000187",
        uf_destinatario="BA",
        data_emissao=datetime(2026, 8, 12),
        data_entrada=date(2026, 8, 14),
        v_total_nota=Decimal("38679.60"),
        v_bc_nota=Decimal("38679.60"),
        itens=[
            ExtractedItemNF(item_numero=1, ncm="11042300", cfop="2102", descricao="GRUPO 1",
                            v_item=Decimal("3447.60"), v_total=Decimal("3447.60"),
                            base_calculo=Decimal("3447.60"), ipi_despesas=Decimal("0.00"),
                            a_ori=Decimal("0.00")),
            ExtractedItemNF(item_numero=2, ncm="21039021", cfop="2102", descricao="GRUPO 2",
                            v_item=Decimal("24704.00"), v_total=Decimal("24704.00"),
                            base_calculo=Decimal("24704.00"), ipi_despesas=Decimal("0.00"),
                            a_ori=Decimal("0.12")),
            ExtractedItemNF(item_numero=3, ncm="10059010", cfop="2102", descricao="GRUPO 3",
                            v_item=Decimal("10528.00"), v_total=Decimal("10528.00"),
                            base_calculo=Decimal("10528.00"), ipi_despesas=Decimal("0.00"),
                            a_ori=Decimal("0.07")),
        ],
        origem_extracao="sped",
    )

    nf_xml = nf_sped.copy(deep=True)
    nf_xml.data_entrada = None
    nf_xml.origem_extracao = "xml"
    nf_xml.itens = [
        ExtractedItemNF(item_numero=1, ncm="11042300", cfop="6101", descricao="CANJICA",
                        v_item=Decimal("2986.40"), v_total=Decimal("2986.40"),
                        base_calculo=Decimal("2986.40"), ipi_despesas=Decimal("0.00"),
                        a_ori=Decimal("0.12")),
        ExtractedItemNF(item_numero=2, ncm="21039021", cfop="6101", descricao="COLORIFICO",
                        v_item=Decimal("7245.00"), v_total=Decimal("7245.00"),
                        base_calculo=Decimal("7245.00"), ipi_despesas=Decimal("0.00"),
                        a_ori=Decimal("0.12")),
        ExtractedItemNF(item_numero=3, ncm="19011020", cfop="6101", descricao="FARINHA LACTEA",
                        v_item=Decimal("1997.60"), v_total=Decimal("1997.60"),
                        base_calculo=Decimal("1997.60"), ipi_despesas=Decimal("0.00"),
                        a_ori=Decimal("0.12")),
        ExtractedItemNF(item_numero=4, ncm="11022000", cfop="6101", descricao="FARINHA MILHO",
                        v_item=Decimal("1266.00"), v_total=Decimal("1266.00"),
                        base_calculo=Decimal("1266.00"), ipi_despesas=Decimal("0.00"),
                        a_ori=Decimal("0.12")),
    ]

    enrich_sped_with_xml(nf_sped, nf_xml)

    assert nf_sped.data_entrada == date(2026, 8, 14)
    assert [item.v_total for item in nf_sped.itens] == [
        Decimal("2986.40"),
        Decimal("7245.00"),
        Decimal("1997.60"),
        Decimal("1266.00"),
    ]
    assert all(item.descricao_confiavel for item in nf_sped.itens)

