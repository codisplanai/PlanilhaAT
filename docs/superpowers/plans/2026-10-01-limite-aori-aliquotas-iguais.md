# Dispensa do limite de 10% da A.ORI com alíquotas iguais — Plano de Implementação

> **Para agentes executores:** siga as tarefas em ordem e marque cada passo (`- [ ]` → `- [x]`). Agentes com as skills superpowers devem usar superpowers:executing-plans ou superpowers:subagent-driven-development. A **Task 5 só pode ser executada com pedido explícito do usuário.**

**Goal:** Na Antecipação Parcial, deixar de aplicar o limite de 10% da A.ORI quando a alíquota de origem do XML for igual à A.DST. Assim o imposto zera e a regra de alíquotas iguais exclui o item da planilha.

**Architecture:** A regra fica em `resolveOriginRate` (`frontend/src/lib/localProcessing/rules.ts`). A função passa a receber a A.DST e a devolver a flag `limitWaived`. O `processor.ts` passa a A.DST efetiva para a função e grava `a_ori_limite_dispensado` nos metadados da linha. A exclusão por alíquotas iguais (`shouldExcludeEqualRates`) não muda de comportamento; ela só passa a usar o mesmo critério de igualdade (`sameRate`), para que as duas regras nunca discordem sobre o que é "igual".

**Tech Stack:** React 19 + TypeScript (Vite). Os testes usam `node:test`, executados por `node --experimental-strip-types`. Lint com `oxlint` e build com `tsc -b && vite build`. Ambiente Windows.

**Spec:** design aprovado pelo usuário em 01/10/2026, numa conversa com o Claude Code, e reproduzido na seção "Regra aprovada" abaixo. Todo o código deste plano foi validado antes de ser escrito: na fase RED os testes falham, na GREEN 19 de 19 passam, as mutações da regra são detectadas e `tsc` e `oxlint` terminam limpos.

## Regra aprovada

O perfil pode ligar "Limitar Alíquota de Origem (A.ORI) a 10%" (`limitar_a_ori_reducoes`). Com ele ligado, a A.ORI do XML acima de 10% vira 10% quando a A.DST vem de redução por produto, exceção ou termo de acordo. O regulamento permite adotar o tratamento mais benéfico à empresa; por isso o limite **deixa de ser aplicado** quando as três condições abaixo valem ao mesmo tempo:

1. O destino final do item é uma das 4 variantes da Parcial: `antecipacao_parcial`, `antecipacao_parcial_antecipado`, `antecipacao_parcial_simples` ou `antecipacao_parcial_antecipado_simples`.
2. O limite se aplicaria hoje: botão ligado no perfil, origem da A.DST começando com `reducao_produto:`, `excecao:` ou `termo_acordo:`, e A.ORI do XML maior que 10%.
3. A A.ORI do XML é **igual** à A.DST, com tolerância de `1e-10`, a mesma da regra de alíquotas iguais.

Nesse caso a A.ORI fica a do XML e a linha recebe `a_ori_limite_dispensado: true`. A regra de alíquotas iguais, que já roda logo em seguida, exclui o item se a política estiver ligada para a UF no perfil. Se estiver desligada, o item fica na planilha com devido zero.

| Planilha (XML 12%, limite ligado) | A.DST | A.ORI usada | Resultado |
|---|---|---|---|
| Parcial | 12% (redução) | **12%** (hoje 10%) | devido 0 → item excluído pela regra de alíquotas iguais |
| Parcial | 12,06% (termo de acordo) | 10% (igual hoje) | devido 2,06% |
| Parcial | 18% (redução) | 10% (igual hoje) | devido 8% |
| AT e DIFAL | 12% (redução) | 10% (igual hoje) | igual hoje |

**Não muda:** AT, DIFAL, os casos com A.DST diferente da A.ORI do XML, a A.ORI fixa por empresa (que é avaliada antes do limite) e o Convênio 52/91 (onde o limite já não atua).

## Global Constraints

- **Escopo fechado.** Só podem mudar:
  - `frontend/src/lib/localProcessing/rules.ts`
  - `frontend/src/lib/localProcessing/processor.ts`
  - `frontend/src/pages/PerfisRegras/index.tsx`
  - `frontend/tests/originRate.test.ts`
  - este plano

  Nada em `app/`, `alembic/`, `.github/` ou `app/services/pipeline_service.py`.
