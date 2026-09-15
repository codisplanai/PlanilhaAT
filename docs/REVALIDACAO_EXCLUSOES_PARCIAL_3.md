# Terceira verificação das exclusões da Parcial

Data: 15/09/2026. Escopo: código local após a segunda rodada de correções.
Referência: [revalidação anterior](REVALIDACAO_EXCLUSOES_PARCIAL.md).

## Resultado

Os cenários reproduzidos nas duas revisões anteriores agora passam. Permanecem
dois problemas de compatibilidade com instalações e configurações anteriores,
confirmados por testes isolados nesta rodada.

### Correções confirmadas

- Erro numérico, junto com mercadoria excluída, agora impede concluir “nenhum
  item a recolher”; CFOP desconhecido continua impedindo essa conclusão.
- Edição de termos e de NCM é preservada ao recarregar as regras iniciais:
  registros novos possuem `chave_origem`.
- Consultar perfis com política booleana antiga voltou a funcionar.
- UF em minúsculas ou com espaços é normalizada; a política passa a atuar na BA.
- Permanecem aprovadas as reproduções de exclusão antes da resolução de A.dest,
  aviso de dados incompletos, cálculo com alíquotas iguais e valores negativos.

## 1. [P1] Atualizar uma instalação que já aplicou a antiga migração 013 não cria a coluna nova

Local: `alembic/versions/013_exclusoes_parcial.py`, linha 31;
`app/models/regra_exclusao_parcial.py`, linha 28.

A coluna `chave_origem` e seu índice foram acrescentados diretamente à migração
013. Não existe uma migração posterior para acrescentá-los aos bancos que já
registraram a execução da versão anterior de 013, onde a coluna não existia.

Reprodução:

1. Preparar banco com a estrutura anterior de 013, sem `chave_origem`, mantendo
   `alembic_version = '013_exclusoes_parcial'`.
2. Executar `alembic upgrade head` usando a implementação atual.
3. Consultar a estrutura da tabela de regras.

Resultado: a coluna continua ausente. Alembic não reexecuta uma revisão já
aplicada. O modelo ORM atual exige a coluna, de modo que o cadastro e o preload
das regras passam a depender de uma estrutura que esses bancos não receberam.
Instalações novas que executam 013 pela primeira vez não têm esse problema.

Correção indicada: criar migração incremental posterior que atualize as
instalações existentes, com tratamento dos dois formatos de 013 que podem ter
sido executados. Não apagar dados ou pedir que um banco em uso reexecute a
criação completa das tabelas. Preservar os cadastros e a identidade das regras.

Teste reprovado: `test_upgrade_from_previously_applied_013_adds_origin_key`.

## 2. [P2] Política antiga aparece ativa na tela, mas fica inativa no cálculo

Locais: `app/services/rules_engine/parcial_decision.py`, trechos de leitura da
política em `preload` e `is_politica_aliquotas_iguais_ativa`;
`frontend/src/pages/PerfisRegras/index.tsx`, linhas 311–313.

A API agora permite ler o formato antigo, mas o serviço numérico só considera
políticas em dicionário. A interface ainda interpreta o booleano global `true`
como “Ativo (BA)”.

Reprodução: perfil com a configuração persistida, aceita na implementação anterior:

```json
{"politica_aliquotas_iguais_parcial": true}
```

A consulta do perfil retorna 200 e conserva esse valor. A expressão usada pela
tela resulta em `ativo = true`, enquanto o serviço de cálculo retorna `false`
para a mesma empresa/UF. Assim, itens com alíquotas iguais e imposto zero podem
continuar na Parcial apesar do indicador ativo.

Correção indicada: definir uma conversão explícita dos formatos anteriores para
o mapa por UF, respeitando o escopo do perfil, ou mostrar que o perfil exige
reconfiguração antes de tratá-lo como ativo. Interface e motor devem usar o mesmo
estado efetivo. Aceitar a leitura do registro antigo, isoladamente, não resolve
a divergência de comportamento.

Teste reprovado: `test_old_enabled_policy_remains_consistent_with_profile_response`.

## Evidências desta rodada

- **79 testes relevantes do projeto: aprovados.**
- **30 testes das revisões anteriores: aprovados.** Incluem os quatro problemas
  da última rodada e migração 012 → 013 → 012 com dados de teste.
- **2 testes adicionais de compatibilidade: reprovados**, nos casos acima.
- **Lint e build do frontend: aprovados.**

Os testes utilizaram bancos SQLite e armazenamento isolados. Não foi consultado
o banco de produção para saber se existem instalações com 013 antiga ou perfis
com política global. A avaliação desses caminhos é condicional à existência
desses estados anteriores, cuja compatibilidade foi testada por reprodução.

Nenhuma correção funcional foi aplicada nesta revisão.

## Reproduções

Arquivo: `.runtime-tmp/review-parcial/test_existing_installation.py`.

Na raiz do projeto:

```powershell
$env:STORAGE_DIR = "$PWD/.runtime-tmp/review-parcial/storage"
$env:TEMPLATES_DIR = "$PWD/.runtime-tmp/review-parcial/storage/templates"
$env:OUTPUTS_DIR = "$PWD/.runtime-tmp/review-parcial/storage/outputs"
$env:UPLOADS_DIR = "$PWD/.runtime-tmp/review-parcial/storage/uploads"
$env:PYTHONPATH = "$PWD/tests;$PWD"
./.venv/Scripts/python.exe -m pytest -p conftest -p no:cacheprovider -q .runtime-tmp/review-parcial/test_existing_installation.py --tb=short
```
