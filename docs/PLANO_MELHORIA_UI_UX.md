# Plano de implementação de melhorias de UI/UX — PlanAut

Data da análise: 14/09/2026. Base de referência: commit `88833d6`.

Status: **planejamento, sem implementação de alterações na aplicação**. Este documento é a entrega solicitada em `/docs` e reúne diagnóstico, decisões de design, tarefas, dependências e critérios de aceite.

## 1. Objetivo e limites

Elevar a clareza, a legibilidade e o acabamento do PlanAut preservando sua identidade: navegação em azul-marinho, superfícies claras, ações azuis, identidade PlanAut em ciano/esmeralda e marca institucional Codisplan. A percepção de qualidade deve vir de hierarquia, precisão de alinhamento, consistência e feedback confiável.

A implementação futura abrangerá todas as oito páginas, os componentes compartilhados, as seções de regras, os formulários, os quinze pontos de uso de modais e as treze tabelas identificadas no frontend.

Limites obrigatórios:

- Preservar rotas, funcionalidades, permissões, filtros existentes, dados apresentados e ações disponíveis para cada papel autorizado.
- Preservar payloads, nomes de campos, normalização numérica, chaves de cache, autenticação e critérios de autorização do servidor.
- Preservar cálculos, precedência fiscal, CFOP, NCM, cruzamento XML/SPED, Simples Nacional, datas, geração e regeneração de arquivos e proteção de fórmulas.
- Não alterar arquivos `.xlsx`, banco, migrações, integrações Supabase ou serviços fiscais neste projeto de interface.
- Não acrescentar novas funcionalidades de negócio, como recuperação de senha, edição de regras ainda não exposta na UI, novos filtros, exportações adicionais, notificações externas ou processamento em segundo plano.
- Evitar novas dependências de runtime. Reaproveitar React, Tailwind, Lucide, React Query, React Hook Form e Zod já presentes.

Antecipar uma validação já existente, tornar uma ação acessível por teclado, apresentar corretamente um estado ou reorganizar a mesma informação são melhorias previstas de interação. Alterar valores aceitos, critérios fiscais ou o efeito de uma operação permanece fora do escopo.

## 2. Análise realizada e limites da evidência

### 2.1 Cobertura

Foram lidos os arquivos das oito páginas e seus hooks, as duas subseções de regras e seus hooks, todos os componentes compartilhados de layout, UI, autenticação e feedback, as rotas, a sessão, os clientes de API, o vocabulário de domínio, os formatadores e a configuração de estilos. A análise também cruzou os fluxos com endpoints, schemas, autorização, trechos do pipeline de geração e testes existentes relacionados a permissões, histórico e saídas fiscais.

A arquitetura de referência está em [ARCHITECTURE.md](ARCHITECTURE.md). A separação entre composição visual, hooks de página, clientes HTTP e serviços deve ser mantida.

O frontend utiliza React/TypeScript, React Router e Tailwind 4 integrado ao Vite. As páginas são carregadas sob demanda. O backend FastAPI expõe os recursos em `/api/v1`, com alias legado `/v1`. SQLAlchemy é responsável pela persistência; Supabase é um adaptador de autenticação, administração e armazenamento.

### 2.2 Verificações executadas

| Verificação | Resultado nesta análise |
| --- | --- |
| Estado inicial do Git | Sem alterações de trabalho listadas; houve aviso de leitura do arquivo global de ignore |
| Instruções locais `AGENTS.md` | Nenhum arquivo encontrado na árvore pesquisada do projeto |
| `npm.cmd run lint` em `frontend` | Concluído; três avisos de `no-extra-boolean-cast` em `PerfisRegras/index.tsx`, linhas 200, 219 e 226; nenhum erro reportado |
| `node.exe node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false` | Aprovado |
| Inicialização local do Vite | Servidor iniciou em `127.0.0.1:3000` |
| CSS processado pelo Vite | HTTP 200; ausência de `prefers-reduced-motion` e de `--color-brand-600` na resposta inspecionada |
| Inspeção por navegador conectado | Indisponível: a ferramenta informou que não havia navegador disponível |
| Build de produção, testes backend e testes de interação | Não executados nesta entrega documental |

O comando `npm` inicialmente encontrou a política de execução do PowerShell; `npm.cmd` permitiu executar a verificação sem mudar configurações do sistema.

**Limite da análise:** os achados abaixo são confirmados no código ou identificados como riscos de apresentação. Não foram capturadas telas, medidas cores computadas no navegador nem realizados testes com usuários. A avaliação visual autenticada em desktop e mobile é a primeira etapa obrigatória da execução futura, antes de modificar a UI. Não se considera concluída uma auditoria visual ou uma certificação de acessibilidade com base somente nesta análise estática.

### 2.3 Inventário de telas e fluxos

| Rota / superfície | Conteúdo e interações a preservar |
| --- | --- |
| `/login` | Identidade institucional, e-mail, senha, revelar senha, validação e autenticação |
| `/` | Indicadores de solicitações, empresas, modelos e erros; oito solicitações recentes; acesso à geração, empresas, histórico e download |
| `/nova-solicitacao` | Empresa → período → XML/ZIP/SPED/planilha auxiliar → revisão, processamento, resultado, avisos, conferência e downloads |
| `/solicitacoes` | Filtros de empresa e status; consulta, download, detalhes, notas ignoradas, totais, edição manual de data de entrada e exclusão |
| `/empresas` | Busca e filtro por UF; cadastro/edição, perfil fiscal, CNPJ, I.E., UF, atividade, Simples Nacional e termo de acordo |
| `/perfis-regras` | Seleção e manutenção de perfis; limitação de A.ORI; alíquota estadual, exceção NCM, redução por produto, exceções de descrição, roteamento CFOP e reclassificação |
| `/templates` | Administração de seis tipos de modelo; versões, mapeamento, upload e promoção de versão ativa |
| `/usuarios` | Cadastro de contas, papel/cargo, ativação/desativação e identificação da conta atual |
| Layout e conta | Navegação desktop/mobile, grupos operacional/administrativo, identificação do usuário, alteração de senha e saída |

### 2.4 Permissões que a apresentação deve refletir

| Operação | Operador | Administrador |
| --- | --- | --- |
| Consultar, criar e editar empresas/perfis/regras pelos fluxos já expostos | Permitido | Permitido |
| Definir/editar termo de acordo e cadastrar exceções de produto | Permitido | Permitido |
| Excluir empresas, perfis, regras, termos e exceções de produto | Bloqueado pela API | Permitido, respeitando as validações existentes |
| Consultar, baixar, editar data e excluir solicitações | Somente suas próprias solicitações | Todas as solicitações |
| Consultar dados de modelos utilizados pela operação | Permitido pelos endpoints de consulta | Permitido |
| Administrar modelos e usuários | Bloqueado | Permitido |
| Desativar a própria conta | Não aplicável à tela administrativa | Bloqueado |

