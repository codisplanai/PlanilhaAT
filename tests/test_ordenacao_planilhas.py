"""Regressão: data de entrada e número crescente em todas as planilhas."""

from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.services.pipeline_helpers import nfe_sort_key


TIPOS_PLANILHA = (
    "antecipacao_parcial",
    "antecipacao_parcial_simples",
    "antecipacao_parcial_antecipado",
    "antecipacao_parcial_antecipado_simples",
    "antecipacao_tributaria",
    "antecipacao_tributaria_antecipado",
    "difal",
)


def nota(numero, entrada, emissao, subitem=1):
    return {
        "numero_nota": numero,
        "data_entrada": entrada,
        "data_emissao": emissao,
        "item_numero": subitem,
    }


@pytest.mark.parametrize("tipo", TIPOS_PLANILHA)
def test_ordena_por_data_entrada_e_numero_independente_da_emissao(tipo):
    rows = [
        nota("120", date(2026, 9, 12), datetime(2026, 9, 1, 8)),
        nota("15", date(2026, 9, 12), datetime(2026, 9, 11, 8)),
        nota("8", date(2026, 9, 13), datetime(2026, 9, 1, 8)),
        nota("5", date(2026, 9, 12), datetime(2026, 9, 10, 8)),
        nota("999", date(2026, 9, 11), datetime(2026, 9, 11, 8)),
    ]
    rows.sort(key=nfe_sort_key)
    assert [r["numero_nota"] for r in rows] == ["999", "5", "15", "120", "8"], tipo


def test_sem_entrada_usa_dia_da_emissao_sem_preencher_a_entrada():
    rows = [
        nota("11", None, datetime(2026, 9, 12, 1)),
        nota("2", None, datetime(2026, 9, 12, 22)),
        nota("1", None, datetime(2026, 9, 11, 23, 59)),
    ]
    rows.sort(key=nfe_sort_key)
    assert [r["numero_nota"] for r in rows] == ["1", "2", "11"]
    assert all(r["data_entrada"] is None for r in rows)


def test_nota_persistida_e_desdobramento_tem_ordem_numerica():
    rows = [
        SimpleNamespace(numero_nota="10", data_entrada=date(2026, 9, 12),
                        data_emissao=datetime(2026, 9, 11, 10), item_numero=2),
        SimpleNamespace(numero_nota="11", data_entrada=date(2026, 9, 12),
                        data_emissao=datetime(2026, 9, 10, 10), item_numero=1),
        SimpleNamespace(numero_nota="10", data_entrada=date(2026, 9, 12),
                        data_emissao=datetime(2026, 9, 11, 10), item_numero=1),
        SimpleNamespace(numero_nota="9", data_entrada=date(2026, 9, 12),
                        data_emissao=datetime(2026, 9, 12, 10), item_numero=1),
    ]
    rows.sort(key=nfe_sort_key)
    assert [(r.numero_nota, r.item_numero) for r in rows] == [
        ("9", 1), ("10", 1), ("10", 2), ("11", 1),
    ]
