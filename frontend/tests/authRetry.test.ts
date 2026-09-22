import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldAttemptRefresh } from '../src/lib/accessToken.ts';

test('renova e retenta uma requisição de negócio que tomou 401', () => {
  assert.equal(
    shouldAttemptRefresh({ status: 401, url: '/empresas', alreadyRetried: false }),
    true,
  );
});

test('não retenta uma requisição já retentada', () => {
  // Esta é a trava contra laço infinito: um 401 persistente renovaria e
  // repetiria para sempre sem a marca de tentativa.
  assert.equal(
    shouldAttemptRefresh({ status: 401, url: '/empresas', alreadyRetried: true }),
    false,
  );
});

test('não renova a partir das próprias rotas de sessão', () => {
  for (const url of ['/auth/login', '/auth/refresh', '/auth/logout']) {
    assert.equal(
      shouldAttemptRefresh({ status: 401, url, alreadyRetried: false }),
      false,
      `${url} não pode disparar renovação`,
    );
  }
});

test('/auth/me é rota de negócio e merece a retentativa', () => {
  // É a primeira chamada autenticada após o boot; excluí-la faria a sessão
  // recém-renovada parecer inválida.
  assert.equal(
    shouldAttemptRefresh({ status: 401, url: '/auth/me', alreadyRetried: false }),
    true,
  );
});

test('outros códigos de erro não disparam renovação', () => {
  for (const status of [400, 403, 404, 409, 500, 503, undefined]) {
    assert.equal(
      shouldAttemptRefresh({ status, url: '/empresas', alreadyRetried: false }),
      false,
      `status ${status} não deveria renovar`,
    );
  }
});

test('uma requisição sem URL conhecida não é retentada às cegas', () => {
  assert.equal(
    shouldAttemptRefresh({ status: 401, url: undefined, alreadyRetried: false }),
    true,
  );
});

test('a URL completa também é reconhecida como rota de sessão', () => {
  assert.equal(
    shouldAttemptRefresh({
      status: 401,
      url: 'https://planaut.exemplo.com/api/v1/auth/refresh',
      alreadyRetried: false,
    }),
    false,
  );
});