Referências: `app/api/endpoints`, especialmente `solicitacoes.py`, e [test_permissoes_operador.py](../tests/test_permissoes_operador.py), [test_supabase_rbac_history.py](../tests/test_supabase_rbac_history.py). A UI deve explicar ações indisponíveis sem substituir a autorização do servidor. Não restringir todo o módulo de regras ao administrador: o operador possui permissões reais de cadastro e edição.

## 3. Diagnóstico da experiência atual

### 3.1 Pontos fortes a preservar

- Identidade consistente de marca, sidebar escura, cards claros e iconografia Lucide.
- Estrutura de rotas pequena e reconhecível, com ação de geração destacada.
- Assistente de quatro etapas e revisão antes do processamento.
- Componentes existentes para cabeçalho, botão, campo, seleção, modal, badge, erro, loading e vazio.
- `Input` e `Select` compartilhados já associam rótulos, ajuda e erros aos campos.
- `Modal` já usa portal, título acessível, foco inicial, retorno de foco e tratamento de teclado. A melhoria deve corrigir suas lacunas, preservando esses recursos.
- Tabelas usam valores monetários alinhados à direita e vários campos numéricos já utilizam números tabulares.
- Vocabulário de tipos, status e origem de datas centralizado; estados fiscais e motivos de descarte estão disponíveis.
- Lazy loading por página e cache de consultas já implementados.

### 3.2 Revisão dos aspectos obrigatórios

| Aspecto | Diagnóstico | Direção de melhoria |
| --- | --- | --- |
| Estrutura visual e composição | Há uma base consistente, mas banners, gradientes, bordas e selos competem em áreas operacionais | Concentrar destaque na ação e no estado mais importantes |
| Hierarquia da informação | Títulos de página compactos; descrições extensas; etapas e informações fiscais com peso semelhante | Separar título, instrução, contexto, ação e detalhe técnico |
| Consistência de componentes | Primitivos compartilhados convivem com inputs, selects, botões e avisos montados diretamente nas páginas | Migrar recorrências para a base existente com variantes explícitas |
| Layouts de páginas | Cards recebem padding externo adicional; regras usam 4/12 para seleção e 8/12 para tabelas densas | Definir padding único e reservar mais largura útil para trabalho fiscal |
| Espaçamentos e alinhamentos | Margens negativas compensam o padding interno de cards; rodapés de formulários variam | Escala comum e slots próprios para corpo, tabela e ações |
| Tipografia e legibilidade | Uso recorrente de 9–12 px, caixa alta e pesos fortes em metadados e ações | Corpo de 14–16 px e hierarquia com menos pesos; metadados legíveis |
| Cores e contraste | `text-slate-400` aparece sobre superfícies claras; identidade de status e cores de ação se misturam | Medir contraste real e adotar tokens semânticos |
| Botões e interativos | Há ações de 20–32 px, controles só com ícone e seleção por `div` clicável | Alvos maiores, nomes acessíveis e semântica nativa |
| Navegação | O menu mobile sai da tela por transformação; falta gestão de foco e inatividade quando fechado | Drawer acessível, foco previsível e contexto de página |
| Loading, empty, error e success | Cobertura desigual entre páginas e subseções; alguns erros ficam sob o modal | Estado por região, mensagens no local da ação e resultados verdadeiros |
| Responsividade desktop/mobile | Existem breakpoints e rolagem de tabelas, mas formulários e ações ainda têm combinações rígidas | Refluxo do conteúdo, uma coluna em telas estreitas e tabelas com rolagem delimitada |
| Feedback visual | Parte das falhas usa `alert`; sucesso frequentemente é apenas fechamento do modal | Confirmação discreta, erro persistente e loading por operação |
| Microinterações | Fade, escala, rotação, ping e pulse já existem; não há redução de movimento | Reduzir movimentos redundantes e respeitar preferências do usuário |
| Usabilidade geral | Recursos existem, mas há ações proibidas visíveis, nomes ambíguos e instruções técnicas | Alinhar texto, permissão, ação e consequência |
| Clareza dos formulários | Parte dos campos não tem label associado; percentuais e limites de arquivo têm instruções heterogêneas | Ajuda próxima ao campo e validação no momento oportuno |
| Organização de conteúdo | Regras reúnem muitos níveis; versões exibem todo o mapeamento em cada card | Agrupar por tarefa e oferecer detalhe progressivo sem retirar informações |
| Densidade visual | Convive espaço interno excessivo com tabelas e controles muito pequenos | Diminuir espaço estrutural redundante e aumentar o espaço útil dos dados |

### 3.3 Achados prioritários com evidências

Prioridades: **P0** — bloqueio de acesso ou feedback capaz de induzir ação incorreta; **P1** — fricção frequente, legibilidade e consistência; **P2** — refinamento visual e manutenção. São prioridades de implementação da interface, não uma classificação de incidentes de produção.

