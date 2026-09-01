# Auditoria técnica integral — 01/09/2026

## Resultado executivo

A revisão cobriu backend FastAPI/SQLAlchemy, frontend React, autenticação e RBAC,
Supabase, migrations, processamento fiscal, geração de Excel, uploads, armazenamento,
responsividade, acessibilidade, tratamento de erros, testes e configuração de deploy.

Os achados confirmados foram corrigidos no código e a revarredura automatizada está
verde. O código está em condição de *release candidate*, mas a publicação em produção
depende de duas validações operacionais que não devem ser automatizadas:

1. reconciliar e migrar o banco Supabase existente, que não possui `alembic_version` e
   contém tabelas antigas paralelas às tabelas usadas pela aplicação;
2. executar o smoke visual real em navegador desktop e mobile. A sessão de navegador
   integrada não estava disponível durante esta auditoria.

O procedimento não destrutivo do primeiro item está em
[`SUPABASE_RECONCILIATION.md`](./SUPABASE_RECONCILIATION.md).

## Achados e correções

### Autenticação, autorização e segurança

| # | Severidade | Problema, causa e impacto | Correção aplicada |
|---|---|---|---|
| 1 | Crítica | CRUDs de empresas, perfis e regras não exigiam autenticação. Qualquer cliente podia ler ou alterar configuração fiscal. | Sessão obrigatória em todas as rotas e mutações administrativas protegidas por `require_admin`. |
| 2 | Crítica | Qualquer Bearer token iniciado por `pat_` era aceito como administrador. Era um bypass completo de autenticação. | Tokens locais agora são aleatórios, registrados no servidor e rejeitados quando não constam da tabela ativa. |
| 3 | Crítica | Falha ou rejeição do Supabase caía silenciosamente em credenciais locais fixas, inclusive fora de desenvolvimento. | Fallback local exige `ENABLE_LOCAL_AUTH`, `DEBUG` e ambiente de desenvolvimento/teste; produção retorna 401/503 seguro. |
| 4 | Crítica | `user_metadata`, e-mail ou texto do cargo podiam elevar um usuário a administrador. Metadados editáveis não são fonte confiável de autorização. | Papel e estado ativo são sempre lidos de `profiles`; novo usuário Supabase nasce como `operador`; UI aceita apenas `role === 'admin'`. |
| 5 | Alta | Histórico, detalhe, processamento, download, edição de nota e exclusão não verificavam o proprietário da solicitação. Operadores podiam acessar dados de outros usuários por ID. | `usuario_id` é gravado na criação; todas as operações validam proprietário, enquanto admin conserva visão global. |
| 6 | Alta | Logout removia somente dados do navegador; o token local continuava válido. Perfis inativos também podiam permanecer em sessão. | Endpoint de logout revoga o token, `/auth/me` revalida o perfil e o frontend encerra a sessão ao receber 401. |
| 7 | Alta | Dados do React Query permaneciam no cache entre usuários. Um novo login no mesmo navegador podia ver dados do usuário anterior. | Cache limpo no logout, na perda de sessão e sempre que o usuário deixa de existir. |
| 8 | Alta | Operações privilegiadas do Storage aceitavam a chave anônima como fallback. | Escrita/exclusão em Storage só é considerada configurada com `SUPABASE_SERVICE_ROLE_KEY`. |
| 9 | Média | CORS permissivo e métodos/headers amplos aumentavam a superfície de requisições cruzadas. | Origens configuráveis, métodos e headers explícitos e credenciais desabilitadas quando houver wildcard. |
| 10 | Média | O handler global expunha SQL, caminhos e mensagens internas; respostas também serializavam caminhos físicos de arquivos. | Mensagem genérica fora de `DEBUG`, traceback apenas no log e schemas devolvendo somente o nome do arquivo. |
| 11 | Média | A aplicação não emitia cabeçalhos básicos contra MIME sniffing, clickjacking e permissões desnecessárias. | Inclusão de `nosniff`, `DENY`, política de referrer e bloqueio de câmera/microfone/geolocalização. |
| 12 | Média | Strings vindas de XML/SPED iniciadas por `=`, `+`, `-` ou `@` podiam ser interpretadas como fórmulas ao abrir o Excel. | Valores textuais potencialmente executáveis são escapados antes da escrita. |

