## Descrição

Descreva de forma objetiva o que foi alterado, por que a alteração é necessária e qualquer impacto relevante.

## Branch

- Origem: `feature/...`, `fix/...`, `refactor/...`, `chore/...`, `docs/...`, `test/...`, `ci/...`, `perf/...` ou `develop`
- Destino: `develop` ou `main`

## Validação

- [ ] Revisei lint/sintaxe localmente.
- [ ] Não adicionei segredos, `.env`, bancos locais ou artefatos de build.
- [ ] A descrição está atualizada.

## Release

Preencha esta seção somente para PR `develop -> main`.

O título do PR deve ser exatamente um destes formatos:

- `release(patch): descrição da release`
- `release(minor): descrição da release`
- `release(major): descrição da release`

SemVer aplicado automaticamente:

- `patch`: `1.0.0 -> 1.0.1`
- `minor`: `1.0.1 -> 1.1.0`
- `major`: `1.1.1 -> 2.0.0`
