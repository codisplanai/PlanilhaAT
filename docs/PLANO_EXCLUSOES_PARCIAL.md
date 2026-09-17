# Plano de exclusões da Parcial

Data: 15/09/2026. Situação: planejamento concluído; implementação pendente.

## 1. Objetivo e decisões confirmadas

Permitir configurar quais mercadorias deixam de participar da Parcial, mantendo
uma conferência dos itens desconsiderados. Os enquadramentos abaixo são requisitos
informados pelo usuário para o software.

- Cadastro compartilhado por **perfil de regras + UF de destino**. UF inicial: **BA**.
- Aplicação em Parcial, Parcial Simples Nacional, Parcial Paga Antecipadamente e
  Parcial Paga Antecipadamente Simples Nacional.
- Exclusões por mercadoria exigem **NCM exato + descrição compatível**.
- Exclusão por isenção ou imposto pago na entrada prevalece mesmo com IPI ou
  diferença positiva no cálculo. O motivo identifica a regra cadastrada; o sistema
  não deduz comprovação de pagamento a partir do NCM.
- Para os demais itens com alíquotas efetivamente aplicadas iguais, incluir apenas
  quando o valor devido final, arredondado em centavos, for positivo.
- IPI, frete e outras diferenças entre as bases podem justificar essa inclusão.
  IPI maior que zero, isoladamente, não determina a participação.
- Resultado zero ou negativo com alíquotas iguais: excluir e registrar na conferência.
- Alíquotas diferentes: seguir o processamento existente, inclusive o tratamento
  atual de resultados negativos. A nova condição numérica é restrita à igualdade.
- Milho, NCM `10059010`, **não integra a lista de exclusões fixas**. Destino de 7%
  e origem de 4% seguem para cálculo; alíquotas iguais seguem a condição numérica.
- Termos iniciais aprovados; futuras alterações e novos termos serão feitos no cadastro.

## 2. Cadastro inicial da Bahia

Todas as palavras indicadas em uma linha devem aparecer na descrição, em qualquer
ordem, junto com o NCM correspondente.

| Mercadoria | NCM | Palavras obrigatórias | Motivo |
|---|---|---|---|
| Charque | `02102000` | charque | Imposto pago na entrada |
| Mistura para bolo | `19012090` | mistura **e** bolo | Imposto pago na entrada |
| Flocão de milho | `11041900` | flocão **e** milho | Isenção |
| Farinha de milho | `11022000` | farinha **e** milho | Isenção |
| Feijão | `07133399` | feijão | Isenção |
| Sal | `25010020` | sal | Isenção |
| Açúcar | `17019900` | açúcar | Imposto pago na entrada |

Normalização: ignorar maiúsculas, acentos e pontuação; reconhecer palavras
completas. `SAL` corresponde a `SAL REFINADO`, mas não a `SALGADINHO`.
Preservar NCM como texto de oito dígitos, incluindo zeros à esquerda.

## 3. Desenho técnico proposto

### 3.1. Cadastro e configuração

Criar uma entidade própria para exclusões da Parcial, com:

- Identificador, perfil, UF, NCM e nome da mercadoria.
- Motivo enumerado: isenção ou imposto pago na entrada.
- Lista não vazia de palavras/termos obrigatórios; todos precisam corresponder.
- Situação ativa/inativa e datas de criação/alteração.

Permitir várias regras para o mesmo NCM, com combinações diferentes de termos.
Cada linha representa uma combinação alternativa. Por exemplo, adicionar uma
variação de descrição cria outra combinação; acrescentar uma palavra na mesma
linha passa a exigir essa palavra também. A tela deve explicar essa diferença.

Reaproveitar `normalizar` e `casa_termo` de
`app/services/rules_engine/descricao_matcher.py`. Criar a composição com **todos**
os termos para o novo cadastro; `casa_algum`, usado por regras existentes, tem
semântica de **qualquer** termo e deve preservar seu comportamento. O novo
cadastro inicial usa correspondência exata de palavras, sem curingas.

Rejeitar combinações duplicadas após normalização. Se mais de uma regra ativa
corresponder ao item, excluir uma única vez e registrar todas as regras aplicadas.

Representar a política de alíquotas iguais por UF nas configurações do perfil,
com validação explícita na API. Ativá-la no perfil/UF configurado para essa entrega.
Outras UFs e perfis precisam de configuração própria.

