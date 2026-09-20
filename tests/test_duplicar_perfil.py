from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError

from app.models.perfil_regras import PerfilRegras
from app.models.empresa import Empresa
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_reducao_produto import RegraReducaoProduto, ExcecaoReducaoProduto
from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop, ExcecaoReclassificacaoCfop
from app.models.regra_exclusao_parcial import RegraExclusaoParcial

URL = '/api/v1/perfis-regras'
RELACOES = ('regras_aliquotas', 'regras_cfop', 'regras_reducao_produto',
            'regras_reclassificacao_cfop', 'regras_exclusao_parcial')


def test_duplicar_copia_todas_as_regras_e_excecoes_sem_mover_empresas(client, db_session):
    origem = PerfilRegras(nome='Original', descricao='Descrição', configuracoes_extras={'politica': {'BA': True}})
    origem.regras_aliquotas = [RegraAliquotaDestino(uf='BA', aliquota=Decimal('0.2050'), parametros_extras={'opcoes': [1]})]
    origem.regras_cfop = [RegraCfopDestino(cfop_sufixo='102', destino='difal')]
    origem.regras_reducao_produto = [RegraReducaoProduto(
        ncm='12345678', aliquota=Decimal('0.07'), termos_inclusao=['aco'], termos_exclusao=['cobre'],
        vigencia_inicio=date(2026, 1, 1), excecoes=[ExcecaoReducaoProduto(descricao_exata='PRODUTO', enquadrado=False)])]
    origem.regras_reclassificacao_cfop = [RegraReclassificacaoCfop(
        ncm='12345678', cfop_origem_sufixo='102', cfop_destino_sufixo='556', termos_inclusao=['uso'],
        excecoes=[ExcecaoReclassificacaoCfop(descricao_exata='OUTRO', aplicar=True)])]
    origem.regras_exclusao_parcial = [RegraExclusaoParcial(
        uf='BA', ncm='12345678', termos_obrigatorios=['isento'], motivo='isencao', ativo=False, chave_origem='manual')]
    db_session.add(origem)
    db_session.flush()
    empresa = Empresa(cnpj='12345678000195', razao_social='Empresa', uf='BA', perfil_regras_id=origem.id)
    db_session.add(empresa)
    db_session.commit()
    globais = db_session.query(RegraCfopDestino).filter_by(perfil_regras_id=None).count()

    response = client.post(f'{URL}/{origem.id}/duplicar', json={'nome': ' Cópia '})
    assert response.status_code == 201, response.text
    copia = db_session.get(PerfilRegras, response.json()['id'])
    assert copia.id != origem.id
    assert copia.nome == 'Cópia'
    assert copia.descricao == origem.descricao
    assert copia.configuracoes_extras == origem.configuracoes_extras
    assert copia.empresas == []
    assert empresa.perfil_regras_id == origem.id
    assert db_session.query(RegraCfopDestino).filter_by(perfil_regras_id=None).count() == globais
    for relacao in RELACOES:
        anteriores, novas = getattr(origem, relacao), getattr(copia, relacao)
        assert len(anteriores) == len(novas) == 1
        for anterior, nova in zip(anteriores, novas):
            assert nova.id != anterior.id
            assert nova.perfil_regras_id == copia.id
            for coluna in anterior.__table__.columns:
                if coluna.key not in {'id', 'perfil_regras_id', 'criado_em', 'atualizado_em'}:
                    assert getattr(nova, coluna.key) == getattr(anterior, coluna.key)
            if hasattr(anterior, 'excecoes'):
                assert len(nova.excecoes) == 1
                assert nova.excecoes[0].id != anterior.excecoes[0].id
                assert nova.excecoes[0].descricao_exata == anterior.excecoes[0].descricao_exata
    copia.regras_aliquotas[0].aliquota = Decimal('0.10')
    copia.regras_reducao_produto[0].excecoes[0].enquadrado = True
    db_session.commit()
    db_session.expire_all()
    assert origem.regras_aliquotas[0].aliquota == Decimal('0.2050')
    assert origem.regras_reducao_produto[0].excecoes[0].enquadrado is False
    db_session.delete(copia)
    db_session.commit()
    assert all(len(getattr(origem, relacao)) == 1 for relacao in RELACOES)


def test_duplicar_vazio_e_nome_repetido(client):
    origem = client.post(URL, json={'nome': 'Vazio'}).json()
    assert client.post(f"{URL}/{origem['id']}/duplicar", json={'nome': 'Novo'}).status_code == 201
    assert client.post(f"{URL}/{origem['id']}/duplicar", json={'nome': 'Novo'}).status_code == 409
    assert client.post(f'{URL}/999999/duplicar', json={'nome': 'Ausente'}).status_code == 404


@pytest.mark.parametrize('nome', ['', '   ', 'x' * 101])
def test_duplicar_valida_nome(client, nome):
    assert client.post(f'{URL}/1/duplicar', json={'nome': nome}).status_code == 422


def test_duplicar_exige_autenticacao(client):
    client.headers.pop('Authorization')
    assert client.post(f'{URL}/1/duplicar', json={'nome': 'Cópia'}).status_code == 401


def test_duplicar_falha_na_regra_reverte_perfil(client, db_session):
    origem = PerfilRegras(nome='Original', regras_cfop=[RegraCfopDestino(cfop_sufixo='102', destino='difal')])
    db_session.add(origem)
    db_session.commit()

    def falhar(mapper, connection, target):
        raise IntegrityError('insert', {}, Exception('falha simulada'))

    event.listen(RegraCfopDestino, 'before_insert', falhar)
    try:
        response = client.post(f'{URL}/{origem.id}/duplicar', json={'nome': 'Cópia incompleta'})
    finally:
        event.remove(RegraCfopDestino, 'before_insert', falhar)
    assert response.status_code == 409
    assert db_session.query(PerfilRegras).filter_by(nome='Cópia incompleta').count() == 0
    assert len(origem.regras_cfop) == 1
