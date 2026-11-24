from datetime import datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.empresa import EmpresaUpdate
from app.services.rules_engine.supplier_usage import supplier_usage_mode, supplier_usage_pending


def test_schema_valida_cnpj_modo_e_duplicidade():
    entry = {"cnpj": "11.222.333/0001-81"}
    result = EmpresaUpdate(fornecedores_uso_consumo=[entry])
    assert result.fornecedores_uso_consumo[0].cnpj == "11222333000181"
    assert result.fornecedores_uso_consumo[0].modo == "confirmacao"
    with pytest.raises(ValidationError):
        EmpresaUpdate(fornecedores_uso_consumo=[entry, entry])
    with pytest.raises(ValidationError):
        EmpresaUpdate(fornecedores_uso_consumo=[{"cnpj": "00000000000000"}])
    with pytest.raises(ValidationError):
        EmpresaUpdate(fornecedores_uso_consumo=[{**entry, "modo": "invalido"}])


def test_modos_escopo_e_operacao_interestadual():
    note = SimpleNamespace(chave_acesso="1" * 44, numero_nota="1", serie="1", cnpj_emitente="11222333000181",
                           cnpj_destinatario="12345678000195", uf_emitente="SP", raw_metadata={},
                           itens=[object()], data_emissao=datetime(2026, 1, 1), v_total_nota=100)
    company = SimpleNamespace(cnpj="12345678000195", uf="BA", fornecedores_uso_consumo=[
        {"cnpj": "11222333000181", "modo": "confirmacao"}])
    assert supplier_usage_mode(note, company) is None
    assert len(supplier_usage_pending([("nfe.xml", note)], company)) == 1
    assert supplier_usage_mode(note, company, {note.chave_acesso: True}) == "confirmado"
    assert supplier_usage_mode(note, company, {note.chave_acesso: False}) is None
    assert not supplier_usage_pending([("nfe.xml", note)], company, {note.chave_acesso: False})
    company.fornecedores_uso_consumo[0]["modo"] = "automatico"
    assert supplier_usage_mode(note, company) == "automatico"
    note.uf_emitente = "BA"
    assert supplier_usage_mode(note, company) is None
    note.uf_emitente = "SP"
    note.cnpj_destinatario = "00000000000000"
    assert supplier_usage_mode(note, company) is None
    note.cnpj_destinatario = company.cnpj
    company.fornecedores_uso_consumo = []
    assert supplier_usage_mode(note, company) is None
