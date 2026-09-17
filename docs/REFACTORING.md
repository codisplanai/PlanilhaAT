# Relatório da refatoração estrutural

## Rodada integral de 17/09/2026

O inventário atual cobriu os 220 arquivos Python/TypeScript de aplicação, migrações e
testes (30.239 linhas), configuração, dependências, integrações, rotas e artefatos. O
baseline foi confirmado com **275 testes aprovados e 1 ignorado**, lint sem erros e build
TypeScript/Vite aprovado.

Principais problemas remanescentes e tratamento aplicado:

- o pipeline ainda misturava pré-análise, transições transacionais e serialização de
  exclusões; essas responsabilidades foram isoladas em `pipeline_analysis.py`,
  `pipeline_lifecycle.py` e em um serializer puro de domínio;
- a configuração criava diretórios silenciosamente durante o import; a preparação do
  armazenamento agora ocorre explicitamente no lifespan e falha de forma observável;
- o cliente de Storage repetia construção e sanitização de URLs; essa fronteira foi
  centralizada em um único método;
- a tela de nova solicitação concentrava 1.059 linhas; stepper, seleção de empresa e
  período viraram componentes privados da feature, reduzindo a rota para cerca de 800 linhas;
- persistência da sessão, montagem de `FormData`, intervalos mensais e parsing de termos
  estavam duplicados ou misturados a hooks/componentes; agora são funções reutilizáveis;
- `Tabs` aceitava `any`; o componente agora preserva por generics o tipo real do identificador.

Nenhuma rota, payload, regra fiscal, fórmula, classe visual ou sequência de interação foi
alterada intencionalmente. A validação final repetiu toda a suíte, lint e build.

## Rodada integral de 02/09/2026

A base inteira foi inventariada antes da primeira alteração: configuração, migrations,
modelos, schemas, endpoints, serviços fiscais, autenticação/RBAC, integrações Supabase,
testes, cliente HTTP, tipos, hooks, componentes, páginas, rotas e build. O baseline foi
registrado com **137 testes aprovados e 1 ignorado**, além de lint e build do frontend.

### Problemas estruturais priorizados

| Prioridade | Problema confirmado | Risco de manutenção |
|---|---|---|
| Alta | `pipeline_service.py` acumulava extração, reconciliação XML/SPED, Storage, Excel, compensação e transação. | Alterações locais exigiam compreender quase todo o processamento e ampliavam o raio de falha. |
| Alta | Seis páginas React misturavam JSX, schemas, estado, queries, mutations e transformação de payload. | Duplicação de invalidações, arquivos extensos e regras difíceis de testar ou reutilizar. |
| Alta | Gravação, recuperação e exclusão de artefatos eram repetidas e nem sempre atômicas ou confinadas à pasta esperada. | Arquivos parciais e risco de remoção por caminho persistido indevidamente. |
| Média | Rotas eram enumeradas novamente para cada prefixo da API. | Alias `/v1` podia divergir de `/api/v1` ao adicionar endpoints. |
| Média | UFs, papéis, cargos, status, tipos de planilha e variantes de CFOP apareciam em mais de uma camada. | Contratos podiam divergir silenciosamente. |
| Média | Chaves de cache e tipos visuais dependiam de strings ou módulos de domínio dispersos. | Invalidações incompletas e acoplamento de primitivos de UI ao domínio. |

### Refatorações executadas

- O pipeline passou a delegar carregamento/deduplicação a `pipeline_sources.py` e geração,
  regeneração, backup e compensação de saídas a `pipeline_outputs.py`.
- Operações locais foram centralizadas em `local_files.py`, com escrita temporária no
  mesmo volume, promoção atômica e validação de que exclusões permaneçam na raiz esperada.
- Storage continua opcional; quando configurado, falhas preservam o comportamento
  transacional e a restauração coordenada entre banco, disco e Supabase.
- O catálogo de routers passou a ter uma única fonte para `/api/v1` e o alias `/v1`.
- UFs, papéis, cargo por papel, status e opções de domínio foram centralizados sem mudar os
  valores aceitos pelos contratos existentes.
- `Empresas`, `AdminTemplates`, `NovaSolicitacao`, `Historico`, `Usuarios` e
  `PerfisRegras` receberam hooks privados por feature. O JSX ficou responsável por
  apresentação; validação, fluxo, cache, mutations e payloads ficaram nos hooks.