Disponibilizar a carga das sete regras no contexto do perfil aberto em
**Perfis e Regras**, para BA. A carga deve ser repetível sem duplicar registros ou
sobrescrever termos editados. A migração cria a estrutura; não escolhe um perfil
arbitrário para receber os dados.

### 3.2. Ordem do processamento

1. Extrair e conciliar XML/SPED conforme o fluxo atual.
2. Aplicar validações existentes e identificar o destino efetivo pelo CFOP,
   incluindo as variantes de Simples e pagamento antecipado.
3. Nos destinos de Parcial configurados, buscar regras ativas do perfil + UF.
4. Havendo correspondência de NCM + descrição, registrar a exclusão e retirar o
   item antes da resolução de alíquotas e do agrupamento financeiro.
5. Para os demais itens, resolver A.dest e aplicar os ajustes existentes em A.origem.
6. Preparar valores e bases com a mesma lógica do processamento vigente. Se as
   alíquotas efetivas forem iguais, executar o calculador da modalidade para decidir
   a participação do item: resultado final `<= 0,00` exclui; resultado `> 0,00` mantém.
7. Agrupar somente os itens mantidos e calcular as linhas finais com as fórmulas atuais.
8. Persistir o resultado e a conferência; gerar as planilhas dos destinos com linhas.

Criar um serviço de decisão em `app/services/rules_engine/`, com regras carregadas
uma vez por solicitação, e manter sua orquestração em `pipeline_service.py`.
A decisão retorna participação, motivo, regras aplicadas e valores de conferência.

### 3.3. Valores, arredondamento e notas mistas

Reaproveitar `CalculatorFactory`, `AntecipacaoParcialCalculator` e `round_currency`
(`Decimal`, centavos, `ROUND_HALF_UP`), incluindo a redução de Simples já existente.
Comparar as alíquotas como valores decimais efetivos; guardar também suas origens.

A seleção é por item, antes de reunir mercadorias. Um item excluído com resultado
negativo não compensa um item mantido com resultado positivo. Um item que resulte
em zero após arredondamento é excluído mesmo que a soma de vários resíduos não
arredondados pudesse atingir um centavo. Os grupos finais continuam usando o
cálculo e arredondamento da planilha; não substituir suas fórmulas por somas de
resultados individuais. Cobrir explicitamente essa diferença de granularidade nos testes.

Extrair a preparação de valores/bases para um helper comum quando necessário,
evitando duas interpretações das correções atuais de base ausente e despesas.
Conservar a regra de uso do total oficial da nota somente quando todos os itens
originais participarem de um único grupo. Se houver exclusão, somar os valores dos
itens mantidos, sem trazer de volta parcelas dos itens retirados. Conferir também
notas com um item, nas quais o extrator já aplica o total oficial.

Com a decisão final de aceitar qualquer diferença positiva, **separar IPI do campo
IPI/Despesas deixou de ser necessário para essa funcionalidade**. A auditoria deve
descrever a diferença entre bases; não afirmar que ela é IPI quando o dado está agregado.

### 3.4. Dados incompletos

Proposta para respeitar a exigência de NCM + descrição: quando faltar NCM válido
ou descrição confiável, não aplicar exclusão por mercadoria e registrar aviso de
que essa regra não pôde ser avaliada. Seguir as demais regras e validações vigentes.
Descrição preenchida que apenas não corresponde aos termos segue normalmente.

SPED sem C170 pode produzir registros C190 agregados com descrição sintética.
Não tratar esse texto como descrição de produto, nem inferir NCM/descrição pela
posição dos itens. A regra numérica pode operar sobre o registro agregado quando
seus valores e alíquotas forem válidos; registrar essa granularidade na conferência.

### 3.5. Conferência, histórico e resultado vazio

Adicionar à solicitação registros estruturados de itens excluídos e avisos de
avaliação incompleta, com contratos de API e tipos de frontend próprios. Cada
exclusão deve conter:

- Arquivo/fonte, chave da nota, número, série e número original do item.
- Destino, NCM, descrição e indicação de item real ou registro agregado.
- Motivo e cópia dos critérios aplicados, com identificadores das regras.
- Valores e bases; alíquotas, débito, crédito e imposto quando calculados.

Exclusão por mercadoria não exige calcular imposto: campos não calculados ficam
ausentes, sem inventar resultado zero. Guardar os critérios da ocasião permite
explicar resultados históricos depois de o cadastro ser editado.

