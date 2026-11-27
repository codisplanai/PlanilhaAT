import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PlanautApi } from '../src/api.ts';
import { installNodeDom } from '../src/dom.ts';
import { FolderPolicy } from '../src/files.ts';
import { GeracaoManager, monthPeriod } from '../src/generation.ts';
import { type FakeCall, fakePlanaut, json, loadContext, templateBytes, tempDir, testConfig, xmlNfe } from './helpers.ts';

installNodeDom();

const TEMPLATE_FILES: Record<number, string> = {
  1: 'modelo_padrao_antecipacao_parcial.xlsx',
  4: 'modelo_padrao_difal.xlsx',
};

function setup(options: { failResult?: boolean; industria?: boolean } = {}) {
  const root = tempDir();
  const pasta = path.join(root, 'cliente', '2026-01');
  fs.mkdirSync(pasta, { recursive: true });
  const persisted: FakeCall[] = [];
  const deleted: string[] = [];
  const fake = fakePlanaut({
    'GET /processamento-local/contexto': () => {
      const context = loadContext() as { empresa: Record<string, unknown> };
      if (options.industria) context.empresa.atividade = 'industria';
      return context;
    },
    'GET /templates/:id/arquivo': (call) => {
      const id = Number(call.path.split('/')[2]);
      return new Response(templateBytes(TEMPLATE_FILES[id]), { status: 200 });
    },
    'POST /solicitacoes': () => json({ id: 'sol-1', status: 'pendente' }, 201),
    'POST /processamento-local/solicitacoes/:id/resultado': (call) => {
      persisted.push(call);
      return options.failResult ? json({ detail: 'conflito' }, 409) : json({ id: 'sol-1', status: 'concluido' });
    },
    'DELETE /solicitacoes/:id': (call) => {
      deleted.push(call.path);
      return new Response(null, { status: 204 });
    },
  });
  const api = new PlanautApi(testConfig([root]), fake.fetch);
  const manager = new GeracaoManager(api, new FolderPolicy([root]), null);
  return { root, pasta, manager, persisted, deleted, calls: fake.calls };
}

const periodo = monthPeriod('2026-01');
const base = (pasta: string) => ({
  empresaId: 1,
  periodoInicio: periodo.inicio,
  periodoFim: periodo.fim,
  xmls: [pasta],
  speds: [],
  planilhaEntrada: null,
  pastaSaida: null,
  recursivo: false,
});

test('competência AAAA-MM vira o mês completo', () => {
  assert.deepEqual(monthPeriod('2026-02'), { inicio: '2026-02-01', fim: '2026-02-28' });
  assert.deepEqual(monthPeriod('2024-02'), { inicio: '2024-02-01', fim: '2024-02-29' });
  assert.throws(() => monthPeriod('02/2026'), /AAAA-MM/);
});

test('gera a Parcial, registra só dados estruturados no histórico e grava sem sobrescrever', async () => {
  const { pasta, manager, persisted } = setup();
  fs.writeFileSync(path.join(pasta, 'nfe-1.xml'), xmlNfe({ numero: 1, valor: '1000.00', cfop: '6102', data: '2026-01-10', vIcms: '120.00' }));

  const result = await manager.start(base(pasta)) as Record<string, any>;
  assert.equal(result.status, 'concluida');
  assert.equal(result.solicitacao_id, 'sol-1');
  assert.equal(result.planilhas.length, 1);
  assert.equal(result.planilhas[0].tipo, 'antecipacao_parcial');
  assert.equal(result.planilhas[0].valor_devido, 85);
  assert.ok(fs.existsSync(result.planilhas[0].arquivo));
  assert.equal(path.dirname(result.planilhas[0].arquivo), pasta);

  const payload = persisted[0].body as Record<string, any>;
  assert.equal(payload.notas_processadas.length, 1);
  assert.equal(payload.notas_processadas[0].destino_planilha, 'antecipacao_parcial');
  assert.equal(payload.saidas[0].total_valor_devido, 85);
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('<nfeProc'), 'o conteúdo do XML não pode ir para o servidor');

  const again = await manager.start(base(pasta)) as Record<string, any>;
  assert.match(path.basename(again.planilhas[0].arquivo), / \(2\)\.xlsx$/);
});

