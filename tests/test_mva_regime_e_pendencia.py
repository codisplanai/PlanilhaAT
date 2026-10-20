"""MVA do fluxo geral da Antecipação Tributária: coluna pelo regime do fornecedor
e item pendente quando a MVA não pode ser determinada pelo Anexo 1.

Regras decididas:
- CRT 1 (Simples) e 4 (MEI) usam a MVA original; CRT 2 (Simples com excesso de
  sublimite) e 3 (regime normal) usam a MVA ajustada da A.ORI do documento.
- Sem CRT (nota só do SPED), CSOSN indica a original e CST a ajustada.
- Item sem MVA determinável não é calculado com MVA zero: vai para os itens
  excluídos com tipo "mva_pendente", sem derrubar a solicitação.
- A política especial do "passo a passo" não é afetada (coberta em
  test_passo_a_passo_*).
"""

import json
from datetime import date
from decimal import Decimal

import pytest

from app.constants import TIPO_EXCLUSAO_MVA_PENDENTE
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.solicitacao import Solicitacao
from app.services.pipeline_helpers import no_output_message
from app.services.pipeline_service import ProcessingPipelineService
from app.services.rules_engine.mva_resolver import MVA_AJUSTADA, MVA_ORIGINAL, MvaResolver
from app.services.templates_admin.template_manager import TemplateManager


def _ajustada(a4, a7, a12, caso=None):
    return {"caso": caso, "aliquotas": {"4": a4, "7": a7, "12": a12}}


def _original(valor, caso=None):
    return {"caso": caso, "valor": valor}


ANEXO_TESTE = [
    {"_meta": True},
    {
        "ncm": "22011", "item": "3.3", "cest": ["03.003.00"], "descricao": "Água mineral (vidro)",
        "mva_ajustada": [_ajustada(158.42, 150.34, 136.88)], "mva_original": [_original(114.0)],
    },
    {
        "ncm": "22011", "item": "3.3.1", "cest": ["03.003.01"], "descricao": "Água mineral com sais (vidro)",
        "mva_ajustada": [_ajustada(158.42, 150.34, 136.88)], "mva_original": [_original(114.0)],
    },
    {
        "ncm": "3004", "item": "9.1.0", "cest": ["13.001.00"], "descricao": "Medicamento referência - positiva",
        "mva_ajustada": [_ajustada(77.05, 71.52, 62.29)], "mva_original": [_original(38.24)],
    },
    {
        "ncm": "3004", "item": "9.1.1", "cest": ["13.001.01"], "descricao": "Medicamento referência - negativa",
        "mva_ajustada": [_ajustada(70.31, 65.03, 56.25)], "mva_original": [_original(33.0)],
    },
    {
        "ncm": "27101919", "item": "6.4", "cest": ["06.004.00"], "descricao": "Querosenes",
        "mva_ajustada": [], "mva_original": [], "mva_ajustada_texto": "As indicadas no Ato COTEPE 61/19",
    },
    {
        "ncm": "8708", "item": "1.99", "cest": ["01.999.00"], "descricao": "Autopeça com MVA condicional",
        "mva_ajustada": [
            _ajustada(64.90, 59.75, 51.16, caso="índice de fidelidade"),
            _ajustada(107.43, 100.95, 90.15, caso="demais casos"),
        ],
        "mva_original": [_original(36.56, caso="índice de fidelidade"), _original(71.78, caso="demais casos")],
    },
]


@pytest.fixture
def anexo_teste(tmp_path):
    caminho_anterior = MvaResolver._anexo_file_path
    caminho = tmp_path / "AnexoI.json"
    caminho.write_text(json.dumps(ANEXO_TESTE), encoding="utf-8")
    MvaResolver.set_custom_path(str(caminho))
    yield caminho
    MvaResolver.set_custom_path(caminho_anterior)


# ---------------------------------------------------------------------------
# Regras puras
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "crt, evidencia_csosn, esperado",
    [
        ("1", False, MVA_ORIGINAL),
        ("4", False, MVA_ORIGINAL),
        ("2", True, MVA_AJUSTADA),   # CRT 2 conta como regime normal mesmo sendo "Simples"
        ("3", False, MVA_AJUSTADA),
        ("3", True, MVA_AJUSTADA),   # o CRT do XML prevalece sobre qualquer outra evidência
        ("", True, MVA_ORIGINAL),    # SPED sem XML: CSOSN só é usado por CRT 1 e 4
        ("", False, MVA_AJUSTADA),   # SPED sem XML: CST é usado por CRT 2 e 3
        ("9", False, None),          # CRT desconhecido não permite escolher
    ],
)
def test_coluna_da_mva_pelo_regime(crt, evidencia_csosn, esperado):
    assert MvaResolver.coluna_por_regime(crt, evidencia_csosn) == esperado


