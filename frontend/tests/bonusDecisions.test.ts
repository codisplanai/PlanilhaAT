import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBonusDecisions } from '../src/lib/bonusDecisions.ts';
import type { NotaBonificacaoPendencia } from '../src/types/solicitacao.ts';

const nota = (chave: string, sugestaoRevenda: boolean) => ({
  chave_acesso: chave,
  numero_nota: chave.slice(-3),
  sugestao_revenda: sugestaoRevenda,
}) as NotaBonificacaoPendencia;

test('comércio: pré-seleção segue a sugestão por crédito de ICMS', () => {
  assert.deepEqual(
    initialBonusDecisions([nota('A001', true), nota('A002', false)], false),
    { A001: true, A002: false },
  );
});

test('indústria: crédito não indica descarte, tudo começa como uso/consumo (DIFAL)', () => {
  assert.deepEqual(
    initialBonusDecisions([nota('A001', true), nota('A002', false)], true),
    { A001: false, A002: false },
  );
});