- Tolerância de igualdade: `1e-10`, definida uma única vez na função `sameRate`.
- `shouldExcludeEqualRates` mantém exatamente o comportamento atual.
- Textos de interface em português.
- **Não rode alembic nem nenhum comando no banco.** O `DATABASE_URL` do `.env` local aponta para o banco de **PRODUÇÃO**. Esta mudança não tem migration.
- O terminal é Windows: rode **um comando por vez**, porque o PowerShell 5.1 não aceita `&&`.
- Os arquivos do repositório usam fim de linha CRLF. Preserve isso ao editar.
- Cada trecho "antigo" das edições abaixo aparece **exatamente uma vez** no arquivo. Se não encontrar o trecho, ou encontrar mais de uma vez, PARE e reporte.
- Branch: `fix/limite-aori-aliquotas-iguais`, a partir da `develop` atualizada.
- Mensagens de commit sem acentos, como nos commits recentes do repositório.
- Não faça merge nem release sem pedido explícito do usuário (veja a Task 5).

---

### Task 1: Regra em `resolveOriginRate` (TDD)

**Files:**
- Modify: `frontend/src/lib/localProcessing/rules.ts` (interface `OriginRateResolution` na linha ~318, `resolveOriginRate` na ~326, `shouldExcludeEqualRates` na ~394)
- Test: `frontend/tests/originRate.test.ts` (substituir o arquivo inteiro)

**Interfaces:**
- Produces:
  - `resolveOriginRate(context: LocalProcessingContext, destination: TipoPlanilha, aOri: number, aDst: number, rateOrigin: string): OriginRateResolution`. O parâmetro novo `aDst` entra na **4ª posição**, antes de `rateOrigin`.
  - `OriginRateResolution = { aOri: number; limited: boolean; fixed: boolean; limitWaived: boolean }`.
  - `sameRate(a: number, b: number): boolean`, privada em `rules.ts`.

- [x] **Step 1: Preparar a branch.** Rode um comando por vez, na raiz do repositório:

```
git status
git fetch origin
git switch develop
git pull --ff-only
git switch -c fix/limite-aori-aliquotas-iguais
```

Esperado: `git status` sem alterações pendentes em arquivos rastreados. Este plano pode aparecer como arquivo não rastreado, e tudo bem: ele acompanha a troca de branch.

- [x] **Step 2: Substituir `frontend/tests/originRate.test.ts` por este conteúdo completo:**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOriginRate, shouldExcludeEqualRates } from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

const PARCIAL = [
  'antecipacao_parcial',
  'antecipacao_parcial_antecipado',
  'antecipacao_parcial_simples',
  'antecipacao_parcial_antecipado_simples',
] as const;

function context(options: {
  aOriFixaParcial?: number | null;
  limitarAOriReducoes?: boolean;
  aliquotasIguaisBA?: boolean;
} = {}): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Cliente BA LTDA',
      cnpj: '12345678000195',
      inscricao_estadual: null,
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
      a_ori_fixa_parcial: options.aOriFixaParcial,
    },
    perfil: {
      id: 1,
      nome: 'Padrão Geral',
      configuracoes_extras: {
        limitar_a_ori_reducoes: options.limitarAOriReducoes ?? false,
        politica_aliquotas_iguais_parcial: { BA: options.aliquotasIguaisBA ?? false },
      },
    },
    regras_aliquotas: [],
    regras_cfop: [],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [],
    mva_anexo: [],
  };
}

function item(): ExtractedItem {
  return {
    itemNumero: 1,
    ncm: '72142000',
    cest: '',
    cfop: '6102',
    descricao: 'VERGALHAO CA-50',
    descricaoConfiavel: true,
    vItem: 1000,
    vTotal: 1000,
    baseCalculo: 1000,
    ipiDespesas: 0,
    aOri: 0.12,
    vIcms: 120,
  };
}

test('limita a A.ORI a 10% quando o A.DST vem de redução, exceção ou termo de acordo', () => {
  for (const rateOrigin of ['reducao_produto:3', 'excecao:9', 'termo_acordo:7']) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 0.18, rateOrigin),
      { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
      rateOrigin,
    );
  }
});