- Chaves adicionais do React Query foram centralizadas e o CRUD de usuários deixou de
  manter uma segunda fonte manual de estado remoto.
- Os contratos TypeScript de papel e variantes de badge foram tornados explícitos; o
  `any` residual no fluxo de alteração de senha foi removido com narrowing seguro.

Nenhum endpoint, payload, fórmula, critério fiscal, rota, classe visual ou sequência de
interação foi intencionalmente alterado nesta rodada.

## Diagnóstico inicial

Os pontos de maior impacto encontrados na revisão integral foram:

1. vocabulário fiscal e rótulos repetidos entre schemas, serviços e páginas;
2. páginas React acumulando sessão, cache remoto, uploads, apresentação e regras de fluxo;
3. chamadas e invalidações do React Query repetidas em várias rotas;
4. operações CRUD e leitura de uploads repetidas nos endpoints FastAPI;
5. pipeline fiscal e preenchimento de Excel concentrando funções auxiliares demais;
6. tipos genéricos e defaults mutáveis em contratos Python e TypeScript;
7. todas as páginas incluídas no bundle inicial do frontend;
8. criação de tabelas como efeito colateral da importação da aplicação;
9. dependências incompatíveis com os padrões efetivamente usados no código;
10. ausência de documentação sobre as fronteiras entre UI, dados e negócio.

## Priorização aplicada

- **Alta:** contratos de domínio, pipeline fiscal, Excel, uploads, persistência e sessão.
- **Média:** cache de API, componentes compartilhados, tipagem e carregamento por rota.
- **Baixa:** limpeza de arquivos sem uso, organização dos utilitários e documentação.

## Alterações realizadas

### Backend

- Constantes fiscais centralizadas em `app/constants.py`.
- Operações transacionais comuns extraídas para `app/api/persistence.py`.
- Leitura e validação de XML/ZIP extraídas para `app/api/upload_utils.py`.
- Normalização, cruzamento e ordenação do pipeline movidos para
  `app/services/pipeline_helpers.py`.
- Seleção de aba, cabeçalho e coerção de valores Excel movidos para
  `app/services/excel/template_utils.py`.
- Defaults mutáveis substituídos por factories seguras nos modelos Pydantic.
- Tipos de parâmetros dos cálculos tornados explícitos e consistentes.
- Criação do schema movida do import para o evento de inicialização.
- Versões de FastAPI, Pydantic e HTTPX alinhadas ao código existente; suporte `.xls`
  declarado explicitamente com `xlrd`.

### Frontend

- Rotas convertidas para carregamento sob demanda com `React.lazy`.
- Sessão e persistência local isoladas em `useAuthSession`.
- Queries recorrentes e chaves de cache centralizadas em hooks e `queryKeys`.
- CRUDs homogêneos construídos sobre um cliente genérico tipado.
- Estado e validação de arquivos fiscais extraídos para `useFiscalInputFiles`.
- Estados, rótulos, UFs e variantes visuais centralizados por domínio.
- Badges de status/planilha e cabeçalhos de página transformados em componentes comuns.
- `any` removido dos contratos compartilhados e substituído por objetos JSON tipados.
- Formatadores puros movidos de `components` para `lib`.
- CSS não utilizado removido.

## Compatibilidade preservada

- Fórmulas, cálculos, cruzamentos XML/SPED e critérios fiscais não foram alterados.
- Rotas, payloads, mensagens de validação e códigos HTTP permanecem compatíveis.
- Layout, classes visuais e fluxo de navegação permanecem equivalentes.
- A autenticação Supabase e o fallback local restrito a desenvolvimento/testes foram
  preservados, assim como a autorização baseada nos perfis persistidos.
- A persistência continua em SQLAlchemy/SQLite ou PostgreSQL. Auth, Admin API e Storage do
  Supabase permanecem adaptadores opcionais; nenhuma dependência externa foi introduzida.

## Validação executada

- `python -m compileall -q app tests`: aprovado.
- `python -m pytest -q`: **140 testes aprovados e 1 ignorado**.
- `npm run lint`: aprovado sem erros.
- `npm run build`: aprovado com TypeScript e Vite.

Os avisos restantes vêm de compatibilidade futura de bibliotecas (`datetime.utcnow` no
SQLAlchemy e atalho `app` do HTTPX). As versões foram limitadas em `requirements.txt` para
manter o comportamento atual; uma migração de timezone e transporte de testes deve ser
feita separadamente para não alterar contratos de datas nesta refatoração.