@pytest.mark.parametrize(
    "a_ori, esperado",
    [
        (Decimal("0.04"), "4"),
        (Decimal("0.07"), "7"),
        (Decimal("0.12"), "12"),
        (Decimal("12.00"), "12"),
        (Decimal("0.10"), None),  # sem aproximação para a faixa mais próxima
        (Decimal("0.18"), None),
        (Decimal("0"), None),     # sem presumir 12%
        (None, None),
    ],
)
def test_faixa_da_mva_ajustada_exige_aliquota_interestadual(a_ori, esperado):
    assert MvaResolver.chave_aliquota_interestadual(a_ori) == esperado


def test_coluna_define_entre_original_e_ajustada(anexo_teste):
    original = MvaResolver.resolver_para_item(
        ncm="22011000", cest="", a_ori=Decimal("0"), coluna=MVA_ORIGINAL
    )
    ajustada = MvaResolver.resolver_para_item(
        ncm="22011000", cest="", a_ori=Decimal("0.07"), coluna=MVA_AJUSTADA
    )
    assert original.mva == Decimal("114.0")
    assert ajustada.mva == Decimal("150.34")


def test_itens_com_a_mesma_mva_resolvem_e_registram_os_itens_do_anexo(anexo_teste):
    resultado = MvaResolver.resolver_para_item(
        ncm="22011000", cest="", a_ori=Decimal("0.12"), coluna=MVA_AJUSTADA
    )
    assert resultado.mva == Decimal("136.88")
    assert resultado.itens_anexo == ("3.3", "3.3.1")


def test_ncm_fora_do_anexo_fica_pendente_em_vez_de_mva_zero(anexo_teste):
    resultado = MvaResolver.resolver_para_item(
        ncm="99999999", cest="", a_ori=Decimal("0.12"), coluna=MVA_AJUSTADA
    )
    assert resultado.pendente
    assert resultado.mva is None
    assert "não encontrado no Anexo 1" in resultado.motivo_pendencia


def test_mva_nao_numerica_fica_pendente(anexo_teste):
    resultado = MvaResolver.resolver_para_item(
        ncm="27101919", cest="", a_ori=Decimal("0.12"), coluna=MVA_AJUSTADA
    )
    assert resultado.pendente
    assert "item 6.4 do Anexo 1" in resultado.motivo_pendencia


def test_mva_condicional_fica_pendente(anexo_teste):
    for coluna, a_ori in ((MVA_AJUSTADA, Decimal("0.12")), (MVA_ORIGINAL, Decimal("0"))):
        resultado = MvaResolver.resolver_para_item(
            ncm="87089990", cest="", a_ori=a_ori, coluna=coluna
        )
        assert resultado.pendente
        assert "mais de um caso de MVA" in resultado.motivo_pendencia


def test_mvas_diferentes_sem_cest_ficam_pendentes_e_o_cest_desempata(anexo_teste):
    sem_cest = MvaResolver.resolver_para_item(
        ncm="30049099", cest="", a_ori=Decimal("0.12"), coluna=MVA_AJUSTADA
    )
    assert sem_cest.pendente
    assert "56,25% / 62,29%" in sem_cest.motivo_pendencia

    com_cest = MvaResolver.resolver_para_item(
        ncm="30049099", cest="13.001.01", a_ori=Decimal("0.12"), coluna=MVA_AJUSTADA
    )
    assert com_cest.mva == Decimal("56.25")
    assert com_cest.itens_anexo == ("9.1.1",)


@pytest.mark.parametrize("a_ori", [None, Decimal("0"), Decimal("0.18")])
def test_ajustada_sem_aliquota_interestadual_fica_pendente(anexo_teste, a_ori):
    resultado = MvaResolver.resolver_para_item(
        ncm="22011000", cest="", a_ori=a_ori, coluna=MVA_AJUSTADA
    )
    assert resultado.pendente
    assert "só existe para 4%, 7% e 12%" in resultado.motivo_pendencia


def test_regime_desconhecido_fica_pendente(anexo_teste):
    resultado = MvaResolver.resolver_para_item(
        ncm="22011000", cest="", a_ori=Decimal("0.12"), coluna=None
    )
    assert resultado.pendente
    assert "regime do fornecedor não identificado" in resultado.motivo_pendencia


