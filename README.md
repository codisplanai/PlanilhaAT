# Planilha AT — Backend de Automação Contábil (MVP)

> A organização atual das camadas e as regras de evolução estão descritas em
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
> O diagnóstico e as decisões desta refatoração estão em
> [`docs/REFACTORING.md`](docs/REFACTORING.md).

Backend de alta precisão desenvolvido em Python 3.12+ / FastAPI para automação contábil de escritórios que atendem centenas de empresas. Realiza a extração determinística de NF-e (XML), resolução hierárquica de alíquotas (A.DST), cálculo tributário e preenchimento de planilhas Excel (`.xlsx`) com **preservação estrita e inviolável de fórmulas originais**.

---

## 🚀 Tecnologias Utilizadas

- **Framework Web:** FastAPI
- **Servidor ASGI:** Uvicorn
- **Banco de Dados & ORM:** PostgreSQL / SQLite com SQLAlchemy 2.0 e Alembic
- **Manipulação de Planilhas:** `openpyxl` com camada guardiã de fórmulas (`FormulaGuard`)
- **Parsing Estruturado de NF-e:** `xml.etree.ElementTree` (Determinístico, sem dependência de IA/LLM)
- **Validação de Schemas e DTOs:** Pydantic
- **Testes Automatizados:** Pytest e HTTPX

---

## 🏛️ Arquitetura em Camadas (Implementação 1 a 9)

1. **Cadastro e Configuração (Camada 1)**:
   - Perfis de Regras compartilháveis entre as ~300 empresas.
   - Empresas com validação de CNPJ (Módulo 11 da Receita Federal) e UF.
   - Regras de Alíquotas de Destino configuráveis por Estado (Padrão) e Estado + NCM (Exceção) em campos chave-valor extensíveis (`JSONB`).

2. **Solicitação de Processamento (Camada 2)**:
   - Criação de requisições por empresa, período de competência e tipo de planilha (`antecipacao_parcial`, `antecipacao_tributaria`, `difal`).

3. **Entrada (Camada 3)**:
   - Upload de múltiplos arquivos XML de NF-e.
   - Validação imediata: `CNPJ destinatário no XML == CNPJ da Empresa solicitada`.

4. **Extração de Dados Determinística (Camada 4)**:
   - Extrai `vNF`, `vBC`, `vIPI`, despesas acessórias (`vFrete`, `vSeg`, `vOutro`), data de emissão, número da nota, NCM de cada item.
   - **A.ORI (Alíquota de Origem)**: Extraída diretamente da tag `<pICMS>` do XML (nunca calculada nem obtida de tabelas).

5. **Motor de Regras (Camada 5)**:
   - Resolve **apenas A.DST**: busca primeiro por `(Perfil, UF, NCM)`; se não encontrar, aplica o padrão estadual `(Perfil, UF, NCM=None)`.

6. **Motor de Cálculo Plugável (Camada 6)**:
   - **Antecipação Parcial**:
     $$\text{Débito} = \text{V.Total} \times \text{A.DST}$$
     $$\text{Crédito} = \text{Base de Cálculo} \times \text{A.ORI}$$
     $$\text{Valor Devido} = \text{Débito} - \text{Crédito}$$
   - **Antecipação Tributária & DIFAL**: Estruturadas em módulos independentes (`CalculationStrategy`) e substituíveis via `CalculatorFactory`.

7. **Validação e Sanidade (Camada 7)**:
   - Bloqueio de CNPJs inválidos, checagem de intervalo de datas contra o período da solicitação e validação de faixas de valores e alíquotas.

8. **Geração da Saída com Proteção de Fórmulas (Camada 8)**:
   - O `openpyxl` abre o template modelo com `data_only=False`.
   - `FormulaGuard`: Mapeia todas as fórmulas existentes antes da escrita, bloqueia qualquer escrita acidental em células contendo fórmulas e confere a integridade de 100% das fórmulas pós-escrita.
   - Totais e subtotais continuam sendo calculados nativamente pelo Excel (`=SUM(...)`, `=SUBTOTAL(...)`).

9. **Administração de Templates (Camada 9)**:
   - Rota restrita para upload de novos `.xlsx` para os 3 modelos.
   - Mapeamento explícito e obrigatório de coordenadas de colunas e linha inicial.
   - Versionamento rastreável com hash SHA-256 e promoção da versão ativa.