test('o limite de 10% também vale fora da Antecipação Parcial', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_tributaria', 0.12, 0.18, 'termo_acordo:7'),
    { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
  );
});

test('não limita a A.ORI quando o A.DST vem da regra padrão da UF', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 0.205, 'padrao_uf:1'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: false },
  );
});

test('não altera A.ORI de até 10% no limite de reduções', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.07, 0.18, 'termo_acordo:7'),
    { aOri: 0.07, limited: false, fixed: false, limitWaived: false },
  );
});

test('não limita a A.ORI com o limite desligado no perfil', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: false }), 'antecipacao_parcial', 0.12, 0.18, 'termo_acordo:7'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: false },
  );
});

test('aplica a A.ORI fixa da empresa em todas as variantes da Antecipação Parcial', () => {
  for (const destination of PARCIAL) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial: 0.12 }), destination, 0.04, 0.205, 'padrao_uf:1'),
      { aOri: 0.12, limited: false, fixed: true, limitWaived: false },
      destination,
    );
  }
});

test('mantém a A.ORI do XML fora da Antecipação Parcial', () => {
  for (const destination of ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado', 'difal'] as const) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial: 0.12 }), destination, 0.04, 0.205, 'padrao_uf:1'),
      { aOri: 0.04, limited: false, fixed: false, limitWaived: false },
      destination,
    );
  }
});

test('mantém a A.ORI do XML quando a empresa não tem A.ORI fixa', () => {
  for (const aOriFixaParcial of [undefined, null]) {
    assert.deepEqual(
      resolveOriginRate(context({ aOriFixaParcial }), 'antecipacao_parcial', 0.07, 0.205, 'padrao_uf:1'),
      { aOri: 0.07, limited: false, fixed: false, limitWaived: false },
      String(aOriFixaParcial),
    );
  }
});

test('aplica a A.ORI fixa mesmo quando o XML não destaca ICMS', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0.12 }), 'antecipacao_parcial', 0, 0.205, 'padrao_uf:1'),
    { aOri: 0.12, limited: false, fixed: true, limitWaived: false },
  );
});

test('aplica uma A.ORI fixa de 0%', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0 }), 'antecipacao_parcial', 0.12, 0.205, 'padrao_uf:1'),
    { aOri: 0, limited: false, fixed: true, limitWaived: false },
  );
});

test('a A.ORI fixa prevalece sobre o limite de 10% de reduções e termo de acordo', () => {
  assert.deepEqual(
    resolveOriginRate(
      context({ aOriFixaParcial: 0.12, limitarAOriReducoes: true }),
      'antecipacao_parcial',
      0.12,
      0.1206,
      'termo_acordo:7',
    ),
    { aOri: 0.12, limited: false, fixed: true, limitWaived: false },
  );
});

test('o Convênio 52/91 prevalece sobre a A.ORI fixa', () => {
  assert.deepEqual(
    resolveOriginRate(context({ aOriFixaParcial: 0.12 }), 'antecipacao_parcial', 0.0514, 0.088, 'convenio_52_91'),
    { aOri: 0.0514, limited: false, fixed: false, limitWaived: false },
  );
});

test('dispensa o limite de 10% na Parcial quando a A.ORI do XML é igual à A.DST', () => {
  for (const destination of PARCIAL) {
    for (const rateOrigin of ['reducao_produto:3', 'excecao:9', 'termo_acordo:7']) {
      assert.deepEqual(
        resolveOriginRate(context({ limitarAOriReducoes: true }), destination, 0.12, 0.12, rateOrigin),
        { aOri: 0.12, limited: false, fixed: false, limitWaived: true },
        `${destination} ${rateOrigin}`,
      );
    }
  }
});

test('mantém o limite de 10% com alíquotas iguais fora da Parcial', () => {
  for (const destination of ['antecipacao_tributaria', 'antecipacao_tributaria_antecipado', 'difal'] as const) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), destination, 0.12, 0.12, 'reducao_produto:3'),
      { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
      destination,
    );
  }
});

