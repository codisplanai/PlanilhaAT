# Relatório da refatoração estrutural

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
- A autenticação em memória do MVP foi preservada; substituí-la por autenticação
  persistente exigiria uma mudança funcional separada.
- A persistência continua em SQLAlchemy/SQLite ou PostgreSQL. Não existia integração
  Supabase na base analisada e nenhuma dependência externa foi introduzida.

## Validação executada

- `python -m compileall -q app tests`: aprovado.
- `python -m pytest -q`: **85 testes aprovados**.
- `npm run lint`: aprovado sem erros.
- `npm run build`: aprovado com TypeScript e Vite.
- Bundle inicial reduzido de aproximadamente **561 kB para 258 kB** por divisão de rotas.

Os avisos restantes vêm de compatibilidade futura de bibliotecas (`datetime.utcnow` no
SQLAlchemy e atalho `app` do HTTPX). As versões foram limitadas em `requirements.txt` para
manter o comportamento atual; uma migração de timezone e transporte de testes deve ser
feita separadamente para não alterar contratos de datas nesta refatoração.
