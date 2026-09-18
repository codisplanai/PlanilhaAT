import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDiagnosticRecorder,
  createDiagnosticSession,
  diagnosticAsText,
} from '../src/lib/processingDiagnostics.ts';

test('mantém tentativas consecutivas sem persistência e mascara metadados sensíveis', () => {
  const session = createDiagnosticSession('1.0.0-test');
  const file = new File(['<xml/>'], 'cliente-confidencial.xml', { lastModified: 1 });
  const first = createDiagnosticRecorder(session, [file], () => undefined);
  first.event('warning', 'validacao', 'CNPJ 12345678000195 e chave 35260112345678000195550010000012341000012345.');
  first.finish('concluido_com_avisos', 'Primeira tentativa concluída.');

  const second = createDiagnosticRecorder(session, [], () => undefined);
  second.finish('falhou', 'Segunda tentativa falhou.');

  const text = diagnosticAsText(session);
  assert.equal(session.attempts.length, 2);
  assert.equal(first.attempt.summary.warnings, 1);
  assert.equal(text.includes('cliente-confidencial.xml'), false);
  assert.equal(text.includes('12345678000195'), false);
  assert.equal(text.includes('35260112345678000195550010000012341000012345'), false);
});

test('trunca eventos não críticos e nunca descarta erros', () => {
  const session = createDiagnosticSession('1.0.0-test');
  const recorder = createDiagnosticRecorder(session, [], () => undefined);
  for (let index = 0; index < 510; index += 1) {
    recorder.event('info', 'carga', `Evento ${index}`);
  }
  recorder.error('geracao', new Error('Falha controlada.'));
  recorder.finish('falhou', 'Tentativa encerrada.');

  assert.ok(recorder.attempt.truncatedEvents > 0);
  assert.equal(recorder.attempt.summary.errors, 1);
  assert.equal(recorder.attempt.events.some((event) => event.exception?.message === 'Falha controlada.'), true);
  assert.equal(recorder.attempt.events.at(-1)?.stage, 'finalizacao');
});
