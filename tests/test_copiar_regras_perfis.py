from decimal import Decimal

import pytest

from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_cfop import RegraCfopDestino
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.models.regra_reclassificacao_cfop import ExcecaoReclassificacaoCfop, RegraReclassificacaoCfop
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

URL = '/api/v1/perfis-regras'


def _perfis(db_session, *nomes):
    perfis = [PerfilRegras(nome=n) for n in nomes]
    db_session.add_all(perfis)
    db_session.commit()
    return perfis


def _copiar(client, origem, **payload):
    return client.post(f'{URL}/{origem.id}/copiar-regras', json=payload)


def test_copia_secao_reducao_com_excecoes_e_escopo_para_todos_os_demais(client, db_session):
    origem, b, c = _perfis(db_session, 'Origem', 'B', 'C')
    origem.regras_reducao_produto = [
        RegraReducaoProduto(
            ncm='72142000', aliquota=Decimal('0.41463'), termos_inclusao=['verg'],
            termos_exclusao=['cobre'], escopo='antecipacao_tributaria',
            excecoes=[ExcecaoReducaoProduto(descricao_exata='VG X', enquadrado=True)]),
        RegraReducaoProduto(ncm='72142000', aliquota=Decimal('0.07'), termos_inclusao=['verg'],
                            escopo='antecipacao_parcial'),
    ]
    db_session.commit()

    r = _copiar(client, origem, secao='reducao', todos_os_demais=True)
    assert r.status_code == 200, r.text
    resumo = {x['perfil_id']: x for x in r.json()['resultados']}
    assert set(resumo) == {b.id, c.id}
    assert all(x['copiadas'] == 2 and x['ignoradas'] == 0 for x in resumo.values())

    db_session.expire_all()
    for destino in (b, c):
        regras = {x.escopo: x for x in destino.regras_reducao_produto}
        assert set(regras) == {'antecipacao_tributaria', 'antecipacao_parcial'}
        trib = regras['antecipacao_tributaria']
        assert trib.id != origem.regras_reducao_produto[0].id
        assert trib.termos_exclusao == ['cobre']
        assert [e.descricao_exata for e in trib.excecoes] == ['VG X']
    assert len(origem.regras_reducao_produto) == 2


def test_copia_regra_individual_para_perfil_especifico(client, db_session):
    origem, b, c = _perfis(db_session, 'Origem', 'B', 'C')
    origem.regras_aliquotas = [
        RegraAliquotaDestino(uf='BA', aliquota=Decimal('0.2050')),
        RegraAliquotaDestino(uf='SP', ncm='12345678', aliquota=Decimal('0.12')),
    ]
    db_session.commit()
    alvo = next(x for x in origem.regras_aliquotas if x.uf == 'SP')

    r = _copiar(client, origem, secao='aliquotas', regra_ids=[alvo.id], perfil_destino_ids=[b.id])
    assert r.status_code == 200, r.text
    db_session.expire_all()
    assert [(x.uf, x.ncm) for x in b.regras_aliquotas] == [('SP', '12345678')]
    assert c.regras_aliquotas == []


def test_regras_duplicadas_no_destino_sao_ignoradas(client, db_session):
    origem, b = _perfis(db_session, 'Origem', 'B')
    origem.regras_cfop = [RegraCfopDestino(cfop_sufixo='102', destino='difal'),
                          RegraCfopDestino(cfop_sufixo='556', destino='ignorar')]
    b.regras_cfop = [RegraCfopDestino(cfop_sufixo='102', destino='ignorar')]
    db_session.commit()

    r = _copiar(client, origem, secao='cfop', todos_os_demais=True)
    assert r.status_code == 200, r.text
    assert r.json()['resultados'][0]['copiadas'] == 1
    assert r.json()['resultados'][0]['ignoradas'] == 1
    db_session.expire_all()
    destinos = {x.cfop_sufixo: x.destino for x in b.regras_cfop}
    assert destinos == {'102': 'ignorar', '556': 'ignorar'}

    # repetir nao duplica
    r2 = _copiar(client, origem, secao='cfop', todos_os_demais=True)
    assert r2.json()['resultados'][0]['copiadas'] == 0


def test_copia_reclassificacao_e_exclusao_parcial(client, db_session):
    origem, b = _perfis(db_session, 'Origem', 'B')
    origem.regras_reclassificacao_cfop = [RegraReclassificacaoCfop(
        ncm='12345678', cfop_origem_sufixo='102', cfop_destino_sufixo='556', termos_inclusao=['uso'],
        excecoes=[ExcecaoReclassificacaoCfop(descricao_exata='OUTRO', aplicar=True)])]
    origem.regras_exclusao_parcial = [RegraExclusaoParcial(
        uf='BA', ncm='12345678', termos_obrigatorios=['a', 'b'], motivo='isencao', ativo=False)]
    db_session.commit()

    assert _copiar(client, origem, secao='reclassificacao', todos_os_demais=True).status_code == 200
    assert _copiar(client, origem, secao='exclusao', todos_os_demais=True).status_code == 200
    db_session.expire_all()
    assert [e.descricao_exata for e in b.regras_reclassificacao_cfop[0].excecoes] == ['OUTRO']
    assert b.regras_exclusao_parcial[0].ativo is False


def test_validacoes(client, db_session):
    origem, b = _perfis(db_session, 'Origem', 'B')
    outra = RegraAliquotaDestino(uf='BA', aliquota=Decimal('0.18'))
    b.regras_aliquotas = [outra]
    db_session.commit()

    assert _copiar(client, origem, secao='invalida', todos_os_demais=True).status_code == 422
    assert _copiar(client, origem, secao='cfop').status_code == 422  # sem destino
    assert _copiar(client, origem, secao='cfop', perfil_destino_ids=[origem.id]).status_code == 422
    assert _copiar(client, origem, secao='cfop', perfil_destino_ids=[999999]).status_code == 404
    assert _copiar(client, origem, secao='cfop', todos_os_demais=True, regra_ids=[]).status_code == 422
    # regra de outro perfil nao pode ser copiada a partir da origem
    assert _copiar(client, origem, secao='aliquotas', regra_ids=[outra.id],
                   perfil_destino_ids=[b.id]).status_code == 404
    assert client.post(f'{URL}/999999/copiar-regras',
                       json={'secao': 'cfop', 'todos_os_demais': True}).status_code == 404


def test_copiar_regras_exige_admin(client, db_session):
    from app.core.security import get_current_user, require_admin
    from app.main import app

    origem, b = _perfis(db_session, 'Origem', 'B')

    def nao_admin():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail='Apenas administradores.')

    app.dependency_overrides[require_admin] = nao_admin
    try:
        r = _copiar(client, origem, secao='cfop', todos_os_demais=True)
    finally:
        app.dependency_overrides.pop(require_admin, None)
    assert r.status_code == 403


def test_copiar_regras_exige_autenticacao(client):
    client.headers.pop('Authorization')
    assert client.post(f'{URL}/1/copiar-regras',
                       json={'secao': 'cfop', 'todos_os_demais': True}).status_code == 401

