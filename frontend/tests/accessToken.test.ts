import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionRefresher } from '../src/lib/accessToken.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<Parameters<typeof createSessionRefresher>[0]> = {}) {
  let agora = 1_000_000;
  const chamadas: number[] = [];
  const encerramentos: number[] = [];

  const refresher = createSessionRefresher({
    now: () => agora,
    onSessionEnded: () => encerramentos.push(agora),
    refresh: async () => {
      chamadas.push(agora);
      return { accessToken: `token_${chamadas.length}`, expiresIn: 3600 };
    },
    ...overrides,
  });

  return {
    refresher,
    chamadas,
    encerramentos,
    avancar: (segundos: number) => {
      agora += segundos * 1000;
    },
  };
}

test('guarda o token em memória e o devolve', () => {
  const { refresher } = setup();

  assert.equal(refresher.getAccessToken(), null);
  refresher.setSession('abc', 3600);
  assert.equal(refresher.getAccessToken(), 'abc');

  refresher.clearSession();
  assert.equal(refresher.getAccessToken(), null);
});

test('renovações simultâneas compartilham uma única chamada', async () => {
  const adiado = deferred<{ accessToken: string; expiresIn: number | null }>();
  let invocacoes = 0;
  const { refresher } = setup({
    refresh: () => {
      invocacoes += 1;
      return adiado.promise;
    },
  });

  const tentativas = [refresher.refresh(), refresher.refresh(), refresher.refresh()];
  adiado.resolve({ accessToken: 'compartilhado', expiresIn: 3600 });
  const resultados = await Promise.all(tentativas);

  // O Supabase rotaciona o refresh token e detecta reuso: disparar três
  // renovações em paralelo derrubaria a sessão inteira.
  assert.equal(invocacoes, 1);
  assert.deepEqual(resultados, ['compartilhado', 'compartilhado', 'compartilhado']);
  assert.equal(refresher.getAccessToken(), 'compartilhado');
});

test('uma renovação posterior não reaproveita a promessa já concluída', async () => {
  const { refresher, chamadas } = setup();

  await refresher.refresh();
  await refresher.refresh();

  assert.equal(chamadas.length, 2);
  assert.equal(refresher.getAccessToken(), 'token_2');
});

test('não renova enquanto o token está longe de expirar', async () => {
  const { refresher, chamadas, avancar } = setup();
  refresher.setSession('valido', 3600);

  avancar(60);
  const token = await refresher.ensureFreshToken();

  assert.equal(token, 'valido');
  assert.equal(chamadas.length, 0);
});

test('renova por antecipação quando a expiração se aproxima', async () => {
  const { refresher, chamadas, avancar } = setup();
  refresher.setSession('quase_vencido', 3600);

  // Faltando menos que a margem: renovar agora evita o 401 no meio de um
  // processamento longo.
  avancar(3600 - 30);
  const token = await refresher.ensureFreshToken();

  assert.equal(chamadas.length, 1);
  assert.equal(token, 'token_1');
});

test('sem sessão, não há o que renovar por antecipação', async () => {
  const { refresher, chamadas } = setup();

  assert.equal(await refresher.ensureFreshToken(), null);
  assert.equal(chamadas.length, 0);
});

test('falha na renovação encerra a sessão e propaga o erro', async () => {
  const { refresher, encerramentos } = setup({
    refresh: async () => {
      throw new Error('refresh token inválido');
    },
  });
  refresher.setSession('antigo', 3600);

  await assert.rejects(() => refresher.refresh(), /refresh token inválido/);

  assert.equal(refresher.getAccessToken(), null);
  assert.equal(encerramentos.length, 1);
});

test('a sessão só é encerrada uma vez por falha compartilhada', async () => {
  const adiado = deferred<{ accessToken: string; expiresIn: number | null }>();
  const { refresher, encerramentos } = setup({ refresh: () => adiado.promise });

  const tentativas = [
    refresher.refresh().catch(() => 'falhou'),
    refresher.refresh().catch(() => 'falhou'),
  ];
  adiado.reject(new Error('expirado'));
  assert.deepEqual(await Promise.all(tentativas), ['falhou', 'falhou']);

  assert.equal(encerramentos.length, 1);
});

test('uma falha não trava as renovações seguintes', async () => {
  let deveFalhar = true;
  const { refresher } = setup({
    refresh: async () => {
      if (deveFalhar) throw new Error('instabilidade');
      return { accessToken: 'recuperado', expiresIn: 3600 };
    },
  });

  await assert.rejects(() => refresher.refresh());
  deveFalhar = false;

  // Se a promessa falhada ficasse retida, a sessão nunca mais renovaria.
  assert.equal(await refresher.refresh(), 'recuperado');
});

test('um token sem prazo declarado não dispara renovação em laço', async () => {
  const { refresher, chamadas } = setup();
  // O fallback local emite token opaco sem expiração conhecida.
  refresher.setSession('pat_local', null);

  assert.equal(await refresher.ensureFreshToken(), 'pat_local');
  assert.equal(chamadas.length, 0);
});