Exibir as informações em **Nova Solicitação** e **Histórico**, distinguindo notas
inteiras ignoradas de itens excluídos de uma nota parcialmente aproveitada.
Cada item excluído conta uma vez, mesmo com várias regras correspondentes.

Quando todos os itens elegíveis forem excluídos pelas novas regras, concluir a
solicitação com zero linhas e a mensagem **“Nenhum item a recolher na Parcial”**,
preservando a conferência e sem disponibilizar arquivo inexistente. Esse sucesso
sem linhas não deve encobrir erros de entrada, falhas de resolução ou falta de
roteamento: manter os diagnósticos específicos desses casos.

Edição de regras afeta novos processamentos. Regenerar um Excel do histórico usa
os dados persistidos e não reaplica silenciosamente o cadastro atual.

## 4. Etapas de implementação

1. **Persistência e API:** migração, entidade, política por UF, schemas, validação,
   CRUD e carga inicial no perfil selecionado. Seguir as permissões atuais da área.
2. **Motor e integração:** correspondência por todos os termos, decisão por item,
   preparação compartilhada de valores e integração antes do agrupamento.
3. **Conferência:** persistência, contratos, contadores e conclusão sem linhas.
4. **Interface:** seção de exclusões em `frontend/src/pages/PerfisRegras/`, cliente
   em `frontend/src/api/`, hooks, tipos, chaves de cache e visualização dos resultados.
5. **Validação:** testes fiscais e de integração, lint/build do frontend e revisão
   dos totais e das fórmulas de uma saída representativa.

Referências da implementação existente: `app/services/pipeline_service.py`,
`app/services/pipeline_helpers.py`, `app/services/pipeline_outputs.py`,
`app/services/calculation/antecipacao_parcial.py`,
`app/services/rules_engine/descricao_matcher.py`,
`app/models/solicitacao.py` e `app/schemas/solicitacao.py`.

## 5. Critérios de aceite

| Cenário | Resultado esperado |
|---|---|
| Cada um dos sete NCMs com os termos aprovados | Excluído pelo motivo cadastrado |
| NCM correto e descrição incompatível, ou descrição correta e outro NCM | Sem exclusão por mercadoria |
| Mistura sem a palavra bolo | Sem correspondência com a regra inicial |
| Sal versus salgadinho, acentos e pontuação | Correspondência por palavras completas normalizadas |
| Mercadoria cadastrada, mesmo com IPI e imposto positivo | Excluída pela regra de mercadoria |
| Milho com A.dest 7% e A.origem 4% | Processamento normal, sem exclusão fixa |
| Alíquotas iguais e diferença positiva por IPI ou frete | Incluído |
| Alíquotas iguais e resultado final zero ou negativo | Excluído com valores na conferência |
| IPI positivo, mas resultado final zero | Excluído pela condição numérica |
| Alíquotas diferentes e resultado negativo | Comportamento anterior preservado |
| Ajuste de origem torna as alíquotas iguais | Comparação usa as alíquotas ajustadas |
| Nota com itens excluídos e mantidos na mesma alíquota | Somente os mantidos compõem as linhas e totais |
| Arredondamento por item e redução do Simples | Critério em centavos conforme o calculador existente |
| Todas as quatro modalidades; modo automático e legado | Mesma política no escopo configurado |
| Outro perfil/UF, regra inativa, DIFAL ou Tributária | Nova exclusão não se aplica fora do escopo |
| SPED C190 sem descrição confiável | Sem exclusão por mercadoria; aviso e granularidade explícitos |
| Todas as mercadorias legitimamente excluídas | Concluído sem linhas, com conferência acessível |
| Edição de termos e nova execução | Novos termos aplicados; histórico anterior explicável |
| Repetição da carga inicial | Sem duplicação ou sobrescrita das edições |
| Geração e regeneração de Excel | Fórmulas protegidas e resultados persistidos respeitados |

Executar os testes novos e as suítes relacionadas a Parcial, Simples, redução por
produto, CFOP, processamento multi-planilha, SPED e geração/regeneração de saídas.
Validar migração com dados existentes e executar `npm run lint` e `npm run build`
no frontend. A documentação de arquitetura exige testes fiscais e preservação de fórmulas.

## 6. Entrega deste planejamento

Este documento consolida as escolhas da entrevista e explicita as propostas
técnicas necessárias para implementá-las. Nenhuma alteração de cálculo, cadastro,
banco de dados ou geração de planilha foi executada nesta etapa.