test('mantém o limite de 10% quando a A.DST é diferente da A.ORI do XML', () => {
  for (const aDst of [0.1206, 0.18, 0.10]) {
    assert.deepEqual(
      resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, aDst, 'reducao_produto:3'),
      { aOri: 0.10, limited: true, fixed: false, limitWaived: false },
      String(aDst),
    );
  }
});

test('só dispensa o limite quando ele está ligado no perfil', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: false }), 'antecipacao_parcial', 0.12, 0.12, 'reducao_produto:3'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: false },
  );
});

test('considera iguais as alíquotas que diferem só por arredondamento', () => {
  assert.deepEqual(
    resolveOriginRate(context({ limitarAOriReducoes: true }), 'antecipacao_parcial', 0.12, 0.1 + 0.02, 'reducao_produto:3'),
    { aOri: 0.12, limited: false, fixed: false, limitWaived: true },
  );
});

test('exclui da Parcial o item com redução a 12% e XML a 12%', () => {
  const ctx = context({ limitarAOriReducoes: true, aliquotasIguaisBA: true });
  const { aOri } = resolveOriginRate(ctx, 'antecipacao_parcial', 0.12, 0.12, 'reducao_produto:3');
  assert.deepEqual(
    shouldExcludeEqualRates(ctx, 'antecipacao_parcial', item(), aOri, 0.12),
    { excluded: true, debito: 120, credito: 120, valorDevido: 0 },
  );
});

test('a exclusão por alíquotas iguais usa a mesma tolerância de arredondamento', () => {
  const ctx = context({ aliquotasIguaisBA: true });
  assert.equal(shouldExcludeEqualRates(ctx, 'antecipacao_parcial', item(), 0.12, 0.1 + 0.02).excluded, true);
  assert.equal(shouldExcludeEqualRates(ctx, 'antecipacao_parcial', item(), 0.10, 0.1206).excluded, false);
});
```

- [x] **Step 3: Rodar os testes e confirmar a falha (RED).** Um comando por vez:

```
cd frontend
node --experimental-strip-types --test tests/originRate.test.ts
```

Esperado: `tests 19`, `pass 1`, `fail 18`. As falhas vêm de `TypeError: rateOrigin.startsWith is not a function` ou da falta do campo `limitWaived`. O único teste que passa é "a exclusão por alíquotas iguais usa a mesma tolerância de arredondamento". Isso é proposital: ele descreve um comportamento que já existe e protege a refatoração do Step 4. Se o resultado for outro, PARE e reporte.

- [x] **Step 4: Editar `frontend/src/lib/localProcessing/rules.ts`.** São 5 edições; cada trecho antigo aparece exatamente uma vez.

Edição A. Trecho antigo:

```ts
export interface OriginRateResolution {
  aOri: number;
  limited: boolean;
  fixed: boolean;
}

const REDUCED_RATE_ORIGINS = ['reducao_produto:', 'excecao:', 'termo_acordo:'];
```

Trecho novo:

```ts
export interface OriginRateResolution {
  aOri: number;
  limited: boolean;
  fixed: boolean;
  limitWaived: boolean;
}

const REDUCED_RATE_ORIGINS = ['reducao_produto:', 'excecao:', 'termo_acordo:'];

// Mesma tolerância para dispensar o limite de 10% e para excluir itens com
// alíquotas iguais: as duas regras precisam concordar sobre o que é "igual".
function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-10;
}
```

Edição B. Trecho antigo:

```ts
  destination: TipoPlanilha,
  aOri: number,
  rateOrigin: string,
): OriginRateResolution {
```

Trecho novo:

```ts
  destination: TipoPlanilha,
  aOri: number,
  aDst: number,
  rateOrigin: string,
): OriginRateResolution {
```

Edição C. Trecho antigo:

```ts
    return { aOri: Number(fixedRate), limited: false, fixed: true };
```

Trecho novo:

```ts
    return { aOri: Number(fixedRate), limited: false, fixed: true, limitWaived: false };
```

Edição D. Trecho antigo:

```ts
  if (limitOrigin && reducedOrAgreement && aOri > 0.10) {
    return { aOri: 0.10, limited: true, fixed: false };
  }
  return { aOri, limited: false, fixed: false };
}
```

Trecho novo:

```ts
  if (limitOrigin && reducedOrAgreement && aOri > 0.10) {
    // Na Parcial prevalece o tratamento mais benéfico: com a A.ORI do XML igual
    // à A.DST o imposto zera, e a regra de alíquotas iguais pode excluir o item.
    if (PARTIAL_DESTINATIONS.has(destination) && sameRate(aOri, aDst)) {
      return { aOri, limited: false, fixed: false, limitWaived: true };
    }
    return { aOri: 0.10, limited: true, fixed: false, limitWaived: false };
  }
  return { aOri, limited: false, fixed: false, limitWaived: false };
}
```

Edição E, dentro de `shouldExcludeEqualRates`. Trecho antigo:

```ts
  if (Math.abs(aOri - aDst) > 1e-10 || item.vTotal <= 0) return { excluded: false };
