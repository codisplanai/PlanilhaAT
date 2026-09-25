import datetime
from decimal import Decimal

from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.perfil_regras import PerfilRegras
from app.models.solicitacao import Solicitacao
from app.models.solicitacao_saida import SolicitacaoSaida


def test_excluir_solicitacao_remove_apenas_historico_estruturado(client, db_session):
    perfil = PerfilRegras(nome="Perfil exclusão")
    db_session.add(perfil)
    db_session.flush()
    empresa = Empresa(
        cnpj="12345678000195",
        razao_social="Empresa Teste Exclusão",
        uf="BA",
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.commit()

    sol = Solicitacao(
        empresa_id=empresa.id,
        usuario_id="184e793c-50b7-4b57-ace1-c02b19649408",
        periodo_inicio=datetime.date(2026, 7, 1),
        periodo_fim=datetime.date(2026, 7, 31),
        tipo_planilha="multi",
        status="concluido",
        arquivo_saida_path=None,
        total_notas_processadas=1,
    )
    db_session.add(sol)
    db_session.flush()
    db_session.add(SolicitacaoSaida(
        solicitacao_id=sol.id,
        tipo="antecipacao_parcial",
        arquivo_path=None,
        total_notas=1,
        total_valor_devido=Decimal("100.00"),
    ))
    db_session.add(NotaFiscalProcessada(
        solicitacao_id=sol.id,
        numero_nota="999",
        cnpj_destinatario=empresa.cnpj,
        data_emissao=datetime.datetime(2026, 7, 10, 12, 0),
        ncm="72142000",
        cfop="2102",
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        a_ori=Decimal("0.12"),
        a_dst_resolvida=Decimal("0.205"),
        debito=Decimal("205.00"),
        credito=Decimal("120.00"),
        valor_devido=Decimal("85.00"),
        destino_planilha="antecipacao_parcial",
    ))
    db_session.commit()

    response = client.delete(f"/api/v1/solicitacoes/{sol.id}")
    assert response.status_code == 204
    assert db_session.get(Solicitacao, sol.id) is None
    assert db_session.query(SolicitacaoSaida).filter_by(solicitacao_id=sol.id).count() == 0
    assert db_session.query(NotaFiscalProcessada).filter_by(solicitacao_id=sol.id).count() == 0


def test_excluir_solicitacao_inexistente(client):
    response = client.delete("/api/v1/solicitacoes/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_excluir_solicitacoes_em_lote_com_sucesso(client, db_session):
    perfil = PerfilRegras(nome="Perfil exclusão lote")
    db_session.add(perfil)
    db_session.flush()
    empresa = Empresa(
        cnpj="99887766000100",
        razao_social="Empresa Teste Lote",
        uf="BA",
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.commit()

    sol1 = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=datetime.date(2026, 8, 1),
        periodo_fim=datetime.date(2026, 8, 31),
        tipo_planilha="multi",
        status="concluido",
        total_notas_processadas=2,
    )
    sol2 = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=datetime.date(2026, 9, 1),
        periodo_fim=datetime.date(2026, 9, 30),
        tipo_planilha="multi",
        status="concluido",
        total_notas_processadas=3,
    )
    db_session.add_all([sol1, sol2])
    db_session.commit()

    res = client.post("/api/v1/solicitacoes/batch-delete", json={"ids": [str(sol1.id), str(sol2.id)]})
    assert res.status_code == 200
    data = res.json()
    assert data["deleted_count"] == 2
    assert str(sol1.id) in data["ids"]
    assert str(sol2.id) in data["ids"]

    assert db_session.get(Solicitacao, sol1.id) is None
    assert db_session.get(Solicitacao, sol2.id) is None


def test_excluir_solicitacoes_em_lote_inexistentes(client):
    res = client.post("/api/v1/solicitacoes/batch-delete", json={"ids": ["00000000-0000-0000-0000-000000000001"]})
    assert res.status_code == 200
    assert res.json()["deleted_count"] == 0


def test_excluir_solicitacoes_em_lote_operador_bloqueia_alheia(client, db_session):
    perfil = PerfilRegras(nome="Perfil operador teste")
    db_session.add(perfil)
    db_session.flush()
    empresa = Empresa(
        cnpj="55443322000199",
        razao_social="Empresa Operador Teste",
        uf="BA",
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.commit()

    sol_alheia = Solicitacao(
        empresa_id=empresa.id,
        usuario_id="00000000-0000-0000-0000-000000000099",
        periodo_inicio=datetime.date(2026, 5, 1),
        periodo_fim=datetime.date(2026, 5, 31),
        tipo_planilha="multi",
        status="concluido",
    )
    db_session.add(sol_alheia)
    db_session.commit()

    # Log in as operator
    login_res = client.post("/api/v1/auth/login", json={
        "email": "operador@contabilidade.com",
        "password": "operador",
    })
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.post(
        "/api/v1/solicitacoes/batch-delete",
        json={"ids": [str(sol_alheia.id)]},
        headers=headers,
    )
    assert res.status_code == 403
    assert "Você não tem permissão" in res.json()["detail"]
    assert db_session.get(Solicitacao, sol_alheia.id) is not None

