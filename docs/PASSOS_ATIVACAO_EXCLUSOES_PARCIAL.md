# Passos para ativar as exclusões da Parcial

## Objetivo

Atualizar o banco existente, configurar as exclusões no perfil correto para a
Bahia e validar o funcionamento da Parcial. Executar os três passos abaixo em ordem.

## Situação confirmada no banco

Consulta somente de leitura realizada em 15/09/2026 no PostgreSQL remoto
configurado pelo `.env` do projeto:

- Revisão aplicada: `013_exclusoes_parcial`.
- Tabela `regras_exclusao_parcial` existente, com **zero regras**.
- Coluna `chave_origem` **ausente**.
- Dois perfis existentes, IDs **1 e 2**.
- Nenhum desses perfis possui a política de alíquotas iguais configurada.
- Nenhum perfil usa o formato booleano antigo dessa política.

Reconsultar esse estado antes de executar, pois ele pode ter mudado. Utilizar as
credenciais configuradas no ambiente, sem imprimi-las em comandos, logs ou relatório.

## Passo 1 — Criar, testar e aplicar a migração incremental

### Implementação

1. Conferir o histórico de migrações atual.
2. Criar uma nova revisão após `013_exclusoes_parcial`, por exemplo
   `014_chave_origem_exclusoes_parcial`, caso essa numeração ainda esteja livre.
3. Acrescentar à tabela `regras_exclusao_parcial`:
   - `chave_origem`: `String(50)`, permitindo nulo.
   - Índice `ix_regras_exclusao_parcial_chave_origem`.
4. Tratar os dois estados possíveis da revisão 013:
   - **013 antiga:** coluna e índice ainda não existem; criá-los.
   - **013 atual executada em instalação nova:** coluna e índice já existem;
     avançar a revisão sem tentar criá-los novamente.
5. Preservar tabelas, registros, IDs e configurações existentes. Usar uma nova
   revisão; editar apenas a 013 não atualiza os bancos onde ela já foi executada.

### Validação e aplicação

- Testar a atualização de um banco isolado com a estrutura da 013 antiga e dados
  existentes, verificando preservação dos registros.
- Testar a atualização de um banco que já possui a coluna e o índice.
- Testar a instalação a partir das migrações atuais.
- Após os testes, aplicar a migração no PostgreSQL configurado para o projeto.
- Confirmar a revisão nova, a coluna e o índice no banco de destino.
- Confirmar que a listagem de regras e o carregamento das regras pelo pipeline
  funcionam com o banco atualizado.

Comandos de referência, executados na raiz do projeto e com o ambiente de destino
corretamente selecionado:

```powershell
./.venv/Scripts/python.exe -m alembic current
./.venv/Scripts/python.exe -m alembic upgrade head
./.venv/Scripts/python.exe -m alembic current
```

**Aceite:** o banco existente recebe a estrutura exigida pelo código e mantém
seus dados; instalações novas também conseguem avançar sem erro de coluna duplicada.

## Passo 2 — Configurar o perfil correto para BA

### Identificar o perfil

Identificar o perfil usado pelas empresas da Bahia que receberão a funcionalidade.
Há dois perfis no banco; a seleção do perfil alvo ainda não foi definida nesta
conversa. Usar os vínculos das empresas e o contexto disponível para identificá-lo.
Se isso não determinar o perfil, solicitar sua identificação antes de cadastrar
as regras. A configuração afeta todas as empresas desse perfil na UF correspondente.

### Carregar as sete exclusões

Usar a seção **Perfis e Regras → Exclusões da Parcial → Carregar Padrão (BA)**
ou o endpoint autenticado existente:

```http
POST /api/v1/regras-exclusao-parcial/carregar-padrao-ba
Content-Type: application/json

{"perfil_regras_id": <ID_DO_PERFIL_ALVO>}
```

O marcador acima precisa ser substituído pelo ID identificado.

| Mercadoria | NCM | Palavras obrigatórias na descrição | Motivo |
|---|---|---|---|
| Charque | `02102000` | charque | Imposto pago na entrada |
| Mistura para bolo | `19012090` | mistura **e** bolo | Imposto pago na entrada |
| Flocão de milho | `11041900` | flocão **e** milho | Isenção |
| Farinha de milho | `11022000` | farinha **e** milho | Isenção |
| Feijão | `07133399` | feijão | Isenção |
| Sal | `25010020` | sal | Isenção |
| Açúcar | `17019900` | açúcar | Imposto pago na entrada |