### Banco de dados, migrations e integridade

| # | Severidade | Problema, causa e impacto | Correção aplicada |
|---|---|---|---|
| 13 | Crítica | A suíte substituía a sessão das rotas, mas startup e login ainda podiam alcançar o PostgreSQL/Supabase definido no `.env`. Rodar testes podia alterar dados externos. | Variáveis de teste são definidas antes de importar `app`; banco, auth e seeds ficam totalmente isolados em SQLite. |
| 14 | Crítica | `create_all()` e `ALTER TABLE` ad-hoc no startup mascaravam drift e criavam corridas entre instâncias serverless. | Auto criação ficou opt-in para desenvolvimento; produção usa exclusivamente a cadeia Alembic. |
| 15 | Alta | O Supabase existente tem dois esquemas concorrentes e não registra revisão Alembic. Aplicar `001` diretamente pode colidir com tabelas e dados reais. | Schema de instalação nova foi reconciliado, migração `009` criada e procedimento de baseline seguro documentado; nenhuma alteração destrutiva foi aplicada ao banco existente. |
| 16 | Alta | Regras globais com FK nula podiam duplicar porque `UNIQUE` trata `NULL` como valores distintos; também era possível ter mais de um template ativo do mesmo tipo. | Índices únicos normalizados com `COALESCE` e índice parcial para template ativo. |
| 17 | Alta | Status, papéis, período, alíquota e destino fiscal aceitavam valores inválidos no banco. | `CHECK` constraints nos modelos e na migração PostgreSQL, além de validação Pydantic. |
| 18 | Alta | Escritas concorrentes podiam gerar versões/regras duplicadas e terminar em 500 ou deixar arquivo órfão. | `IntegrityError` é convertido em conflito/validação de domínio, com rollback e limpeza local/nuvem. |
| 19 | Média | Exclusões de empresa/perfil podiam disparar cascatas destrutivas ou erros tardios de FK. | Operações com dependências agora retornam 409 e exigem resolução explícita. |
| 20 | Média | Updates parciais não distinguiam “campo ausente” de `null`, impedindo limpar campos opcionais de forma segura. | Uso de `__fields_set__` e validação específica para updates. |
| 21 | Média | Health check podia indicar serviço online com schema ausente. | Readiness consulta o banco e exige todas as tabelas, incluindo `alembic_version` quando o schema não é auto criado. |
| 22 | Baixa | `datetime.utcnow` gerava warnings e dificultava padronização temporal. | Relógio UTC centralizado em `app/core/time.py`, preservando o contrato atual de timestamps ingênuos. |

### Uploads, arquivos e armazenamento

| # | Severidade | Problema, causa e impacto | Correção aplicada |
|---|---|---|---|
| 23 | Crítica | Uploads não tinham limites por arquivo, por lote, número de entradas ou tamanho descompactado. Um ZIP bomb podia esgotar memória/disco. | Limites configuráveis, leitura limitada, contagem de entradas, razão de compressão e teto descompactado com resposta 413. |
| 24 | Alta | ZIP criptografado, arquivo vazio, extensão incorreta e conteúdo duplicado não eram tratados de forma consistente. | Rejeição explícita, allowlist por fluxo e deduplicação SHA-256 de XMLs. |
| 25 | Alta | Processamento síncrono pesado de XML/SPED/Excel rodava dentro da rota async e bloqueava o event loop. | Pipeline executado em threadpool após a leitura e validação dos uploads. |
| 26 | Alta | Templates e planilhas eram gravados diretamente no destino; falha no meio podia deixar arquivo truncado. | Escrita em arquivo temporário no mesmo volume e promoção atômica com `os.replace`. |
| 27 | Alta | Falhas de upload no Supabase eram ignoradas; banco e disco podiam apontar para objeto inexistente. | Falha de Storage aborta a transação, registra diagnóstico seguro e remove artefatos parciais. |
| 28 | Alta | Rollback do pipeline não removia todos os arquivos locais/nuvem já gerados. | Rastreamento de artefatos e compensação em erro; regeneração manual mantém backup e restaura a versão anterior. |
| 29 | Alta | Getter de template fazia `commit()` e persistia o caminho de fallback local, quebrando o rollback e destruindo a chave original do Storage. | Getter voltou a ser somente leitura e o fallback é resolvido em memória. |
| 30 | Média | Downloads em cold start falhavam quando o arquivo existia apenas no Storage; exclusão limpava somente o disco. | Recuperação atômica do Storage no download e remoção coordenada local/nuvem na exclusão. |
| 31 | Média | Exclusão física podia seguir caminho fora da pasta de outputs. | O alvo é resolvido e só é removido quando permanece dentro de `OUTPUTS_DIR`. |

