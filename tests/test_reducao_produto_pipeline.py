from decimal import Decimal

import pytest

from app.core.exceptions import RuleResolutionException
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.models.empresa import Empresa
from app.services.pipeline_service import ProcessingPipelineService

CHAVE = "35260198765432000180550010000009011000000901"


def _xml_dois_itens_mesmo_ncm() -> bytes:
    """NF-e com dois itens de NCM 72142000: um vergalhão, outro não."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{CHAVE}">
      <ide><nNF>901</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>3000.00</vNF><vBC>3000.00</vBC></ICMSTot></total>
      <det nItem="1">
        <prod><NCM>72142000</NCM><CFOP>6102</CFOP><xProd>VERGALHAO CA-50 10MM</xProd>
          <vProd>1000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
      <det nItem="2">
        <prod><NCM>72142000</NCM><CFOP>6102</CFOP><xProd>BARRA CHATA 3/4</xProd>
          <vProd>2000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><vBC>2000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


def _preparar(db_session, sol, aliquota_reducao="0.1200", termos=("VERGALH*",), exclusao=()):
    empresa = db_session.query(Empresa).filter(Empresa.id == sol.empresa_id).one()
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=empresa.perfil_regras_id, ncm="72142000",
        termos_inclusao=list(termos), termos_exclusao=list(exclusao),
        aliquota=Decimal(aliquota_reducao), descricao="Vergalhoes - Decreto 12.345"))
    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()
    return empresa


def test_itens_do_mesmo_ncm_saem_com_aliquotas_diferentes(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    _preparar(db_session, sol)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])
    db_session.refresh(res)

    aliquotas = sorted(Decimal(str(n.a_dst_resolvida)) for n in res.notas_processadas)
    assert aliquotas == [Decimal("0.1200"), Decimal("0.1206")]


def test_metadados_registram_a_origem_da_aliquota(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    _preparar(db_session, sol)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])
    db_session.refresh(res)

    por_aliquota = {
        Decimal(str(n.a_dst_resolvida)): n.metadados_extras for n in res.notas_processadas
    }
    assert any(o.startswith("reducao_produto:")
               for o in por_aliquota[Decimal("0.1200")]["origem_a_dst"])
    assert any(o.startswith("termo_acordo:")
               for o in por_aliquota[Decimal("0.1206")]["origem_a_dst"])
    assert "Vergalhoes" in por_aliquota[Decimal("0.1200")]["detalhe_a_dst"]


def test_sped_consolidado_nao_aplica_reducao(
        db_session, cenario_janeiro, sped_janeiro_com_nf901):
    """O SPED da fixture traz C170 com descrição 'PRODUTO', que não casa nenhum
    termo; a alíquota tem que cair no termo de acordo, nunca na redução."""
    sol = cenario_janeiro()
    _preparar(db_session, sol)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, sped_file_bytes=sped_janeiro_com_nf901)
    db_session.refresh(res)

    assert all(Decimal(str(n.a_dst_resolvida)) == Decimal("0.1206")
               for n in res.notas_processadas)


def test_conflito_interrompe_com_mensagem_que_chega_ao_usuario(db_session, cenario_janeiro):
    """Duas regras casando o mesmo item: falha, e a mensagem precisa sobreviver
    até solicitacao.mensagem_erro em vez de virar 'Falha interna'."""
    sol = cenario_janeiro()
    empresa = _preparar(db_session, sol)
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=empresa.perfil_regras_id, ncm="72142000",
        termos_inclusao=["CA 50"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras CA 50"))
    db_session.commit()

    with pytest.raises(RuleResolutionException):
        ProcessingPipelineService(db_session).process_solicitacao(
            sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])

    db_session.refresh(sol)
    assert sol.status == "erro"
    assert "Conflito de regras" in (sol.mensagem_erro or "")
    assert "901" in (sol.mensagem_erro or "")
    assert "Falha interna" not in (sol.mensagem_erro or "")


def test_limitar_a_ori_reducoes_a_10_quando_ativo(db_session, cenario_janeiro):
    """Quando o perfil de regras possui 'limitar_a_ori_reducoes: True' e o item recebe
    redução ou termo de acordo, a A.ORI de 12% é limitada a 10%, recalculando crédito e valor devido."""
    sol = cenario_janeiro()
    empresa = _preparar(db_session, sol)
    empresa.perfil_regras.configuracoes_extras = {"limitar_a_ori_reducoes": True}
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])
    db_session.refresh(res)

    for n in res.notas_processadas:
        assert Decimal(str(n.a_ori)) == Decimal("0.10")
        assert n.metadados_extras.get("a_ori_limitada") is True
        assert Decimal(str(n.metadados_extras.get("a_ori_original"))) == Decimal("0.12")
        # Crédito recalculado: base_calculo * 0.10
        assert n.credito == (n.base_calculo * Decimal("0.10")).quantize(Decimal("0.01"))
        assert n.valor_devido == (n.debito - n.credito)


def test_manter_a_ori_quando_configuracao_inativa(db_session, cenario_janeiro):
    """Quando 'limitar_a_ori_reducoes' não está ativo (padrão), o 12% da nota é mantido."""
    sol = cenario_janeiro()
    empresa = _preparar(db_session, sol)
    empresa.perfil_regras.configuracoes_extras = {}
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])
    db_session.refresh(res)

    for n in res.notas_processadas:
        assert Decimal(str(n.a_ori)) == Decimal("0.1200")
        assert not n.metadados_extras.get("a_ori_limitada")


def test_manter_a_ori_menor_que_10_mesmo_com_configuracao_ativa(db_session, cenario_janeiro):
    """Quando o XML já vem com alíquota abaixo de 10% (ex: 7% ou 4%), ela permanece intacta."""
    sol = cenario_janeiro()
    empresa = _preparar(db_session, sol)
    empresa.perfil_regras.configuracoes_extras = {"limitar_a_ori_reducoes": True}
    db_session.commit()

    xml_7_pct = _xml_dois_itens_mesmo_ncm().decode("utf-8").replace("<pICMS>12.00</pICMS>", "<pICMS>7.00</pICMS>").encode("utf-8")

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", xml_7_pct)])
    db_session.refresh(res)

    for n in res.notas_processadas:
        assert Decimal(str(n.a_ori)) == Decimal("0.07")
        assert not n.metadados_extras.get("a_ori_limitada")
        assert n.credito == (n.base_calculo * Decimal("0.07")).quantize(Decimal("0.01"))