def test_mensagem_sem_planilha_diferencia_mva_pendente():
    parcial = {"tipo_exclusao": "mercadoria"}
    pendente = {"tipo_exclusao": TIPO_EXCLUSAO_MVA_PENDENTE}
    assert no_output_message([parcial]) == "Nenhum item a recolher na Parcial"
    assert no_output_message([pendente]).startswith("Nenhuma planilha gerada")
    assert "MVA pendente" in no_output_message([parcial, pendente])


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

MAPPING_PADRAO = {
    "start_row": 4,
    "columns": {"numero_nota": "A", "data_emissao": "B", "ncm": "C", "v_total": "D", "base_calculo": "E"},
}


def _icms(grupo: str, base: str) -> str:
    if grupo == "SN102":
        return "<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>"
    if grupo == "40":
        return "<ICMS><ICMS40><orig>0</orig><CST>40</CST></ICMS40></ICMS>"
    aliquota = grupo
    return f"<ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>{base}</vBC><pICMS>{aliquota}</pICMS></ICMS00></ICMS>"


def _xml(numero: str, crt: str, itens: list) -> bytes:
    """NF-e de fornecedor de SP para cliente da BA em março/2026.

    itens: lista de (ncm, cest, cfop, valor, grupo_icms), com grupo_icms "SN102",
    "40" ou a alíquota do ICMS00 ("7.00", "12.00").
    """
    chave = f"3526031122233300018155001{numero.zfill(9)}1{numero.zfill(8)}"[:44].ljust(44, "0")
    total = sum(Decimal(valor) for _, _, _, valor, _ in itens)
    dets = []
    for indice, (ncm, cest, cfop, valor, grupo) in enumerate(itens, start=1):
        cest_tag = f"<CEST>{cest}</CEST>" if cest else ""
        dets.append(
            f"""<det nItem="{indice}">
        <prod><NCM>{ncm}</NCM>{cest_tag}<CFOP>{cfop}</CFOP><vProd>{valor}</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto>{_icms(grupo, valor)}</imposto>
      </det>"""
        )
    crt_tag = f"<CRT>{crt}</CRT>" if crt else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{chave}">
      <ide><nNF>{numero}</nNF><serie>1</serie><dhEmi>2026-03-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>11222333000181</CNPJ><xNome>Fornecedor SP</xNome><enderEmit><UF>SP</UF></enderEmit>{crt_tag}</emit>
      <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>{total}</vNF><vBC>{total}</vBC></ICMSTot></total>
      {"".join(dets)}
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


def _cenario(db_session, create_sample_excel_template, periodo=(date(2026, 3, 1), date(2026, 3, 31))):
    for tipo in ("antecipacao_parcial", "antecipacao_tributaria", "difal"):
        caminho = create_sample_excel_template(tipo=tipo)
        with open(caminho, "rb") as arquivo:
            TemplateManager.upload_new_template_version(
                db=db_session,
                tipo=tipo,
                filename=f"t_{tipo}.xlsx",
                file_bytes=arquivo.read(),
                mapeamento=MAPPING_PADRAO,
                promover_ativo=True,
            )
    perfil = PerfilRegras(nome="Perfil MVA por regime")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.2050")))
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195", uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()
    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=periodo[0],
        periodo_fim=periodo[1],
        tipo_planilha=None,
        status="pendente",
    )
    db_session.add(solicitacao)
    db_session.commit()
    return solicitacao


def _mvas_da_tributaria(resultado):
    return [
        Decimal(nota.metadados_extras["mva"])
        for nota in resultado.notas_processadas
        if nota.destino_planilha == "antecipacao_tributaria"
    ]


@pytest.mark.parametrize(
    "crt, grupo_icms, mva_esperada",
    [
        ("1", "SN102", Decimal("114")),     # Simples: original, mesmo com A.ORI inferida
        ("4", "SN102", Decimal("114")),     # MEI: original
        ("2", "7.00", Decimal("150.34")),   # Simples com excesso de sublimite: ajustada 7%
        ("3", "12.00", Decimal("136.88")),  # regime normal: ajustada 12%
    ],
)
def test_pipeline_escolhe_a_coluna_pelo_crt(
    db_session, create_sample_excel_template, anexo_teste, crt, grupo_icms, mva_esperada
):
    solicitacao = _cenario(db_session, create_sample_excel_template)
    xml = _xml("701", crt, [("22011000", "", "6405", "1000.00", grupo_icms)])

    resultado = ProcessingPipelineService(db_session).process_solicitacao(solicitacao.id, [("nf701.xml", xml)])
    db_session.refresh(resultado)

    assert resultado.status == "concluido"
    assert _mvas_da_tributaria(resultado) == [mva_esperada]
    assert resultado.itens_excluidos == []