### Extração fiscal, regras e Excel

| # | Severidade | Problema, causa e impacto | Correção aplicada |
|---|---|---|---|
| 32 | Crítica | XML/SPED sem data válida recebia a data atual. A apuração podia entrar na competência errada sem aviso. | Documento sem data obrigatória agora é rejeitado ou registrado como ignorado com motivo determinístico. |
| 33 | Crítica | Na NF-e com vários itens, a base total da nota podia ser atribuída ao primeiro item sem `vBC`. | Fallback usa somente valores do próprio item; o total da capa nunca é herdado arbitrariamente. |
| 34 | Crítica | Itens ST de NCM/CEST diferentes eram agrupados antes da resolução de MVA, podendo aplicar a margem errada ao grupo inteiro. | Agrupamento inclui NCM e CEST; resolver aceita CEST e rejeita ambiguidade em vez de escolher silenciosamente. |
| 35 | Alta | Fontes XML e SPED repetidas podiam duplicar a mesma nota no pipeline. | Identidades fiscais normalizadas e deduplicação antes da consolidação. |
| 36 | Alta | Planilha auxiliar aceitava formatos/colunas ambíguos e valores numéricos do Excel podiam virar chaves com `.0` ou notação científica. | Extensão e colunas obrigatórias validadas; chaves numéricas normalizadas antes do cruzamento. |
| 37 | Alta | Mapeamento declarava uma aba inexistente e o preenchimento caía silenciosamente na aba ativa. | Aba explícita inexistente gera erro; seleção automática mantém fallback somente quando não há declaração. |
| 38 | Alta | Recuperação do mês dependia da ausência do ano e podia escolher a aba errada. | Mês e ano são resolvidos independentemente a partir da competência/dados. |
| 39 | Alta | Erros de cabeçalho Excel eram silenciados; mapeamentos aceitavam coluna/célula inválida ou opções desconhecidas. | Contrato estrito de mapeamento, limites reais do Excel e mensagens de domínio sem detalhes internos. |
| 40 | Alta | Atualização manual da data de entrada alterava o banco sem regenerar de forma transacional as planilhas. | Regeneração de todas as saídas com backup, upload e rollback compensatório. |
| 41 | Média | Arquivo de trabalho podia ficar aberto ou parcialmente substituído após exceção do `openpyxl`. | `try/finally`, fechamento garantido e salvamento atômico. |
| 42 | Média | Solicitação podia ser processada duas vezes em concorrência. | Transição condicional para `processando`; a segunda execução é recusada. |

### Frontend, estado, UX, responsividade e acessibilidade