Conferir UF BA, perfil, situação ativa, termos e `chave_origem` das regras.
Os termos são editáveis posteriormente. Todas as palavras da linha são exigidas,
ignorando maiúsculas, acentos e pontuação, com correspondência de palavras completas.

O milho, NCM `10059010`, segue o cálculo normal e **não integra essa lista**.

### Ativar a condição numérica

Ativar **Condição Numérica de Alíquotas Iguais (BA)** no mesmo perfil.
A configuração deve conter:

```json
{
  "politica_aliquotas_iguais_parcial": {
    "BA": true
  }
}
```

Mesclar essa chave com `configuracoes_extras`, preservando as demais opções do
perfil e eventuais configurações de outras UFs.

**Aceite:** sete regras iniciais disponíveis no perfil alvo para BA; política
numérica ativa e reconhecida pelo motor. Repetir a carga não duplica regras nem
desfaz edições já realizadas.

## Passo 3 — Validar uma apuração e a planilha resultante

### Regras de negócio a preservar

- Aplicação nas quatro modalidades: Parcial, Parcial Simples Nacional, Parcial
  Paga Antecipadamente e Parcial Paga Antecipadamente Simples Nacional.
- Exclusão por NCM + descrição prevalece mesmo que exista IPI ou imposto positivo.
- Nos demais itens, se as alíquotas efetivamente aplicadas forem iguais, incluir
  apenas quando o imposto final em centavos for positivo.
- IPI, frete ou outra diferença entre as bases podem produzir esse valor positivo.
- Resultado zero ou negativo com alíquotas iguais fica fora, com registro na conferência.
- Alíquotas diferentes seguem o processamento existente.
- A exclusão ocorre por item, antes do agrupamento dos valores.

### Casos mínimos

Usar dados de teste controlados e uma nota representativa autorizada para a
validação operacional. Os exemplos numéricos abaixo testam o software; não são
novas definições de alíquotas para o cadastro fiscal real.

| Caso | Resultado esperado |
|---|---|
| Charque com NCM e descrição compatíveis, mesmo com IPI | Excluído por mercadoria |
| NCM de sal, descrição contendo apenas “salgadinho” | Sem exclusão pela palavra “sal” |
| Milho: total/base R$ 100, destino 7%, origem 4% | Incluído; R$ 3 no cálculo sem redução de Simples |
| Alíquotas iguais de 7%, total/base R$ 100 | Excluído; imposto zero |
| Alíquotas iguais de 7%, total R$ 110 e base R$ 100 | Incluído; R$ 0,70 sem redução de Simples |
| Alíquotas iguais de 7%, total R$ 100 e base R$ 110 | Excluído; R$ -0,70 registrado na conferência |
| Nota com mercadorias excluídas e mantidas | Totais compostos apenas pelos itens mantidos |
| Todos os itens legitimamente excluídos | Concluído com “Nenhum item a recolher na Parcial” |
| Item excluído junto com outro sem CFOP reconhecido ou com erro numérico | Diagnóstico de apuração incompleta; sem declarar ausência de imposto |

Conferir no Excel gerado os valores, as bases, as alíquotas e os totais. Verificar
preservação das fórmulas e conferir no resultado/histórico os motivos de exclusão,
valores negativos e campos “Não calculado”.

Executar os testes fiscais afetados e os testes de migração. Os scripts de revisão
estão em `.runtime-tmp/review-parcial/`, quando disponíveis. Se houver alteração
no frontend, executar `npm.cmd run lint` e `npm.cmd run build` em `frontend/`.

## Entrega esperada do agente executor

- Arquivo da nova migração e resultado dos testes.
- Confirmação da revisão aplicada, coluna e índice no PostgreSQL.
- ID/nome do perfil configurado e confirmação da política BA ativa.
- Confirmação das sete regras iniciais e ausência de duplicatas.
- Resultado da apuração de exemplo, com conferência da planilha.
- Resumo de qualquer pendência real que impeça finalizar.

A compatibilidade com políticas booleanas antigas não bloqueia este banco:
nenhum dos dois perfis consultados utiliza esse formato. Priorizar os três passos
acima para concluir a ativação no ambiente existente.

## Referências

- [Plano funcional completo](PLANO_EXCLUSOES_PARCIAL.md)
- [Terceira verificação e problema da migração existente](REVALIDACAO_EXCLUSOES_PARCIAL_3.md)
- Inspeção somente de leitura: `.runtime-tmp/review-parcial/check_database_state.py`

Este documento é uma orientação de execução. Sua criação não aplica migrações
nem altera os cadastros do banco.
