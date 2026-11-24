import assert from 'node:assert/strict';
import test from 'node:test';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { buildContext, chave, processar, xmlNfe } from './localFixtures.ts';

installDomParserPolyfill();
const key = chave('2601', 123);
const xml = xmlNfe('123', key, '1000.00', '2026-01-15', '6102');
const input = { xmls: [['123.xml', xml]] as Array<[string, string]> };

test('Fornecedor automático: nota vai só para DIFAL; outra empresa mantém regra normal', async () => {
  const ctx = buildContext();
  ctx.empresa.fornecedores_uso_consumo = [{ cnpj: '98765432000180', nome: '', modo: 'automatico' }];
  const result = await processar(ctx, input);
  assert.equal(result.preAnalysis.requer_decisao, false);
  assert.deepEqual(result.notasProcessadas.map(n => n.destino_planilha), ['difal']);
  assert.equal(result.notasProcessadas[0].metadados_extras.fornecedor_uso_consumo, 'automatico');
  const other = await processar(buildContext(), input);
  assert.deepEqual(other.notasProcessadas.map(n => n.destino_planilha), ['antecipacao_parcial']);
});

test('Fornecedor manual exige decisão por nota e permite recusar', async () => {
  const ctx = buildContext();
  ctx.empresa.fornecedores_uso_consumo = [{ cnpj: '98765432000180', nome: 'Fornecedor', modo: 'confirmacao' }];
  const waiting = await processar(ctx, input);
  assert.equal(waiting.preAnalysis.requer_decisao, true);
  assert.equal(waiting.preAnalysis.notas_uso_consumo?.[0].key, key);
  assert.equal(waiting.notasProcessadas.length, 0);
  const confirmed = await processar(ctx, input, undefined, { [key]: true });
  assert.deepEqual(confirmed.notasProcessadas.map(n => n.destino_planilha), ['difal']);
  const rejected = await processar(ctx, input, undefined, { [key]: false });
  assert.deepEqual(rejected.notasProcessadas.map(n => n.destino_planilha), ['antecipacao_parcial']);
});

test('Fornecedor cadastrado não redireciona operação interna', async () => {
  const ctx = buildContext();
  ctx.empresa.fornecedores_uso_consumo = [{ cnpj: '98765432000180', nome: '', modo: 'automatico' }];
  await assert.rejects(
    processar(ctx, { xmls: [['123.xml', xml.replace('<UF>SP</UF>', '<UF>BA</UF>')]] }),
    /Nenhuma NF-e válida para apuração interestadual/,
  );
});
