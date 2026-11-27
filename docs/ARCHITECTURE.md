# Arquitetura do projeto

## Visão geral

O sistema é dividido em uma API FastAPI e uma aplicação React. A persistência usa
SQLAlchemy com SQLite ou PostgreSQL. Supabase é uma integração opcional e isolada:
Auth valida credenciais e tokens, Admin API gerencia contas e Storage replica templates
e planilhas. O banco continua acessado exclusivamente pelo SQLAlchemy; em desenvolvimento
e testes pode existir autenticação local explicitamente habilitada.

## Backend

```text
app/
├── api/
│   ├── endpoints/       # Transporte HTTP e validação da requisição
│   └── persistence.py   # Operações CRUD transacionais e consulta de recursos
├── core/                # Configuração, banco, exceções, segurança e seeds
├── models/              # Entidades SQLAlchemy
├── schemas/             # Contratos e validadores Pydantic da API
├── services/
│   ├── calculation/     # Estratégias de cálculo por tipo de planilha
│   ├── excel/           # Preenchimento, formatação e proteção de fórmulas
│   ├── extraction/      # Extração de XML, SPED e datas de entrada
│   ├── rules_engine/    # Resolução das regras fiscais
│   ├── templates_admin/ # Versionamento dos templates
│   ├── validation/      # Validações de domínio
│   ├── copia_regras.py  # Clonagem e cópia de perfis e regras entre perfis
│   ├── local_files.py   # Escrita atômica e resolução segura de artefatos
│   ├── meu_danfe.py     # Geração e consulta de DANFE em PDF
│   ├── pipeline_helpers.py
│   ├── pipeline_analysis.py # Pré-análise e decisões de destinação
│   ├── pipeline_lifecycle.py # Transações e estados da solicitação
│   ├── pipeline_sources.py  # Extração, reconciliação e deduplicação das fontes
│   ├── pipeline_outputs.py  # Geração, Storage e rollback de saídas
│   ├── pipeline_service.py  # Orquestração do caso de uso fiscal
│   ├── supabase_admin.py
│   └── supabase_storage.py
└── constants.py         # Vocabulário compartilhado do domínio
```

As rotas coordenam HTTP e persistência e são registradas uma única vez em `api/router.py`,
inclusive para o alias legado `/v1`. O pipeline principal mantém a transação e a sequência
fiscal; carregamento de fontes, geração/recuperação de arquivos, cálculo, validação e Excel
permanecem em serviços especializados. A pré-análise e as transições transacionais
do processamento ficam isoladas do orquestrador principal. Constantes de domínio não devem ser repetidas em
schemas, rotas ou estratégias.

## Frontend

```text
frontend/src/
├── api/                 # Cliente HTTP, recursos CRUD e chaves de cache
├── components/
│   ├── domain/          # Componentes que conhecem o vocabulário fiscal
│   ├── feedback/        # Estados de carregamento, erro e vazio
│   ├── layout/          # Estrutura visual compartilhada
│   └── ui/              # Primitivos visuais reutilizáveis
├── constants/           # Rótulos, estados e opções do domínio
├── hooks/               # Sessão, queries, timers e lógica reutilizável
├── lib/                 # Funções puras (formatação, DANFE, download, filtros) e motor fiscal local (`localProcessing/`)
├── pages/               # Composição de rota, modais/seções e hooks privados de cada feature
└── types/               # Contratos TypeScript da API
```

As páginas são carregadas sob demanda. Dados remotos passam pelos hooks de React Query e
pelas chaves centralizadas de cache. Páginas com formulários ou fluxos complexos possuem
um hook ao lado da própria rota (`use*Page.ts`), que concentra schemas, estado, queries,
mutações e efeitos. Estado de arquivos fiscais e autenticação ficam em hooks próprios;
os componentes de página concentram a composição e a apresentação. Etapas extensas de
assistentes devem ser componentes da própria feature; sessão persistida, montagem multipart,
períodos e parsing de entradas textuais ficam em utilitários puros compartilhados.

## Servidor MCP local

```text
mcp/
├── src/                 # Servidor MCP (stdio): ferramentas, cliente da API, orquestração da geração
├── test/                # node:test com API simulada
├── scripts/             # build da extensão .mcpb, e2e contra API local, suíte do motor no Node
└── manifest.base.json   # base do manifesto da extensão do Claude Desktop
```

O `mcp/` permite que um assistente de IA (Claude Desktop, Claude Code ou outro cliente MCP)
execute configurações fiscais e gere planilhas. Ele roda no computador do usuário, não no
servidor, e preserva as fronteiras acima:

- configurações e histórico passam pela API REST com o login do usuário, então valem as mesmas
  permissões do site;
- a geração importa o motor de `frontend/src/lib/localProcessing` (sem cópia) e lê XML, ZIP e
  SPED apenas em pastas liberadas pelo usuário; a API recebe somente o resultado estruturado em
  `/processamento-local/solicitacoes/{id}/resultado`, como no navegador;
- decisões de pré-análise (CT-e sem NF-e, uso e consumo, bonificação, Convênio 52/91, MVA) são
  devolvidas como pendências para o usuário responder; o servidor MCP não decide por ele.

Como o MCP depende do motor do frontend, mudanças em `frontend/src/lib/localProcessing` ou em
`frontend/src/types` devem rodar também `cd mcp && npm test && npm run test:motor && npm run typecheck`.
Detalhes de instalação e ferramentas em [`mcp/README.md`](../mcp/README.md).

## Regras de evolução

- Adicionar termos fiscais em `app/constants.py` e `frontend/src/constants/domain.ts`.
- Manter regras de negócio fora de endpoints e componentes React.
- Criar operações de rede em `frontend/src/api` e expô-las às páginas por hooks.
- Manter chaves e invalidações do React Query em `frontend/src/api/queryKeys.ts`.
- Gravar templates e outputs com as operações atômicas de `local_files.py`.
- Tratar Supabase como adaptador externo: nenhuma regra fiscal deve depender dele.
- Preservar a validação de fórmulas ao alterar qualquer fluxo de geração de Excel.
- Cobrir alterações fiscais com testes unitários e o pipeline com testes de integração.
- Não introduzir um segundo mecanismo de autenticação ou persistência sem uma migração
  explícita e compatível com os contratos atuais.

## Validação local

```powershell
# Backend
python -m pytest -q

# Frontend
cd frontend
npm run lint
npm run build
```