| ID | Prioridade | Evidência no código e impacto |
| --- | --- | --- |
| UX-01 | P0 | `NovaSolicitacao/index.tsx:193` seleciona empresa com `div onClick`; o seletor de perfis repete o padrão. A operação não tem suporte equivalente de teclado |
| UX-02 | P0 | `Modal.tsx:56` instala um listener global por instância. Não há controle do modal superior; o histórico abre edição/exclusão sobre detalhes. Escape pode acionar vários fechamentos e os ciclos de Tab podem competir |
| UX-03 | P0 | `Sidebar.tsx` usa apenas transformação para ocultar o menu mobile. Seus links continuam montados e não são tornados inertes; faltam ciclo de foco e fechamento por Escape |
| UX-04 | P0 | `ReducaoProdutoSection.tsx:98` e `ReclassificacaoCfopSection.tsx:120` exibem falhas de mutation no card da página, enquanto o formulário permanece no modal. O erro pode ficar encoberto |
| UX-05 | P0 | `usePerfisRegrasPage.ts:312` expõe loading, mas não os erros das queries de alíquotas/CFOP. Reduções e reclassificações verificam apenas `regras.data`; falha ou carregamento podem parecer ausência de cadastro |
| UX-06 | P0 | A falha do switch de A.ORI alimenta `errorMessage`, renderizado nos modais, sem alerta junto ao switch. A mudança pode parecer sem resposta |
| UX-07 | P1 | `Card.tsx:41` aplica `p-5` no corpo; dashboard, filtros e assistente adicionam padding no contêiner. No assistente, `p-6` mais `p-5` representam aproximadamente 44 px por lado antes das margens de página, na escala padrão |
| UX-08 | P1 | `Button.tsx:42` define 32/38/44 px de altura mínima; várias ações com ícones usam áreas ainda menores. Inputs compartilhados usam 12 px no mobile |
| UX-09 | P1 | `Login/index.tsx:275` e os três reveladores em `AlterarSenhaModal.tsx` têm `tabIndex={-1}`. Filtros, datas e alguns ícones não possuem rótulos explicitamente associados |
| UX-10 | P1 | `NovaSolicitacao/index.tsx:324` avança no período sem validar; `useNovaSolicitacaoPage.ts` só verifica o intervalo em `generateSpreadsheet`. O usuário pode descobrir o erro depois de anexar arquivos |
| UX-11 | P1 | `REQUEST_STEPS` chama a quarta etapa de “Resultado”, mas ela contém revisão e envio; os nomes das etapas ficam ocultos abaixo de `sm` |
| UX-12 | P1 | `useFiscalInputFiles.ts` aceita 20 MB por arquivo e 100 MB no conjunto XML/ZIP, mas as zonas de upload não apresentam esses limites. O backend também contabiliza SPED e planilha auxiliar e valida conteúdo expandido de ZIP |
| UX-13 | P0 | `NovaSolicitacao/index.tsx:701` anuncia sucesso geral mesmo quando existem saídas sem arquivo e com aviso por falta de modelo. O processamento parcial precisa ser distinguido visualmente do sucesso completo |
| UX-14 | P1 | Dashboard/histórico anunciam `.xlsx`; `api/solicitacoes.ts` e o endpoint de download também suportam `.zip`. A lista de solicitações não retorna `saidas`, portanto não permite inferir sempre a extensão antes do download |
| UX-15 | P1 | Exclusões de cadastros aparecem para operadores; os endpoints exigem `require_admin`. O usuário descobre a indisponibilidade somente após tentar |
| UX-16 | P1 | Exclusões variam entre `confirm`, modal e execução direta; downloads e várias mutations usam `alert`. Falta padrão de feedback e prevenção de repetição |
| UX-17 | P1 | `useUsuariosPage.ts` não expõe loading da lista nem pending por conta; a tabela não possui estado vazio dedicado e o controle de ativação não sinaliza a operação em curso |
| UX-18 | P1 | `Dashboard/index.tsx:155` usa denominador fixo `/4`, enquanto `TIPOS_PLANILHA_OPTIONS` possui seis tipos. KPIs podem mostrar zero ou vazio quando a consulta falha, apesar do alerta geral |
| UX-19 | P1 | `AdminTemplates` e `PerfisRegras` implementam abas como botões sem relações de tab/panel. As seis abas de modelo têm nomes longos |
| UX-20 | P1 | O detalhamento do histórico tem doze colunas dentro de modal, além de regiões próprias de rolagem. O resultado usa badges longos e `whitespace-nowrap`, com risco de overflow em cards estreitos |
| UX-21 | P1 | `useAdminTemplatesPage.ts:176` compartilha `isPromoting` entre todas as versões; todos os botões podem parecer estar ativando. O tipo pode ser alterado no formulário, mas os defaults são definidos apenas na abertura |
| UX-22 | P2 | `index.css` define movimentos sem `prefers-reduced-motion`; `LoadingSpinner` combina spin, ping e pulse. Cards informativos do dashboard usam hover com deslocamento |
| UX-23 | P2 | `tailwind.config.js` declara `brand/sidebar`, mas não é referenciado por `@config`; o CSS servido não contém o token `brand` inspecionado. Existem duas fontes aparentes de tema |
| UX-24 | P2 | `frontend/index.html` carrega fontes e os logos também incluem imports em SVG. Convém consolidar carregamento preservando a tipografia da marca e validar comportamento sem rede |
| UX-25 | P1 | Há textos voltados à implementação (“Camada de Sanidade do backend”) e mensagens divergentes (“bloqueadas” versus notas desconsideradas). “Total Notas” também representa soma monetária no histórico |
| UX-26 | P1 | O `Suspense` de `App.tsx` envolve toda a árvore de rotas; um carregamento pode substituir também o shell. Não há tratamento visual específico de erro de renderização/chunk |

Os riscos de contraste, truncamento, overflow, altura com teclado virtual e estabilidade de layout precisam ser medidos no navegador. Não se deve tratar a presença de uma classe de cor isolada como prova de reprovação de contraste.

## 4. Direção de design e padrões compartilhados

### 4.1 Fundação visual