def test_item_sem_mva_vira_pendencia_sem_derrubar_a_solicitacao(
    db_session, create_sample_excel_template, anexo_teste
):
    solicitacao = _cenario(db_session, create_sample_excel_template)
    xml = _xml(
        "702",
        "3",
        [
            ("87149990", "", "6405", "300.00", "12.00"),     # NCM fora do Anexo
            ("30049099", "", "6405", "400.00", "12.00"),     # MVAs diferentes, sem CEST
            ("22011000", "", "6405", "1000.00", "12.00"),    # resolvido: 136,88%
            ("21069090", "", "6102", "500.00", "12.00"),     # Parcial, segue normal
        ],
    )

    resultado = ProcessingPipelineService(db_session).process_solicitacao(solicitacao.id, [("nf702.xml", xml)])
    db_session.refresh(resultado)

    assert resultado.status == "concluido"
    pendentes = [i for i in resultado.itens_excluidos if i["tipo_exclusao"] == TIPO_EXCLUSAO_MVA_PENDENTE]
    assert [i["item_numero"] for i in pendentes] == [1, 2]
    assert all(i["destino"] == "antecipacao_tributaria" for i in pendentes)
    assert "não encontrado no Anexo 1" in pendentes[0]["motivo"]
    assert "mais de uma MVA" in pendentes[1]["motivo"]
    assert pendentes[0]["v_total"] == 300.0

    # O item resolvido entra sozinho na Tributária, sem somar os pendentes.
    tributaria = [n for n in resultado.notas_processadas if n.destino_planilha == "antecipacao_tributaria"]
    assert len(tributaria) == 1
    assert tributaria[0].v_total == Decimal("1000.00")
    assert Decimal(tributaria[0].metadados_extras["mva"]) == Decimal("136.88")
    assert any(n.destino_planilha == "antecipacao_parcial" for n in resultado.notas_processadas)


def test_regime_normal_sem_aliquota_destacada_fica_pendente(
    db_session, create_sample_excel_template, anexo_teste
):
    solicitacao = _cenario(db_session, create_sample_excel_template)
    xml = _xml("703", "3", [("22011000", "", "6405", "1000.00", "40")])

    resultado = ProcessingPipelineService(db_session).process_solicitacao(solicitacao.id, [("nf703.xml", xml)])
    db_session.refresh(resultado)

    assert resultado.status == "concluido"
    assert resultado.total_notas_processadas == 0
    assert [i["tipo_exclusao"] for i in resultado.itens_excluidos] == [TIPO_EXCLUSAO_MVA_PENDENTE]
    assert "A.ORI ausente" in resultado.itens_excluidos[0]["motivo"]
    assert resultado.mensagem_erro.startswith("Nenhuma planilha gerada")


_SPED_MARCO = """|0000|019|0|01032026|31032026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|11222333000181||SP|3550308||R|1||C|
|0200|P1|AGUA MINERAL|||UN|01|22011000|||18,00||
|C100|0|1|F1|55|00|1|{numero}|{chave}|10032026|20032026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|{bc}|{icms}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|AGUA MINERAL|1,000|UN|1000,00|0,00|0|{cst}|6405||{bc}|{aliq}|{icms}|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|6|
"""


@pytest.mark.parametrize(
    "cst, bc, aliq, icms, mva_esperada",
    [
        ("102", "0,00", "0,00", "0,00", Decimal("114")),           # CSOSN: original
        ("000", "1000,00", "12,00", "120,00", Decimal("136.88")),  # CST com 12%: ajustada
    ],
)
def test_nota_so_do_sped_usa_o_codigo_de_tributacao(
    db_session, create_sample_excel_template, anexo_teste, cst, bc, aliq, icms, mva_esperada
):
    solicitacao = _cenario(db_session, create_sample_excel_template)
    chave = "35260311222333000181550010000007041000007041"
    sped = _SPED_MARCO.format(numero="704", chave=chave, cst=cst, bc=bc, aliq=aliq, icms=icms).encode("utf-8")

    resultado = ProcessingPipelineService(db_session).process_solicitacao(
        solicitacao.id, xml_files_bytes=None, sped_file_bytes=sped
    )
    db_session.refresh(resultado)

    assert resultado.status == "concluido"
    assert _mvas_da_tributaria(resultado) == [mva_esperada]
