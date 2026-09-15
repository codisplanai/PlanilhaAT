# Revisão da implementação das exclusões da Parcial

Data: 15/09/2026.
Referência: [plano aprovado](PLANO_EXCLUSOES_PARCIAL.md).
Escopo: alterações locais ainda sem commit, sobre a revisão `78509ac`.

## Conclusão

A implementação atende aos exemplos básicos, mas precisa de correções antes de
ser considerada aderente ao plano. Foram identificados seis problemas: cinco
reproduzidos por testes de backend e um confirmado pela implementação da tela.
Nenhuma correção funcional foi aplicada nesta revisão.

P1 indica prioridade alta, por permitir exclusões indevidas ou conclusão sem
apuração completa. P2 indica correção necessária de comportamento ou conferência.

## 1. [P1] Recarregar o padrão BA restaura uma exclusão que o usuário restringiu

Local: `app/api/endpoints/regras_exclusao_parcial.py`, linhas 213–234.

O carregamento identifica regras por NCM + termos atuais. Após editar os termos
de uma regra inicial, a combinação original deixa de ser reconhecida e é criada
novamente, ativa, ao carregar o padrão.

Reprodução:

1. Carregar as sete regras da Bahia.
2. Alterar charque de `CHARQUE` para `CHARQUE` **e** `BOVINO`.
3. Carregar o padrão novamente.

Resultado: uma inserção e oito regras no total. A regra geral `CHARQUE` reaparece;
como qualquer regra correspondente exclui a mercadoria, produtos sem `BOVINO`
voltam a ser excluídos, contrariando a restrição feita pelo usuário.

Correção sugerida: identificar a origem da regra inicial por chave estável,
independente de NCM/termos editáveis, e respeitar alterações e desativações nas
cargas seguintes. Não basta verificar se o texto original ainda existe.

Teste que falhou: `test_reload_seed_preserves_edited_term_scope`.

## 2. [P1] Um item excluído transforma falta de roteamento em “nenhum item a recolher”

Locais: `app/services/pipeline_service.py`, linhas 584–597, e
`frontend/src/pages/NovaSolicitacao/index.tsx`, linhas 757–809.

Quando não há linhas, basta existir um item excluído para concluir a solicitação
como “Nenhum item a recolher na Parcial”. Esse retorno ocorre antes de verificar
CFOPs sem regra ou outros motivos que impediram a apuração.

Reprodução: nota com charque excluído e outro produto com CFOP `6999`, sem
roteamento cadastrado. O processamento retorna `concluido`, apesar de não ter
apurado o segundo produto. O contador de CFOPs desconhecidos é persistido, mas a
conclusão principal afirma ausência de itens a recolher. A tela usa a mesma
heurística e suprime o estado principal de avisos nesse caso.

Correção sugerida: distinguir exclusão legítima de itens não avaliados. Só
concluir sem valores a recolher quando a apuração estiver completa; preservar
diagnóstico específico quando houver falta de roteamento ou erro de validação.

Teste que falhou: `test_excluded_item_does_not_mask_unknown_cfop`.

## 3. [P2] Exclusão por mercadoria depende indevidamente da resolução de alíquota

Local: `app/services/pipeline_service.py`, linhas 283–332.

O plano determina a exclusão por NCM + descrição antes da resolução de A.dest.
O código resolve as alíquotas e aplica ajustes antes de chamar `avaliar_item`.
Assim, a falta de alíquota ou um conflito de regras pode interromper uma nota
composta apenas de mercadorias que deveriam ser excluídas.

Reprodução: manter a exclusão cadastrada de charque e remover as alíquotas do
perfil. Processar uma nota contendo apenas `02102000 / CHARQUE`. Resultado:
`RuleResolutionException`, pedindo cadastro de A.dest, em vez de registrar a exclusão.

Correção sugerida: separar a decisão por mercadoria da decisão numérica. Aplicar
a primeira após o roteamento por CFOP e a segunda após resolver e ajustar as
alíquotas. Campos não calculados da conferência devem permanecer ausentes/nulos.

Teste que falhou: `test_excluded_commodity_does_not_require_destination_rate`.

## 4. [P2] A conferência mostra imposto zero para todos os itens excluídos

Local: `frontend/src/components/domain/ItensExcluidosSection.tsx`, linha 216.

A coluna “V. Devido” renderiza `formatCurrency(0)` para todas as linhas e ignora
`item.valor_devido`. Isso oculta resultados negativos e apresenta zero quando o
imposto nem foi calculado, nas exclusões por mercadoria.

Reprodução de dados: milho com total de R$ 100, base de R$ 110 e alíquotas de 7%
é excluído e guarda `valor_devido = -0.70` no backend. A expressão da tela exibe
R$ 0,00 para esse mesmo registro.

Correção sugerida: exibir o valor efetivamente registrado; usar “Não calculado” ou
travessão quando for nulo. A conferência deve permitir consultar também débito,
crédito e os critérios registrados, atualmente ausentes da apresentação.

