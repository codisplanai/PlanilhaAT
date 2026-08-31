# Arquitetura do projeto

## Visão geral

O sistema é dividido em uma API FastAPI e uma aplicação React. A persistência atual usa
SQLAlchemy com SQLite ou PostgreSQL; não há cliente, schema ou integração com Supabase
nesta base. A autenticação existente é a sessão simples do MVP e continua isolada do
restante da navegação para permitir a troca futura do provedor sem afetar as páginas.

## Backend

```text
app/
├── api/
│   ├── endpoints/       # Transporte HTTP e validação da requisição
│   ├── persistence.py   # Operações CRUD transacionais compartilhadas
│   └── upload_utils.py  # Leitura e validação de uploads
├── core/                # Configuração, banco, exceções e dados iniciais
├── models/              # Entidades SQLAlchemy
├── schemas/             # Contratos Pydantic da API
├── services/
│   ├── calculation/     # Estratégias de cálculo por tipo de planilha
│   ├── excel/           # Preenchimento, formatação e proteção de fórmulas
│   ├── extraction/      # Extração de XML, SPED e datas de entrada
│   ├── rules_engine/    # Resolução das regras fiscais
│   ├── templates_admin/ # Versionamento dos templates
│   ├── validation/      # Validações de domínio
│   ├── pipeline_helpers.py
│   └── pipeline_service.py
└── constants.py         # Vocabulário compartilhado do domínio
```

As rotas coordenam HTTP e persistência. O pipeline coordena o caso de uso fiscal, enquanto
extração, cálculo, validação e Excel permanecem em serviços especializados. Constantes de
domínio não devem ser repetidas em schemas, rotas ou estratégias.

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
├── hooks/               # Sessão, queries e lógica reutilizável
├── lib/                 # Funções puras de apresentação
├── pages/               # Composição de cada rota
└── types/               # Contratos TypeScript da API
```

As páginas são carregadas sob demanda. Dados remotos passam pelos hooks de React Query e
pelas chaves centralizadas de cache. Estado de arquivos de entrada e estado de autenticação
ficam em hooks próprios; componentes de página concentram apenas a composição do fluxo.

## Regras de evolução

- Adicionar termos fiscais em `app/constants.py` e `frontend/src/constants/domain.ts`.
- Manter regras de negócio fora de endpoints e componentes React.
- Criar operações de rede em `frontend/src/api` e expô-las às páginas por hooks.
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