test('bonificação: pausa, exige decisão para todas as notas e retoma com as respostas', async () => {
  const { pasta, manager, persisted } = setup();
  fs.writeFileSync(path.join(pasta, 'nfe-1.xml'), xmlNfe({ numero: 1, valor: '1000.00', cfop: '6102', data: '2026-01-10', vIcms: '120.00' }));
  fs.writeFileSync(path.join(pasta, 'nfe-2.xml'), xmlNfe({ numero: 2, valor: '500.00', cfop: '6910', data: '2026-01-11', vIcms: '60.00' }));
  fs.writeFileSync(path.join(pasta, 'nfe-3.xml'), xmlNfe({ numero: 3, valor: '300.00', cfop: '6910', data: '2026-01-12', pIcms: '0.00' }));

  const first = await manager.start(base(pasta)) as Record<string, any>;
  assert.equal(first.status, 'aguardando_decisao');
  assert.equal(first.etapa, 'bonificacao');
  assert.deepEqual(first.pendencias.map((p: any) => p.id), ['B1', 'B2']);
  assert.equal(first.pendencias[0].sugestao_do_sistema, 'revenda');
  assert.equal(first.pendencias[1].sugestao_do_sistema, 'uso_consumo');

  // Resposta parcial não libera a etapa: a nota sem decisão seguiria a regra de CFOP em silêncio.
  const partial = await manager.answer(first.geracao_id, { bonificacao: { B1: 'revenda' } }) as Record<string, any>;
  assert.equal(partial.status, 'aguardando_decisao');
  assert.equal(partial.etapa, 'bonificacao');
  assert.equal(partial.pendencias.find((p: any) => p.id === 'B1').decisao_registrada, 'revenda');
  assert.equal(persisted.length, 0);

  const done = await manager.answer(first.geracao_id, { bonificacao: { B2: 'uso_consumo' } }) as Record<string, any>;
  assert.equal(done.status, 'concluida', JSON.stringify(done));
  const tipos = done.planilhas.map((p: any) => p.tipo).sort();
  assert.deepEqual(tipos, ['antecipacao_parcial', 'difal']);
  await assert.rejects(manager.answer(first.geracao_id, {}), /já foi concluída/);
});

test('ids de pendência e escolhas são validados', async () => {
  const { pasta, manager } = setup();
  fs.writeFileSync(path.join(pasta, 'nfe-2.xml'), xmlNfe({ numero: 2, valor: '500.00', cfop: '6910', data: '2026-01-11' }));
  const first = await manager.start(base(pasta)) as Record<string, any>;
  await assert.rejects(manager.answer(first.geracao_id, { bonificacao: { X9: 'revenda' } }), /não pertence à etapa/);
  await assert.rejects(manager.answer(first.geracao_id, { usoConsumo: { B1: 'difal' } }), /não pertence à etapa/);
  await assert.rejects(manager.answer(first.geracao_id, { bonificacao: { B1: 'talvez' as never } }), /inválida/);
  // Empresa comercial: "ignorar" é a opção da indústria e iria para a Parcial no motor.
  await assert.rejects(manager.answer(first.geracao_id, { bonificacao: { B1: 'ignorar' } }), /empresa é comercial/);
  const cancelled = manager.cancel(first.geracao_id);
  assert.equal(cancelled.status, 'cancelada');
  await assert.rejects(manager.answer(first.geracao_id, {}), /não encontrada/);
});