| # | Severidade | Problema, causa e impacto | Correção aplicada |
|---|---|---|---|
| 43 | Alta | Sidebar fixa ocupava a tela em larguras pequenas e não havia navegação mobile utilizável. | Drawer responsivo com overlay, botão de menu, fechamento por navegação e área principal adaptativa. |
| 44 | Alta | Erros de queries eram convertidos em arrays vazios; indisponibilidade da API parecia “sem dados”. | Dashboard, histórico e nova solicitação mostram `ErrorAlert` com o erro real. |
| 45 | Alta | Busca de empresa comparava qualquer termo com CNPJ vazio; texto não numérico podia casar com todas as empresas. | Busca por CNPJ só ocorre quando há dígitos e empresas inativas são excluídas do novo processamento. |
| 46 | Alta | Criar/processar solicitação não invalidava o cache do histórico. | Invalidação explícita de `solicitacoes` após o fluxo bem-sucedido. |
| 47 | Alta | Origem SPED/XML da data de entrada era rotulada como “Manual”. | Tipo e formatador cobrem `planilha_sistema_contabil`, `sped_fiscal`, `xml_nfe` e `manual`. |
| 48 | Alta | Sessão armazenada localmente era aceita sem revalidação no carregamento. | Bootstrap chama `/auth/me`; token expirado limpa sessão e redireciona ao login. |
| 49 | Média | Requests não tinham timeout e 401 fora do login não encerrava a sessão. | Timeout de 30 s e interceptor global de não autorizado. |
| 50 | Média | Downloads ignoravam o nome enviado pelo servidor e revogavam a URL imediatamente, com risco de falha em alguns navegadores. | `Content-Disposition` respeitado e revogação adiada para o próximo ciclo. |
| 51 | Média | Upload usava `alert`, aceitava MIME como substituto da extensão, não permitia escolher o mesmo arquivo novamente e tinha chaves instáveis. | Erro inline, extensão explícita, reset do input, deduplicação estável e limites espelhados no cliente. |
| 52 | Média | Período final anterior ao inicial só falhava tarde no backend. | Validação imediata no formulário e constraint no banco. |
| 53 | Média | Dropzones, botões de remoção, erros, loading, inputs e selects tinham semântica insuficiente para teclado/leitor de tela. | `role`, `aria-live`, `aria-invalid`, descrições associadas, labels e acionamento por Enter/Espaço. |
| 54 | Média | Modal não gerenciava Escape, foco, scroll do body nem restauração do elemento ativo. | Dialog modal acessível, foco inicial/restaurado, Escape e bloqueio de scroll com suporte a modais aninhados. |
| 55 | Média | Credencial demo aparecia no login e sugeria senha padrão em qualquer build. | Preenchimento demo exige build DEV e flag `VITE_ENABLE_DEMO_LOGIN=true`. |
| 56 | Baixa | Fluxos de mutation podiam gerar rejeições não tratadas mesmo quando `onError` atualizava a interface. | `mutateAsync` envolvido em tratamento local sem duplicar mensagens. |
| 57 | Baixa | Identidade visual ainda usava artefatos do Vite e nomenclatura inconsistente. | Marca PlanAut/Codisplan, favicon, títulos, login, sidebar e dashboard unificados sem alterar o fluxo funcional. |

### Infraestrutura e operação

| # | Severidade | Problema, causa e impacto | Correção aplicada |
|---|---|---|---|
| 58 | Alta | Rewrites da Vercel tratavam fallback e filesystem em ordem incompatível, podendo devolver 404 ou encaminhar assets incorretamente. | Rotas de API, assets, favicon e fallback SPA foram separadas e ordenadas. |
| 59 | Média | Respostas grandes de histórico/JSON não eram comprimidas e a listagem usava o schema detalhado com coleções aninhadas. | GZip e DTO enxuto para listagem; detalhe continua disponível sob demanda. |
| 60 | Média | Configuração segura não estava documentada e `.env.example` era ignorado pelo padrão `.env*`. | Exemplo versionável com flags, limites, CORS, banco e chaves sem segredos reais. |

## Validação executada

- Backend: `98 passed, 1 skipped`.
- Frontend: `npm run build` aprovado.
- Frontend: `npm run lint` aprovado sem warnings.
- Dependências: auditoria npm sem vulnerabilidades conhecidas no conjunto instalado.
- Migrações: `alembic upgrade head`, confirmação de `009_integrity_constraints` e
  `alembic downgrade base` aprovados em SQLite descartável.
- Integridade do patch: `git diff --check` aprovado.
- Smoke HTTP isolado: health, login, `/auth/me`, empresas, perfis, alíquotas, CFOP,
  templates, solicitações e logout aprovados (`200/204`).
- Build Vite produziu os chunks de todas as rotas sem erro de TypeScript.

## Pendências operacionais antes de produção

1. Fazer backup restaurável do Supabase e executar a reconciliação descrita no documento
   específico. O processo antigo observado na porta 8000 retornou `503` com
   “Banco de dados não está migrado”, comportamento correto do novo health check.
2. Após validar os dados legados, aplicar o baseline e `upgrade head` no ambiente certo.
3. Rodar smoke visual autenticado em 360 px, 768 px, 1440 px e modo teclado, incluindo
   login, drawer, CRUDs, uploads, modais, histórico e download.
4. Publicar somente depois desses dois gates e executar smoke pós-deploy contra o domínio
   real e os buckets reais do Supabase.