```

Trecho novo:

```ts
  if (!sameRate(aOri, aDst) || item.vTotal <= 0) return { excluded: false };
```

- [x] **Step 5: Rodar os testes de novo (GREEN).** Ainda dentro de `frontend`:

```
node --experimental-strip-types --test tests/originRate.test.ts
```

Esperado: `tests 19`, `pass 19`, `fail 0`.

- [x] **Step 6: Commit.** Um comando por vez, na raiz do repositório:

```
cd ..
git add frontend/src/lib/localProcessing/rules.ts frontend/tests/originRate.test.ts
git commit -m "fix(fiscal): dispensar limite de 10% da A.ORI com aliquotas iguais na Parcial"
```

---

### Task 2: Integração no processador

**Files:**
- Modify: `frontend/src/lib/localProcessing/processor.ts` (interface `Group` na linha ~222, chamada de `resolveOriginRate` na ~498, criação do grupo na ~545, acumulação na ~560, metadados na ~691)

**Interfaces:**
- Consumes: `resolveOriginRate(context, destination, aOri, aDst, rateOrigin)` e o campo `limitWaived`, da Task 1.
- Produces: campo `aOriLimitWaived: boolean` em `Group` e metadado `a_ori_limite_dispensado: boolean` em `metadados_extras` de cada nota processada.

- [x] **Step 1: Editar `frontend/src/lib/localProcessing/processor.ts`.** São 5 edições; cada trecho antigo aparece exatamente uma vez.

Edição P1, interface `Group`. Trecho antigo:

```ts
  aOriLimited: boolean;
  aOriFixed: boolean;
  aOriOriginal: number;
```

Trecho novo:

```ts
  aOriLimited: boolean;
  aOriFixed: boolean;
  aOriLimitWaived: boolean;
  aOriOriginal: number;
```

Edição P2, chamada de `resolveOriginRate`: passar a A.DST efetiva na 4ª posição. Trecho antigo:

```ts
        convenio?.applied ? Number(convenio.aOri) : item.aOri,
        effectiveRate.origem,
      );
```

Trecho novo:

```ts
        convenio?.applied ? Number(convenio.aOri) : item.aOri,
        effectiveADst,
        effectiveRate.origem,
      );
```

Edição P3, criação do grupo. Trecho antigo:

```ts
        aOriLimited: false,
        aOriFixed: false,
        aOriOriginal: originalAOri,
```

Trecho novo:

```ts
        aOriLimited: false,
        aOriFixed: false,
        aOriLimitWaived: false,
        aOriOriginal: originalAOri,
```

Edição P4, acumulação. Trecho antigo:

```ts
      group.aOriFixed ||= originRate.fixed;
```

Trecho novo:

```ts
      group.aOriFixed ||= originRate.fixed;
      group.aOriLimitWaived ||= originRate.limitWaived;
```

Edição P5, metadados. Trecho antigo:

```ts
          a_ori_fixa_parcial: group.aOriFixed,
```

Trecho novo:

```ts
          a_ori_fixa_parcial: group.aOriFixed,
          a_ori_limite_dispensado: group.aOriLimitWaived,