test('resposta com um erro não aplica nada e caminho extra inválido não trava a geração', async () => {
  const { root, pasta, manager } = setup();
  fs.writeFileSync(path.join(pasta, 'nfe-2.xml'), xmlNfe({ numero: 2, valor: '500.00', cfop: '6910', data: '2026-01-11' }));
  fs.writeFileSync(path.join(pasta, 'nfe-3.xml'), xmlNfe({ numero: 3, valor: '300.00', cfop: '6910', data: '2026-01-12', pIcms: '0.00' }));
  const first = await manager.start(base(pasta)) as Record<string, any>;
  await assert.rejects(manager.answer(first.geracao_id, { bonificacao: { B1: 'revenda', B2: 'talvez' as never } }), /inválida/);
  await assert.rejects(
    manager.answer(first.geracao_id, { bonificacao: { B1: 'revenda' }, adicionarXmls: [path.join(root, 'nao-existe')] }),
    /não encontrado/,
  );
  const again = await manager.answer(first.geracao_id, {}) as Record<string, any>;
  assert.equal(again.etapa, 'bonificacao');
  assert.ok(again.pendencias.every((p: any) => !('decisao_registrada' in p)), 'nenhuma decisão parcial deveria ter sido guardada');
});

test('indústria: bonificação aceita "ignorar" ou "uso_consumo", nunca "revenda"', async () => {
  const { pasta, manager } = setup({ industria: true });
  fs.writeFileSync(path.join(pasta, 'nfe-2.xml'), xmlNfe({ numero: 2, valor: '500.00', cfop: '6910', data: '2026-01-11', vIcms: '60.00' }));
  fs.writeFileSync(path.join(pasta, 'nfe-4.xml'), xmlNfe({ numero: 4, valor: '200.00', cfop: '6910', data: '2026-01-13', vIcms: '24.00' }));
  const first = await manager.start(base(pasta)) as Record<string, any>;
  assert.equal(first.etapa, 'bonificacao');
  assert.ok(first.pendencias.every((p: any) => p.sugestao_do_sistema === 'uso_consumo'));
  assert.match(first.como_responder, /"ignorar" \| "uso_consumo"/);
  await assert.rejects(manager.answer(first.geracao_id, { bonificacao: { B1: 'revenda', B2: 'uso_consumo' } }), /empresa é industrial/);
  const done = await manager.answer(first.geracao_id, { bonificacao: { B1: 'ignorar', B2: 'uso_consumo' } }) as Record<string, any>;
  assert.equal(done.status, 'concluida', JSON.stringify(done));
  assert.deepEqual(done.planilhas.map((p: any) => p.tipo), ['difal']);
  assert.ok(done.itens_excluidos.itens.some((item: any) => item.tipo_exclusao === 'industria_sem_antecipacao' && item.nota === '2/1'));
});

test('falha ao registrar no histórico desfaz a solicitação e não grava planilha', async () => {
  const { pasta, manager, deleted } = setup({ failResult: true });
  fs.writeFileSync(path.join(pasta, 'nfe-1.xml'), xmlNfe({ numero: 1, valor: '1000.00', cfop: '6102', data: '2026-01-10', vIcms: '120.00' }));
  await assert.rejects(manager.start(base(pasta)), /conflito/);
  assert.deepEqual(deleted, ['/solicitacoes/sol-1']);
  assert.deepEqual(fs.readdirSync(pasta).filter((name) => name.endsWith('.xlsx')), []);
});

test('caminhos fora das pastas liberadas e tipos errados são recusados antes de processar', async () => {
  const { pasta, manager, calls } = setup();
  const fora = tempDir();
  fs.writeFileSync(path.join(fora, 'nfe.xml'), xmlNfe({ numero: 1, valor: '1.00', cfop: '6102', data: '2026-01-10' }));
  await assert.rejects(manager.start({ ...base(pasta), xmls: [path.join(fora, 'nfe.xml')] }), /fora das pastas liberadas/);
  fs.writeFileSync(path.join(pasta, 'notas.pdf'), 'x');
  await assert.rejects(manager.start({ ...base(pasta), xmls: [path.join(pasta, 'notas.pdf')] }), /Use apenas .xml ou .zip/);
  await assert.rejects(manager.start({ ...base(pasta), xmls: [pasta] }), /Nenhum XML\/ZIP ou SPED/);
  fs.writeFileSync(path.join(pasta, 'sped.txt'), 'não é sped');
  await assert.rejects(manager.start({ ...base(pasta), xmls: [], speds: [path.join(pasta, 'sped.txt')] }), /não parece um SPED/);
  assert.equal(calls.filter((call) => call.path === '/processamento-local/contexto').length, 0);
});