Evidência: `test_negative_result_is_retained_in_api` passou; o erro de exibição
foi confirmado por inspeção da expressão JSX, sem teste visual no navegador.

## 5. [P2] Política numérica aceita valores inválidos e interpreta “false” como ativa

Locais: `app/services/rules_engine/parcial_decision.py`, linhas 89–94 e 117–120;
`app/schemas/perfil_regras.py`, linhas 8 e 26.

A configuração continua como dicionário genérico, sem a validação explícita
prevista no plano. O motor usa `bool(valor)`, que considera qualquer texto não
vazio verdadeiro.

Reprodução: atualizar o perfil pela API com
`{"politica_aliquotas_iguais_parcial": {"BA": "false"}}` em
`configuracoes_extras`. A API responde 200 e o serviço considera a política ativa.
A interface normal envia booleanos, mas a API aceita configurações com significado
oposto ao pretendido. Existe ainda suporte a booleano global, ampliando o escopo
para todas as UFs, além da configuração por UF prevista no plano.

Correção sugerida: validar especificamente essa chave como mapa de UFs válidas
para booleanos estritos, mantendo extensibilidade das demais configurações.
Rejeitar formatos ambíguos e consumir os valores já validados sem coerção por `bool`.

Testes que falharam: `test_policy_rejects_non_boolean_values` e
`test_false_string_actually_activates_policy`.

## 6. [P2] NCM ausente e descrição vazia passam sem aviso de avaliação incompleta

Local: `app/services/pipeline_service.py`, linhas 322–329.

O aviso só é emitido quando `descricao_confiavel` é falso. Um XML pode ter
descrição vazia ou NCM `00000000` e continuar marcado como descrição confiável.
Nesses casos, a exclusão por mercadoria não é avaliada com os dados necessários,
mas a conferência não informa essa limitação.

Reprodução: processar separadamente `00000000 / PRODUTO` e `02102000 / descrição
vazia`. Em ambos os casos, `avisos_avaliacao` fica vazio.

Correção sugerida: verificar também NCM válido e descrição não vazia após
normalização. Manter o processamento das demais regras com aviso, como definido
na seção de dados incompletos do plano.

Teste que falhou, em dois casos: `test_incomplete_product_data_produces_warning`.

## Verificações executadas

- **55 testes existentes/relevantes aprovados**, abrangendo exclusões, CRUD/carga
  inicial, correspondência de descrição, pipeline multi-planilha, Simples,
  pagamento antecipado, redução por produto, reclassificação de CFOP, SPED e fórmulas.
- **25 verificações adicionais de revisão: 18 passaram e 7 falharam.** As falhas
  reproduzem os cinco problemas de backend descritos acima.
- Os casos adicionais aprovados incluem zero, negativo, diferença positiva e
  arredondamento no serviço numérico das quatro modalidades, persistência de
  resultado negativo e migração com dados existentes.
- **Migração 012 → 013 → 012 aprovada em SQLite isolado**, preservando solicitação
  anterior, preenchendo os novos campos com listas vazias e sem semear perfis.
- **Frontend:** `npm.cmd run lint` e `npm.cmd run build` aprovados.

Os testes usaram banco de teste e arquivos em `.runtime-tmp/review-parcial`.
As primeiras execuções tiveram problemas de ambiente (templates ainda não
copiados para o diretório isolado, bloqueio do wrapper PowerShell do npm e
disputa de arquivo entre execuções de testes). Esses problemas foram resolvidos
antes de contabilizar os resultados finais; não são defeitos atribuídos à implementação.

A revisão é do código local. Não foi verificada implantação em produção, migração
em PostgreSQL ou interação visual completa no navegador.

## Reprodução das verificações adicionais

Arquivo: `.runtime-tmp/review-parcial/test_review_parcial.py`.
Os testes ficam fora da descoberta normal de `tests/`, pois incluem expectativas
que intencionalmente falham enquanto os problemas não forem corrigidos.

Executar na raiz do projeto, depois de preparar o armazenamento de teste:

```powershell
$env:STORAGE_DIR = "$PWD/.runtime-tmp/review-parcial/storage"
$env:TEMPLATES_DIR = "$PWD/.runtime-tmp/review-parcial/storage/templates"
$env:OUTPUTS_DIR = "$PWD/.runtime-tmp/review-parcial/storage/outputs"
$env:UPLOADS_DIR = "$PWD/.runtime-tmp/review-parcial/storage/uploads"
$env:PYTHONPATH = "$PWD/tests;$PWD"
./.venv/Scripts/python.exe -m pytest -p conftest -p no:cacheprovider -q .runtime-tmp/review-parcial/test_review_parcial.py --tb=short
```

## Próximo passo recomendado

Corrigir os seis pontos, incorporar as reproduções à suíte permanente e repetir
os testes afetados. Priorizar a preservação das edições na carga inicial e a
distinção entre exclusão legítima e apuração incompleta.