```

- [x] **Step 2: Type-check e build.** Um comando por vez:

```
cd frontend
npm run build
```

Esperado: termina sem erros de TypeScript, com `✓ built in ...`. Um erro aqui normalmente indica que alguma edição P1–P5 ficou faltando.

- [x] **Step 3: Suíte completa do frontend:**

```
npm test
```

Esperado: `tests 78`, `pass 78`, `fail 0`. Antes da mudança eram 71; o arquivo de testes passou de 12 para 19.

- [x] **Step 4: Commit:**

```
cd ..
git add frontend/src/lib/localProcessing/processor.ts
git commit -m "fix(fiscal): registrar dispensa do limite da A.ORI nos metadados"
```

---

### Task 3: Texto do limite na tela de Perfis

**Files:**
- Modify: `frontend/src/pages/PerfisRegras/index.tsx` (linhas ~599 e ~914)

**Interfaces:** nenhuma; muda só o texto exibido.

- [x] **Step 1: Editar os dois textos.** Cada trecho antigo aparece exatamente uma vez.

Edição U1, linha ~599. Trecho antigo:

```tsx
subtitle="Aplica o limite somente a itens calculados sob Redução por Produto ou Termo de Acordo."
```

Trecho novo:

```tsx
subtitle="Aplica o limite somente a itens calculados sob Redução por Produto ou Termo de Acordo. Na Antecipação Parcial, não se aplica quando a A.ORI do XML é igual à A.DST."
```

Edição U2, linha ~914, no fim do parágrafo que começa com "Quando ativo, alíquotas interestaduais superiores a 10%". Trecho antigo:

```
no preenchimento da planilha para itens de notas sob Redução ou Termo de Acordo.
```

Trecho novo:

```
no preenchimento da planilha para itens de notas sob Redução ou Termo de Acordo. Exceção: na Antecipação Parcial, se a alíquota do XML for igual à de destino (ex.: 12% e 12%), o limite não é aplicado, o imposto fica zero e o item pode ser excluído pela regra de alíquotas iguais.
```

- [x] **Step 2: Lint e build.** Um comando por vez:

```
cd frontend
npm run lint
npm run build
```

Esperado: os dois sem erros.

- [x] **Step 3: Commit:**

```
cd ..
git add frontend/src/pages/PerfisRegras/index.tsx
git commit -m "fix(ui): citar excecao de aliquotas iguais no limite da A.ORI"
```

---

### Task 4: Verificação final, push e PR

**Files:**
- Add: `docs/superpowers/plans/2026-10-01-limite-aori-aliquotas-iguais.md` (este plano)

**Interfaces:** nenhuma.

- [x] **Step 1: Verificação completa.** Um comando por vez:

```
cd frontend
npm test
npm run lint
npm run build
cd ..
git diff --stat origin/develop
```

Esperado:
- `npm test` com `tests 78`, `pass 78`, `fail 0`;
- lint e build sem erros;
- o `git diff --stat` listando **somente** `rules.ts`, `processor.ts`, `PerfisRegras/index.tsx` e `originRate.test.ts`.

Se aparecer qualquer outro arquivo, PARE e reporte.

- [x] **Step 2: Commit do plano:**

```
git add docs/superpowers/plans/2026-10-01-limite-aori-aliquotas-iguais.md
git commit -m "docs: plano da dispensa do limite de 10% da A.ORI com aliquotas iguais"
```

- [ ] **Step 3: Push:**

```
git push -u origin fix/limite-aori-aliquotas-iguais
```

- [ ] **Step 4: Criar o corpo do PR** num arquivo UTF-8 **fora do repositório** (por exemplo, numa pasta temporária), com este conteúdo exato. O PR Validation exige as seções `## Descrição` e `## Branch`.

```markdown
## Descrição

Na Antecipação Parcial, o limite de 10% da A.ORI (opção "Limitar Alíquota de Origem (A.ORI) a 10%" do perfil) deixa de ser aplicado quando a alíquota de origem do XML é igual à A.DST. Isso segue o regulamento que permite adotar o tratamento mais benéfico à empresa. Com redução a 12% e XML a 12%, o crédito fica em 12% em vez de 10%, o imposto zera e a regra de alíquotas iguais pode excluir o item da planilha.

- A regra fica em `resolveOriginRate` (`rules.ts`), que passa a receber a A.DST.
- AT, DIFAL e os casos com alíquotas diferentes continuam limitados a 10%.
- A A.ORI fixa por empresa e o Convênio 52/91 não mudam.
- A linha ganha o metadado `a_ori_limite_dispensado`.
- O texto do limite na tela de Perfis cita a exceção.
- `shouldExcludeEqualRates` mantém o comportamento e passa a usar o mesmo critério de igualdade (`sameRate`).

## Branch

- Origem: `fix/limite-aori-aliquotas-iguais`
- Destino: `develop`

## Validação

- [x] Revisei lint/sintaxe localmente.
- [x] Não adicionei segredos, `.env`, bancos locais ou artefatos de build.
- [x] A descrição está atualizada.

Testes: `npm test` com 78 passando; `npm run lint` e `npm run build` sem erros.

## Release

Não se aplica (PR para `develop`).
```