Concentrar tokens em `frontend/src/index.css`, usando a integração Tailwind 4 existente. O arquivo JavaScript legado só deve ser ajustado ou removido após confirmar seus consumidores; não ativá-lo automaticamente, pois isso poderia mudar a paleta da aplicação. A documentação do [Tailwind sobre configuração JavaScript no v4](https://tailwindcss.com/docs/upgrade-guide#using-a-javascript-config-file) confirma que esse arquivo não é detectado automaticamente.

| Fundação | Especificação inicial |
| --- | --- |
| Fundo e superfícies | Fundo `#F8FAFC`, superfície `#FFFFFF`, superfície secundária `#F1F5F9`, sidebar `#0F172A` |
| Texto | Principal `#0F172A`, secundário `#475569`, apoio `#64748B`; revisar combinações reais e transparências |
| Marca e ação | Azul `#1D4ED8` / hover `#1E40AF`; manter gradiente ciano/esmeralda nos logos e em poucos pontos institucionais |
| Estados | Verde para conclusão, âmbar para atenção, vermelho/rosa para erro/exclusão e azul para informação. Sempre acrescentar texto ou ícone significativo |
| Espaçamento | Escala 4, 8, 12, 16, 20, 24 e 32 px; 16 px de margem mobile, 24 px tablet e 32 px desktop |
| Tipografia | Inter para interface; JetBrains Mono apenas onde favoreça comparação de códigos/valores. Corpo 14–16 px, metadados 12–13 px, títulos de seção 16–18 px, página 24–28 px |
| Campos | Fonte de 16 px em telas pequenas, altura de 44 px e entrelinha confortável; labels em caixa normal e peso 500/600 |
| Botões | Padrão 40 px desktop e 44 px em interação touch; ação principal 44–48 px. Ícones com área interativa independente do desenho |
| Bordas e elevação | Raios de 8 px em controles, 12 px em cards e 16 px em modais; uma sombra discreta por superfície |
| Larguras | Manter `max-w-7xl` como referência do shell e largura focada do assistente; retirar padding duplicado antes de ampliar contêineres |

Os valores são uma especificação inicial, a validar nas capturas do baseline. Não impor tamanhos por substituição global de classes: tabelas, formulários e sidebar exigem revisão de composição.

### 4.2 Componentes a evoluir

| Componente | Implementação prevista | Critério de aceite |
| --- | --- | --- |
| `Button` / `IconButton` | Variantes explícitas de ação, loading com `aria-busy`, dimensões comuns e rótulo acessível; evitar overrides que mantenham o gradiente de outra variante | Uma mesma intenção tem o mesmo estilo; pending bloqueia repetição sem deslocar o botão |
| `Input`, `Select`, `PasswordInput` | Reaproveitar associação já existente de label/erro; incluir required/opcional, disabled/read-only, autocomplete e ajuda; revelador de senha acessível | Todos os campos têm nome, instrução e erro perceptíveis; payloads e refs do formulário preservados |
| `Card` | Adicionar controle explícito do padding do corpo e modo de conteúdo sem padding para tabelas; manter default compatível durante migração | Nenhum consumidor depende de padding externo duplicado ou margem negativa compensatória |
| `PageHeader` | Hierarquia comum, títulos mais curtos, descrição legível e ações que quebram linha no mobile | Mesmo alinhamento de início entre cabeçalho, filtros e conteúdo |
| `Modal` / `ConfirmDialog` | Pilha de overlays, apenas o superior recebe teclado; fundo inerte, retorno de foco, rolagem do contêiner correto, rodapé previsível e estado pending | Escape fecha somente o overlay superior; foco permanece nele; cancelar não envia mutation |
| `Tabs` | Usar em modelos e CFOP com seleção, relação tab/panel e navegação por teclado | Todas as opções acessíveis por teclado e toque, sem depender de arrastar a faixa horizontal |
| `DataTable` / contêiner de tabela | Cabeçalho semântico, `scope`, legenda acessível, colunas numéricas, região de scroll e mensagens padronizadas | Rolagem horizontal restrita à tabela; todas as informações e ações preservadas |
| `SearchField` / barra de filtros | Label persistente, limpar com nome acessível, alinhamento comum e estado dos filtros | Busca e filtros existentes preservam a mesma semântica e retornam os mesmos registros |
| `Stepper` / seleção de empresa | Lista de etapas com `aria-current="step"`; nome visível da etapa mobile; seleção por radio nativo | Fluxo inteiro operável por teclado com a mesma sequência de quatro etapas |
| `FileUpload` / lista de arquivos | Composição compartilhada com formatos, limites, drag-over, seleção, remoção e erro por fonte | Mesmos arquivos aceitos; remoção funciona com teclado; arrastar não é requisito |
| `Alert`, `InlineStatus`, `Skeleton`, `EmptyState` | Estado local de erro, sucesso, atualização e vazio; feedback global discreto apenas quando o contexto fecha | Uma falha nunca é apresentada como cadastro vazio ou sucesso |
| Badges de status e planilha | Status compacto e consistente; nomes fiscais longos com quebra apropriada em cards | Informação não depende só da cor; nomes não são cortados sem acesso ao conteúdo completo |

Criar somente os componentes necessários para os consumidores identificados. Manter componentes de negócio em `components/domain`, feedback em `components/feedback` e primitivas em `components/ui`. Não introduzir um framework genérico de tabelas ou formulários para esta melhoria.

### 4.3 Acessibilidade e movimento

- Meta de contraste: pelo menos 4,5:1 para texto comum e 3:1 para texto grande, observando as definições e exceções do [critério de contraste do W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Medir todos os estados e fundos efetivos.
- Adotar 44 × 44 px como meta de conforto para controles touch. O mínimo AA de 24 × 24 px tem exceções de espaçamento e contexto; não confundir essa meta de produto com o requisito normativo. Referência: [tamanho mínimo de alvo](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Manter foco visível; incluir salto para conteúdo, foco no título ao mudar de rota/etapa e nomes acessíveis de ícones. Evitar mover foco durante atualizações comuns de dados.
- Nos modais, tornar o conteúdo externo inerte, conter o foco e devolvê-lo ao acionador. A pilha deve preservar detalhes quando a edição interna fecha. Referência: [padrão de diálogo modal do W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- Transições de cor/borda de 120–180 ms; abertura de 160–220 ms; deslocamento máximo de poucos pixels somente quando comunicar mudança real. Evitar `transition-all`, rotação decorativa de ações e elevação de cards estáticos.
- Em `prefers-reduced-motion`, desativar deslocamento, escala, ping e pulse; manter feedback textual de loading. Nenhuma animação deve ser necessária para entender o estado.
- Usar `aria-live="polite"` para atualização e sucesso, `role="alert"` para falha que exige atenção e regiões ocupadas identificadas com `aria-busy`. Evitar múltiplos anúncios idênticos.

## 5. Plano por página e fluxo

### 5.1 Layout, navegação e sessão

Arquivos: `App.tsx`, `components/layout/{Layout,Sidebar,PageHeader}.tsx` e componentes de autenticação.

1. Manter a ordem operacional e a área administrativa. Padronizar nomes entre menu e cabeçalho: Visão geral, Histórico de planilhas, Empresas clientes, Perfis e alíquotas, Modelos de planilha e Usuários.
2. Preservar “Gerar nova planilha” como ação destacada, com menos efeitos decorativos e alvo maior.
3. No mobile, implementar ciclo de foco, Escape, retorno ao botão de abertura, `aria-controls` e inatividade do menu fechado. Considerar a abertura de “Alterar senha” como novo overlay superior.
4. Ajustar `min-width: 0` nos contêineres flex e usar altura dinâmica de viewport com fallback; verificar teclado virtual, sidebar e rolagem do `main`.
5. Manter o shell durante o carregamento de rotas, com skeleton no conteúdo. Preservar a tela própria de inicialização da sessão, dando contraste adequado à mensagem.
6. Oferecer estado recuperável para erro de renderização/chunk, sem fingir que houve logout. Quando a sessão realmente expirar, explicar o retorno ao login sem mudar a política atual de autenticação.

Aceite: mesmas rotas e permissões, menu utilizável por teclado em ambas as larguras, nenhum controle invisível recebendo foco e nenhuma troca de página apagando a navegação durante loading.

### 5.2 Login e alteração de senha

Arquivos: `pages/Login/index.tsx`, `components/auth/AlterarSenhaModal.tsx`, componentes de campos.

1. Preservar composição institucional desktop e marca mobile; reduzir redundância visual para priorizar o formulário.
2. Unificar campos com o restante do sistema, manter `autocomplete` de login e configurar os campos de alteração com seus propósitos apropriados.
3. Disponibilizar revelar/ocultar senha na ordem de Tab; distinguir o nome acessível de cada revelador.
4. Associar falhas de campo e formulário, manter os valores após falha e apresentar loading textual durante autenticação/salvamento.
5. Fazer o sucesso da alteração de senha permanecer perceptível após o fechamento do modal; revisar o temporizador de 1,8 s e seu cancelamento ao fechar/reabrir.
6. Preservar as políticas atuais: cadastro de usuário exige oito caracteres; alteração de senha exige seis. Não unificar essas regras como decisão visual.

Aceite: entrar, errar credenciais, revelar senha, alterar senha, cancelar e sair conservam seus efeitos atuais. O formulário continua utilizável com zoom e teclado virtual.

### 5.3 Visão geral

Arquivo: `pages/Dashboard/index.tsx`.

1. Tornar o cabeçalho operacional mais compacto, com ação de geração evidente e instrução orientada ao trabalho do usuário.
2. Retirar o padding duplicado dos quatro indicadores, padronizar altura e alinhamento e limitar hover aos links/ações reais.
3. Exibir skeleton, valor, indisponibilidade e atualização por indicador. Não transformar consulta malsucedida em zero nem “nenhuma planilha”.
4. Preservar as métricas, esclarecendo seus rótulos: solicitações concluídas não são necessariamente a contagem de arquivos; empresas cadastradas não comprovam atendimento; `total_notas_processadas` é alimentado pelos registros processados, não por uma contagem distinta de NF-e.
5. Corrigir o denominador de modelos a partir do catálogo de seis tipos, sem valor fixo, e manter a quantidade de versões separada.
6. Reutilizar padrão de tabela e feedback por download. Na listagem, usar “Baixar arquivos” quando a extensão não puder ser conhecida pelos dados disponíveis.

Aceite: oito recentes preservados, valores derivados das mesmas fontes, indisponibilidade explícita e ação de download coerente com o endpoint.

### 5.4 Nova solicitação — jornada principal

Arquivos: `pages/NovaSolicitacao/index.tsx`, `useNovaSolicitacaoPage.ts`, `useFiscalInputFiles.ts`, `TemplateUpdateBanner.tsx`.

**Estrutura:** manter quatro etapas — Empresa, Período, Arquivos e Revisão e resultado. O estado de processamento e o resultado continuam dentro da quarta etapa, sem acrescentar uma etapa obrigatória.

1. Dividir a composição em componentes locais por etapa, sem copiar regras fiscais para o JSX. Manter estado e chamadas no hook de página.
2. Reduzir o banner de modelos a contexto secundário com versões disponíveis e detalhe acessível. A consulta de versões não comprova sincronização permanente; adequar o texto ao que ela efetivamente informa.
3. Selecionar empresa com grupo de radios, exibir razão social, CNPJ, UF e regime com quebra adequada. Distinguir falta de empresas ativas, ausência de resultado na busca e falha da consulta; oferecer os caminhos já existentes de limpar busca e cadastrar empresa.
4. Mostrar a etapa atual por nome no mobile e mover foco para seu título ao avançar/voltar.
5. Antecipar a validação existente de datas para “Avançar” na etapa 2, mantendo a validação final. Usar labels associados e mensagens específicas para campo vazio ou intervalo invertido; manter atalhos de mês atual/anterior.
6. Unificar visualmente as fontes: XML/ZIP e SPED são alternativas ou complementares; a planilha auxiliar sozinha não satisfaz a entrada obrigatória. Explicar isso em uma frase antes dos anexos.
7. Exibir os limites existentes de 20 MB por arquivo e 100 MB no conjunto XML/ZIP. Explicar que o servidor valida também o total recebido e o conteúdo expandido de ZIP; não prometer que a seleção local garante aceitação fiscal.
8. Manter seleção múltipla, deduplicação atual, arrastar/soltar, remoção e limpeza. Mostrar nomes longos, tamanhos, quantidade e rejeições junto à fonte correspondente; não inventar progresso de upload.
9. Na revisão, apresentar empresa, período, regime e fontes em blocos claros, com ações de voltar e gerar empilhadas quando necessário. Preservar campos/arquivos ao voltar e o comportamento atual de reiniciar a solicitação.
10. Durante a requisição, usar mensagem “Processando arquivos fiscais…” e indicador indeterminado. O endpoint não fornece porcentagem nem eventos de etapas internas. Não simular porcentuais, tempo restante ou conclusão de validações ainda não respondidas.
11. Apresentar timeout como falta de confirmação, orientando a consultar o histórico antes de repetir. A criação e o processamento são duas requisições; um timeout não comprova cancelamento e uma nova tentativa pode criar outra solicitação. Não adicionar retry automático de escrita.
12. Separar visualmente resultado completo e resultado com avisos usando `status`, `saidas`, `arquivo_path`, `aviso`, `notas_ignoradas` e `cfops_sem_regra`, sem criar novos status persistidos.
13. Priorizar os arquivos disponíveis e seus downloads no resultado. Manter a explicação de saídas sem modelo, o relatório de notas desconsideradas e a conferência completa; evitar o convite para iniciar outra solicitação como ação dominante antes do download.
14. Em tabelas e cards, permitir nomes fiscais longos e preservar valores, origem das datas e destino de planilha. Revisar textos sobre período contra o comportamento real de XML/SPED antes de simplificá-los.

Aceite: gerar com XML, ZIP, SPED e combinações válidas continua enviando os mesmos dados e apresentando as mesmas saídas; fluxo inteiro por teclado; erro de período aparece antes do upload; nenhum aviso de geração parcial é encoberto por mensagem genérica de sucesso.

### 5.5 Histórico e conferência

Arquivos: `pages/Historico/index.tsx`, `useHistoricoPage.ts`, `components/ui/Modal.tsx`.

1. Dar labels aos filtros de empresa/status, mostrar o resultado dos filtros e oferecer limpeza usando o estado já existente. Diferenciar histórico inicial vazio de filtro sem resultado.
2. Manter “Conferir”, download e exclusão com hierarquia distinta; nome genérico de download na lista, onde `saidas` não está disponível. Não acrescentar uma consulta por linha somente para descobrir extensão.
3. Organizar o modal de detalhes em identificação, estado/avisos, totais, conferência e ações. Reduzir repetição visual de download sem retirar acesso à ação.
4. Renomear “Total Notas” para um rótulo que indique soma monetária, mantendo o cálculo atual. Preservar débito, crédito e valor devido.
5. Manter tabela detalhada com todas as doze colunas; limitar o scroll ao seu contêiner, com cabeçalhos legíveis e foco visível. Evitar ocultar números essenciais para caber na tela.
6. Garantir que edição manual de data funcione sobre detalhes sem conflito de foco. Exibir a falha dentro do editor e o sucesso no contexto da nota.
7. Informar que salvar a data também atualiza os arquivos gerados, conforme o endpoint atual. Mostrar pending até essa resposta, preservar o dado digitado na falha e bloquear repetição da mesma ação.
8. Manter confirmação de exclusão com empresa/competência e consequência real. Fechar apenas o que corresponde à solicitação excluída; não anunciar exclusão concluída antes da resposta.

Aceite: filtros e visibilidade por proprietário permanecem iguais; Escape no editor retorna aos detalhes; o arquivo baixado após editar data contém o resultado da regeneração existente.

### 5.6 Empresas e termo de acordo

Arquivos: `pages/Empresas/index.tsx`, `useEmpresasPage.ts`.

1. Unificar busca e filtro de UF com os padrões de formulário e aumentar áreas de limpar, editar e excluir.
2. Revisar a tabela de nove colunas, permitindo quebra de razão social e descrição, mantendo CNPJ/I.E. reconhecíveis. Evitar usar `title` como único acesso ao texto completo no touch.
3. Agrupar o formulário em identificação, vínculo fiscal e situação. Rever as três colunas dentro do modal `xl`: CNPJ e I.E. precisam de largura, UF pode ser compacto; no mobile, uma coluna.
4. Distinguir perfil carregando, ausente e indisponível. Não substituir silenciosamente o perfil escolhido nem redefinir defaults como efeito da alteração visual.
5. Preservar máscara CNPJ, cadastro/limpeza de I.E., seleção de perfil, regime Simples Nacional e estado ativo.
6. Padronizar termo de acordo com identificação da empresa, ajuda sobre a alíquota e seu efeito atual, erro junto ao campo e feedback após salvar/remover.
7. Representar exclusões restritas como indisponíveis para operadores com explicação acessível. Manter criar/editar para esses usuários.

Aceite: filtros retornam os mesmos registros; cadastro e edição produzem os mesmos payloads; nenhuma alíquota muda de escala; optante do Simples e I.E. permanecem persistidos corretamente.

### 5.7 Perfis, alíquotas e regras de produto

Arquivos: `pages/PerfisRegras/index.tsx`, `usePerfisRegrasPage.ts`, `ReducaoProdutoSection.tsx`, `ReclassificacaoCfopSection.tsx` e respectivos hooks.

1. Tornar o seletor de perfil acessível, separando seleção de editar/excluir para evitar controles interativos aninhados. No desktop, reduzir a largura proporcional do seletor; no mobile, usar seleção compacta e manter ações do perfil à vista.
2. Exibir claramente qual perfil está sendo editado e que ele é compartilhado. Organizar as seções em uma sequência estável: configuração do perfil, reduções, alíquotas e CFOP; incluir navegação local simples para as seções longas.
3. Preservar a precedência exibida: redução por produto → termo da empresa → exceção NCM → base estadual. Esclarecer “Exceção prioritária” como prioridade sobre a base estadual, sem sugerir que supera reduções ou termo.
4. Nomear o switch de A.ORI, ampliar seu alvo e apresentar salvando/sucesso/erro ao lado. A resposta do servidor determina o valor efetivo; preservar a mesma propriedade `limitar_a_ori_reducoes`.
5. Expor e tratar loading, erro, vazio e refetch separadamente em todas as quatro consultas de regras. Evitar a mensagem “nenhuma regra” durante requisição ou falha.
6. Unificar cabeçalhos de tabelas, espaçamento, ações e formulários. Exibir erros de criação dentro dos modais de redução/reclassificação e de suas exceções.
7. Manter termos de inclusão/exclusão como a sintaxe atual aceita, com exemplos curtos de vírgula, palavra inteira, prefixo e descrição exata. Não trocar o matcher nem introduzir um simulador fiscal.
8. Preservar todas as conversões de percentual existentes. O valor `1`, por exemplo, não pode ganhar outro significado por uma máscara “mais amigável”; clareza textual deve anteceder qualquer mudança de formato de entrada.
9. Padronizar abas de CFOP; distinguir “padrão do sistema” de “exceção deste perfil”. Preservar a operação que cria uma exceção ao editar o padrão e a restauração do padrão ao excluir a exceção.
10. Padronizar confirmação de exclusões persistentes com identificação da regra/exceção e feedback local. Manter os endpoints atuais e respeitar as restrições de administrador.
11. Manter inclusão, exclusão, descrição, alíquota, origem/destino CFOP e exceções acessíveis mesmo em tabelas estreitas; detalhes longos podem ser expandidos sem serem removidos.

Aceite: cada conjunto de regras apresenta estados verdadeiros; erros nunca ficam atrás do modal; trocar perfil não faz uma operação agir sobre outro perfil; controles e payloads fiscais preservados.

### 5.8 Modelos de planilha

Arquivos: `pages/AdminTemplates/index.tsx`, `useAdminTemplatesPage.ts`.

1. Preservar os seis tipos e suas versões. Tornar a seleção responsiva e acessível; no mobile, usar seletor legível em vez de depender apenas de seis abas longas parcialmente fora da tela.
2. Dar destaque à versão ativa e hierarquia secundária às históricas. Manter hash, observações, datas e mapeamento acessíveis, com detalhes expansíveis quando reduzirem a repetição.
3. Organizar upload em arquivo/tipo, mapeamento e ativação. Mostrar limite de arquivo e erro associado, diferenciar referência de célula (`A2`) de coluna (`AA`) e explicar campos obrigatórios.
4. Tornar os campos de mapeamento legíveis em uma coluna no mobile. Preservar `col_base_calculo` e `aliquota_format`, que existem no estado/defaults, embora não tenham controles visíveis; não expor novas opções silenciosamente.
5. Ao trocar tipo dentro do modal, não recalcular nem sobrescrever mapeamento sem uma decisão explícita de compatibilidade. Nesta melhoria, priorizar contexto/aviso e revisão dos valores já presentes; automatizar defaults seria alteração separada de comportamento.
6. Manter checkbox de promoção com consequência clara para novos processamentos. Mostrar pending apenas na versão acionada, impedir ações conflitantes e exibir erro na região da versão.
7. Revisar a atualização visual do resumo de modelos ativos após upload/promoção utilizando as chaves existentes, sem anunciar sincronização permanente.

Aceite: hash, versões, mapeamento e arquivos preservados; submissão envia o mesmo FormData; ativar uma versão não faz as demais parecerem estar sendo ativadas.

### 5.9 Usuários

Arquivos: `pages/Usuarios/index.tsx`, `useUsuariosPage.ts`.

1. Acrescentar apresentação de loading, vazio real e erro da consulta, reaproveitando os padrões comuns.
2. Melhorar legibilidade da tabela de cinco colunas, diferenciando nome, e-mail, papel/cargo e status. Tratar e-mails longos sem alargar a página inteira.
3. Apresentar pending por usuário ao ativar/desativar, bloquear repetição e confirmar o resultado após resposta. Não usar atualização otimista que dê acesso como confirmado antes do servidor.
4. Expor a razão da indisponibilidade de desativar a própria conta em texto acessível também no touch.
5. Melhorar o formulário com ajuda de senha inicial, labels e autocomplete adequados; manter papéis, cargo derivado e regra de oito caracteres.

Aceite: a própria conta permanece protegida; permissões não são ampliadas; cada ação afeta somente o usuário escolhido; nenhuma tabela vazia aparece como substituta do loading.

## 6. Padrão de estados, feedback e conteúdo

| Situação | Apresentação planejada | Regra de implementação |
| --- | --- | --- |
| Primeira carga de dados | Skeleton compatível com a região e mensagem acessível | Não mostrar zero ou ausência de cadastro antes da resposta |
| Atualização de dados já carregados | Preservar conteúdo e indicar atualização discreta | Não apagar filtros, seleção ou formulário |
| Vazio inicial | Explicar o que falta e apontar ação existente e autorizada | Não oferecer cadastro administrativo ao operador |
| Filtro sem resultado | Informar ausência de correspondência e permitir limpar filtros | Não afirmar que o sistema não possui registros |
| Erro de consulta | Mensagem local e “Tentar novamente” para repetir leitura | Não misturar indisponibilidade com vazio |
| Erro de formulário | Campo identificado, mensagem no modal e foco no primeiro problema | Manter valores e arquivos que ainda estejam disponíveis |
| Escrita em andamento | Loading na ação, região ocupada e prevenção de repetição | Não executar a mutation por efeito de renderização |
| Sucesso de escrita | Confirmação contextual; aviso discreto se o modal fechar | Anunciar somente depois da resposta; manter atualização de cache existente |
| Download | “Preparando arquivos…” e, após resposta, “Download iniciado” | O app não consegue comprovar que o usuário salvou o arquivo no disco |
| Processamento demorado | Indicador indeterminado e instrução de aguardar | Sem porcentagem ou fase fiscal simulada |
| Timeout de escrita/processamento | Informar falta de confirmação e caminho de conferência | Sem promessa de cancelamento e sem repetição automática |
| Resultado com avisos | Contagem de arquivos disponíveis e avisos acionáveis | Não alterar o status fiscal armazenado para criar um estado visual |
| Ação sem permissão | Explicação de indisponibilidade adequada ao papel | A autorização definitiva continua no backend |

A escrita deve ser curta, em português consistente e orientada à tarefa. Manter termos fiscais necessários, explicando siglas na primeira ocorrência. Substituir referências a camadas internas por consequências compreensíveis. Não declarar conformidade legal, sincronização, sucesso ou precisão que os dados da operação não comprovem.

Exemplos de revisão: “rebaixe arquivos `.xlsx`” → “baixe novamente os arquivos gerados”; “Processando NF-es…” → “Processando arquivos fiscais…”; “Total Notas” monetário → “Valor total das notas”. Textos de rejeição por período e precedência devem ser conferidos com as regras existentes antes de alteração.

## 7. Responsividade e densidade

| Faixa | Comportamento esperado |
| --- | --- |
| 320–639 px | Drawer, margens de 16 px, formulário em uma coluna, etapa atual visível, ações empilhadas, alvos touch amplos e campos de 16 px |
| 640–1023 px | Campos em duas colunas quando houver largura útil; filtros flexíveis; navegação ainda em drawer |
| 1024–1279 px | Sidebar fixa; verificar largura residual, principalmente perfis/regras e indicadores |
| 1280 px ou mais | Sidebar fixa, conteúdo com largura controlada, tabelas confortáveis e formulários sem linhas excessivamente longas |

A faixa de viewport não deve ser o único critério: um modal ou coluna estreita pode exigir uma coluna mesmo em desktop. Testar também 360, 390, 768, 1024, 1280, 1440 e 1920 px, zoom de 200%, viewport equivalente a 320 px e teclado virtual.

Diretrizes:

- Não comprimir uma tabela fiscal até tornar números ilegíveis. Preservar tabela semântica e rolagem horizontal local quando a relação entre colunas precisar ser mantida.
- Em listas simples, cartões mobile podem reorganizar os mesmos dados, desde que não dupliquem conteúdo para leitores de tela e todas as ações continuem disponíveis. Só adotar se a inspeção visual demonstrar vantagem sobre a tabela.
- Evitar várias rolagens verticais aninhadas. O modal deve ter uma área principal de conteúdo; tabelas excepcionalmente longas podem ter rolagem própria identificada.
- Garantir quebra de nomes de empresa, arquivos, descrições, nomes de planilha e mensagens. Códigos e valores podem permanecer sem quebra dentro da região rolável.
- Manter ações persistentes visíveis apenas quando não cobrirem campos, mensagens ou conteúdo com teclado virtual e zoom.

## 8. Sequência de implementação

Cada fase deve terminar com revisão do diff, verificação dos fluxos afetados e registro de antes/depois. Não executar uma substituição global de classes em todas as páginas de uma só vez.

| Fase | Tarefas e arquivos principais | Dependência | Saída verificável |
| --- | --- | --- | --- |
| 0 — Baseline visual | Abrir as oito rotas com contas de teste admin/operador; registrar os quinze modais, treze tabelas e estados; medir contraste, overflow e foco | Navegador e ambiente de teste disponíveis | Capturas e matriz de achados confirmados antes da primeira edição de UI |
| 1 — Fundação | Tokens, `Card`, `Button`, campos, badges, feedback, modal e composição de tabela | Fase 0 | Exemplos comparáveis de todos os estados; correção de UX-02 e UX-04 preparada para os consumidores |
| 2 — Navegação e acesso | Shell, drawer, Suspense, login e alteração de senha | Fase 1 | Navegação e formulários acessíveis sem mudar sessão/permissões |
| 3 — Jornada fiscal principal | Assistente, resultado, arquivos, histórico e edição de data | Fases 1–2 | Jornada empresa → arquivos → geração → download → conferência operável e validada |
| 4 — Cadastros e regras | Empresas, termo, perfis, alíquotas, reduções e CFOP | Fases 1–2; padrões da fase 3 estabilizados | Formulários, tabelas e estados consistentes; ações respeitam papéis |
| 5 — Administração e painel | Modelos, usuários e visão geral | Fases 1–4 | Oito páginas migradas; métricas, versões e ações com feedback coerente |
| 6 — Validação e entrega | Responsividade transversal, teclado, contraste, movimento reduzido, regressão e performance | Fases anteriores | Critérios de aceite cumpridos e riscos remanescentes documentados |

### 8.1 Tarefas técnicas transversais

1. Criar tokens e variantes com defaults compatíveis; migrar consumidores gradualmente e só então retirar classes compensatórias.
2. Manter estado de UI nos hooks apropriados: erro de modal, feedback por ação e identificador do item em andamento. Evitar reimplementar chamadas HTTP dentro de novos componentes visuais.
3. Padronizar extração de mensagens usando `getErrorMessage`, preservando detalhes úteis. Falhas de download podem vir como Blob; tratar a apresentação desse erro sem mudar o transporte do arquivo.
4. Para refletir permissões, reutilizar o usuário autenticado recebido pelo layout por props ou contexto de apresentação. Não criar segunda sessão, token paralelo ou regra de autorização independente.
5. Compartilhar a infraestrutura de overlays entre menu e modais. Cobrir abertura encadeada e restauração de foco antes de substituir confirmações nativas.
6. Manter contratos de `Button` e campos durante a migração, revisando explicitamente `type="button"` e `type="submit"` em formulários.
7. Consolidar fontes somente após comparar os logos renderizados e fallback; não trocar desenho ou família institucional por conveniência.
8. Preservar code splitting e cache. Não adicionar refetch periódico, animações pesadas, chamadas por linha ou bibliotecas grandes para mudanças visuais.

### 8.2 Entregas incrementais e reversão

Organizar alterações futuras em conjuntos pequenos: fundação, navegação, jornada principal, cadastros/regras e administração/painel. Os componentes devem aceitar os consumidores antigos até sua migração. Caso um conjunto apresente regressão, reverter somente os commits daquele conjunto, preservando trabalho posterior e dados existentes; não usar restauração destrutiva da árvore de trabalho.

Publicação e alterações de infraestrutura não fazem parte desta entrega. A liberação futura deve ocorrer somente após as verificações da fase 6, pelo fluxo de entrega já utilizado no projeto.

## 9. Validação de compatibilidade e qualidade

### 9.1 Matriz de regressão funcional

| Cenário | Resultado exigido |
| --- | --- |
| Login válido/inválido, sessão expirada e logout | Mesmos efeitos de sessão e acesso; feedback compreensível |
| Alterar senha com erro e sucesso | Mesmo payload e regras; modal/foco/feedback corretos |
| Operador versus administrador | Rotas e operações respeitam a matriz; histórico permanece filtrado pelo servidor |
| Cadastro/edição de empresa | CNPJ, I.E., perfil, UF, Simples e atividade preservados após recarregar |
| Termo de acordo e alíquotas | Mesma normalização; testar especialmente valores decimais, percentuais e o limite `1` |
| Seleção de perfil e regras | Mesmo perfil alvo, mesmos termos, exceções e precedência |
| Período vazio/invertido e atalhos | Validação antecipada sem modificar datas válidas ou seu formato de envio |
| XML, ZIP, SPED e fontes combinadas | Mesmas fontes, deduplicação, limites e resultados de negócio |
| Planilha auxiliar sem XML/SPED | Continua insuficiente para iniciar processamento |
| Arquivos vazios, inválidos e acima do limite | Erro visível na origem da ação; nenhum envio duplicado |
| Geração com uma ou múltiplas saídas | Mesmos XLSX/ZIP, tipos, valores e avisos |
| Parte das saídas sem template ativo | Arquivos disponíveis acessíveis; aviso não confundido com sucesso integral |
| Notas ignoradas e CFOP sem regra | Mesmas informações e consequências fiscais |
| Edição manual de data de entrada | Mesma origem “Manual”, atualização da nota e regeneração dos arquivos |
| Download com falha ou timeout | Erro contextual e nova tentativa consciente; não anunciar arquivo salvo |
| Exclusão confirmada/cancelada/negada | Cancelar não envia; erro não fecha contexto indevidamente; sucesso atualiza a lista |
| Upload e promoção de template | Mesmos campos, defaults, versão ativa e arquivo; sem mudança automática de mapeamento |
| Criação e ativação de usuário | Mesmos papéis e restrição à própria conta; pending por registro |

### 9.2 Testes e verificações previstos para a implementação

- Executar `npm.cmd run lint` e `npm.cmd run build` no frontend após cada conjunto relevante. Não aumentar os avisos do baseline; ajustes nos arquivos tocados podem eliminar os três já encontrados.
- O frontend não possui testes de interação identificados nem comando correspondente no `package.json`. Introduzir cobertura de testes de desenvolvimento proporcional ao risco, especialmente para modal empilhado, drawer, seleção de empresa e estados de erro. Não instalar dependências nesta fase documental.
- Testar integrações com respostas de API controladas em ambiente isolado: loading prolongado, sucesso, erro de validação, indisponibilidade, 401, 403 e timeout. Não exercitar exclusões ou alterações fiscais no ambiente de produção para validar aparência.
- Cobrir por interação real a jornada principal e os fluxos de permissão. Comparar payloads antes/depois, incluindo FormData, campos opcionais, números e booleanos.
- Executar a suíte backend existente no ambiente de testes antes da entrega da implementação, com atenção a `test_permissoes_operador`, `test_supabase_rbac_history`, `test_pipeline_multi_planilha`, `test_uniao_fontes`, `test_sped_periodo`, `test_simples_nacional_pipeline`, `test_reducao_produto_pipeline`, `test_reclassificacao_cfop_pipeline`, `test_logo_e_data_entrada`, `test_exclusao_solicitacao` e proteção de fórmulas. Esses testes são salvaguardas, não autorização para modificar o backend.
- Comparar conteúdo relevante dos arquivos gerados com as mesmas entradas de teste: células, fórmulas, tipos, totais e datas. Não exigir igualdade binária de arquivos ZIP/XLSX quando metadados variáveis forem esperados.
- Realizar navegação completa só por teclado, leitura assistiva dos fluxos centrais e inspeção de contraste computado. Verificação automatizada de acessibilidade complementa, mas não substitui, essas verificações.
- Capturar antes/depois em larguras equivalentes e dados iguais; validar nomes longos, seis tipos de modelo, tabelas cheias e vazias e formulários com mensagens extensas.

### 9.3 Performance

Registrar na fase 0 tamanho de JS/CSS de produção e comportamento das rotas com dados representativos. Usar as mesmas condições para comparar a versão final. Metas: nenhuma nova biblioteca de runtime sem justificativa, nenhuma consulta por item de tabela, nenhum polling adicional, manutenção do lazy loading, ausência de deslocamento perceptível ao trocar skeleton por conteúdo e nenhuma regressão perceptível de interação.

Se o bundle inicial crescer mais de 10% em relação ao baseline medido, investigar e justificar antes de aceitar. Essa é uma meta de engenharia proposta, não uma medição já realizada. Testar listas de empresas na ordem de centenas e conferências com muitos registros; só considerar paginação local/virtualização se houver necessidade medida e preservação integral de consulta e acessibilidade.

### 9.4 Critérios finais de aceite

- [ ] Todas as oito páginas e seus fluxos foram revisados visualmente com dados representativos.
- [ ] Todos os quinze pontos de modal e treze tabelas foram inspecionados, incluindo sobreposições.
- [ ] Nenhuma regra fiscal, permissão, rota, tipo de planilha ou funcionalidade existente foi alterada.
- [ ] Todos os controles essenciais funcionam por teclado e possuem identificação acessível.
- [ ] Foco, Escape, abertura e fechamento de overlays são previsíveis.
- [ ] Nenhum erro de formulário fica atrás do modal nem é substituído por estado vazio.
- [ ] Carregamento, vazio, erro, atualização, sucesso e resultado com avisos estão diferenciados.
- [ ] Nenhuma página exige rolagem horizontal global nas larguras testadas; tabelas largas têm região própria.
- [ ] Fontes, campos e controles mobile atendem aos padrões de legibilidade e conforto estabelecidos.
- [ ] Cores e estados foram medidos; conteúdo não depende exclusivamente de cor ou animação.
- [ ] `prefers-reduced-motion` foi verificado.
- [ ] Downloads, edição de data, exclusões e ativações possuem feedback fiel à resposta.
- [ ] Build, lint e regressões relevantes foram verificados; resultados e limitações registrados.
- [ ] Comparação de payloads e saídas fiscais não identificou mudança de comportamento.
- [ ] Logos, identidade institucional e desempenho foram preservados.

## 10. Pendências específicas para a execução

1. **Inspeção visual real:** depende de navegador disponível e contas de teste. Deve preceder a edição dos componentes e confirmar os riscos de layout apontados pelo código.
2. **Contraste e legibilidade:** cores com opacidade, gradientes e fallback de fontes exigem medição renderizada; a paleta proposta não substitui essa validação.
3. **Significado de indicadores:** validar nomenclatura contra os valores efetivamente retornados, sem converter silenciosamente registros processados em contagem distinta de notas ou solicitações em quantidade de arquivos.
4. **Mapeamento de templates:** a troca de tipo e os defaults não expostos precisam permanecer compatíveis. Correções funcionais nessa área devem ser tratadas separadamente se a inspeção revelar necessidade.
5. **Volumes e performance:** não há baseline de produção medido nesta análise; a fase 0 deve estabelecê-lo antes de impor virtualização ou novas dependências.

Este plano está pronto para orientar a implementação por etapas. A alteração realizada nesta entrega é exclusivamente a criação deste documento.