---

## 📂 Estrutura de Pastas

```text
planilha-at/
├── alembic/                      # Migrações do banco de dados
│   ├── env.py
│   └── versions/
│       └── 001_initial_schema.py
├── app/
│   ├── api/                      # Camada de rotas FastAPI
│   │   ├── router.py
│   │   └── endpoints/
│   │       ├── empresas.py
│   │       ├── perfis_regras.py
│   │       ├── regras_aliquotas.py
│   │       ├── solicitacoes.py
│   │       └── templates.py
│   ├── core/                     # Configurações, banco e exceções
│   │   ├── config.py
│   │   ├── database.py
│   │   └── exceptions.py
│   ├── models/                   # Modelos ORM SQLAlchemy
│   ├── schemas/                  # Schemas e validações Pydantic
│   └── services/                 # Regras de negócio desacopladas
│       ├── calculation/          # Motores de cálculo (Parcial, Tributária, DIFAL)
│       ├── excel/                # TemplateFiller e FormulaGuard
│       ├── extraction/           # Parser determinístico de XML NF-e
│       ├── rules_engine/         # Resolução hierárquica de A.DST
│       ├── templates_admin/      # Gerenciador e versionador de templates
│       ├── validation/           # SanityChecker
│       └── pipeline_service.py   # Orquestrador do fluxo ponta a ponta
├── storage/                      # Templates versionados e outputs gerados
├── tests/                        # Suite completa de testes unitários e de integração
├── requirements.txt
└── README.md
```

---

## 🛠️ Como Executar

### 1. Instalação das Dependências
```bash
pip install -r requirements.txt
```

### 2. Execução dos Testes Automatizados
```bash
pytest -v
```

### 3. Inicialização do Servidor API
```bash
uvicorn app.main:app --reload --port 8000
```
- **Documentação Swagger Interativa:** `http://localhost:8000/docs`
- **Documentação Redoc:** `http://localhost:8000/redoc`

---

## Deploy oficial: Docker + GHCR

A estratégia suportada de produção é **100% Dockerizada** e usa `develop` + `main` com SemVer:

1. PRs para `develop` executam somente validações estáticas: modelo do PR, sintaxe/indentação Python, lint/typecheck do frontend, Bash e `docker compose config`. **Não há Docker build nem release em PR.**
2. Push em `develop` executa a suíte completa de testes e, se passar, publica imagem GHCR de desenvolvimento. Não cria GitHub Release e não incrementa versão estável.
3. Release acontece exclusivamente por PR `develop -> main` com título `release(patch|minor|major): descrição`.
4. Ao fazer merge em `main`, o workflow calcula automaticamente a próxima versão SemVer, roda testes, constrói a imagem release, publica no GHCR, faz deploy por digest e cria a GitHub Release/tag `vX.Y.Z`.
5. A VPS recebe somente `compose.yaml` e `deploy/deploy.sh`; não executa `git pull`, `pip install`, `npm install` ou build.
6. Antes da troca da aplicação, o deploy executa `alembic upgrade head` em container one-shot.
7. O container sobe sem privilégios, com filesystem raiz read-only, volumes persistentes e healthcheck em `/api/health`.
8. CloudPanel/Nginx atua somente como reverse proxy/TLS para `127.0.0.1:8000`.
9. A manutenção automática remove caches efêmeros de PR com mais de 2 horas e versões GHCR de desenvolvimento/untagged antigas, preservando releases SemVer.

Exemplo de versionamento:

```text
1.0.0
1.0.1   # release(patch)
1.1.0   # release(minor)
1.1.1   # release(patch)
2.0.0   # release(major)
```

Arquivos principais:

- `Dockerfile`
- `compose.yaml`
- `.env.example`
- `.dockerignore`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/pr-validation.yml`
- `.github/workflows/develop-image.yml`
- `.github/workflows/release.yml`
- `.github/workflows/maintenance.yml`
- `deploy/deploy.sh`
- `deploy/bootstrap-vps.sh`
- `deploy/README.md`

Consulte `deploy/README.md` para branch strategy, modelo de PR, configuração do GHCR, secrets do GitHub Actions e bootstrap da VPS.