- [ ] **Step 5: Abrir o PR.** Troque `<caminho-do-arquivo>` pelo arquivo do Step 4:

```
gh pr create --base develop --head fix/limite-aori-aliquotas-iguais --title "fix(fiscal): dispensar limite de 10% da A.ORI com alíquotas iguais na Parcial" --body-file <caminho-do-arquivo>
```

- [ ] **Step 6: Aguardar as verificações do PR:**

```
gh pr checks <numero-do-pr> --watch
```

Esperado: "PR title, description and branch", "Backend syntax and indentation" e "Frontend lint and typecheck - no build" com `pass`. Depois apague o arquivo do corpo do PR.

- [ ] **Step 7: Relatório ao usuário.** Inclua:
  - o número do PR;
  - os resultados de `npm test`, lint e build;
  - o `git diff --stat`;
  - o status das verificações do PR.

  **Pare aqui.**

---

### Task 5 (opcional): merge e release

> Execute **somente** se o usuário pedir explicitamente.

**Files:** nenhum.

**Interfaces:** nenhuma.

- [ ] **Step 1:** Faça squash merge do PR na `develop` com `gh pr merge <numero-do-pr> --squash`. Não apague a branch.
- [ ] **Step 2:** Aguarde os workflows do push na `develop` terminarem verdes (`gh run list --branch develop`). "Develop - Test and GHCR Artifacts" precisa passar. Se algo falhar, PARE e reporte.
- [ ] **Step 3:** Confira que `git log origin/main..origin/develop` mostra **apenas** o commit de squash deste PR. Se aparecer outro, PARE e reporte.
- [ ] **Step 4:** Abra o PR de release. O corpo segue o mesmo modelo do Step 4 da Task 4, com Origem `develop`, Destino `main` e a seção Release contendo "Título: `release(patch): dispensar limite de 10% da A.ORI com alíquotas iguais na Parcial`" e "Versão: `1.7.1 -> 1.7.2`".

```
gh pr create --base main --head develop --title "release(patch): dispensar limite de 10% da A.ORI com alíquotas iguais na Parcial" --body-file <caminho-do-arquivo>
```

- [ ] **Step 5:** Aguarde o PR Validation e faça o merge com **merge commit**, sem squash: `gh pr merge <numero> --merge`.
- [ ] **Step 6:** Acompanhe até o fim e confira cada item:
  - "Main - Build Artifacts and Semantic Release" com os 7 jobs verdes;
  - nas execuções de produção de "Vercel - Fullstack Bootstrap and Release", o passo "Apply database migrations" com sucesso e `019_a_ori_fixa_parcial (head)` no log (não há migration nova);
  - `gh release view v1.7.2` publicada;
  - `https://planaut.codisplan.com.br/api/health` respondendo HTTP 200 com `"version":"1.7.2"`.

  Não reexecute releases antigas. Se precisar voltar versão, use o Instant Rollback da Vercel.

---

## Conferência funcional (para o usuário, depois do deploy)

1. Use uma empresa da BA cujo perfil tenha:
   - "Limitar Alíquota de Origem (A.ORI) a 10%" ligado;
   - a política de alíquotas iguais ligada para a BA;
   - uma redução por produto a 12% para algum NCM.
2. Processe na Antecipação Parcial um XML interestadual com esse NCM e `pICMS` 12%.
3. O item deve aparecer em "Itens excluídos" com o motivo "Alíquotas iguais com valor devido zero ou negativo".
4. Antes desta mudança, o mesmo item entrava na planilha com A.ORI 10% e devido de 2%.
