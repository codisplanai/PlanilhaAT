# Planaut MCP

Servidor MCP **local** que conecta o Claude (ou outro cliente MCP) ao Planaut. Com ele a IA:

- consulta e altera **configurações fiscais**: empresas, termos de acordo, perfis de regras e as regras de cada seção (alíquotas de destino, roteamento de CFOP, reduções, reclassificações, exclusões da Parcial, FCP);
- envia **modelos de planilha** (.xlsx do computador) como nova versão, coloca em uso e desativa modelos exclusivos;
- **gera as planilhas** de Antecipação Parcial, Antecipação Tributária e DIFAL a partir dos XMLs/ZIPs e do SPED que estão no computador;
- **preenche datas de entrada** em planilhas já geradas, a partir do SPED ou da planilha contábil.

## Como funciona

```text
Claude Desktop / Claude Code
        │  MCP (stdio)
        ▼
planaut-mcp (no computador do usuário)
  ├─ lê XML/ZIP/SPED só nas pastas liberadas
  ├─ motor fiscal do site (frontend/src/lib/localProcessing), sem cópia
  ├─ grava o .xlsx na pasta de saída (nunca sobrescreve)
  └─ API do Planaut com o login do usuário
        ├─ GET  /processamento-local/contexto   (regras e modelos)
        ├─ GET  /templates/{id}/arquivo         (modelo oficial, conferido por SHA-256)
        └─ POST /processamento-local/solicitacoes/{id}/resultado  (só dados estruturados)
```

- Mesma regra do site: **arquivos fiscais não vão para o servidor**. O MCP roda o mesmo motor do navegador e envia ao histórico apenas o resultado estruturado.
- **Mesmo cálculo do site**: o motor é importado de `frontend/`, então qualquer correção fiscal vale para os dois caminhos. `npm run test:motor` roda a suíte do motor com o DOM XML usado pelo MCP.
- **Mesmas permissões**: o login é o do usuário (`/auth/login`); o que um operador não pode fazer no site, a IA também não consegue.
- **Nada de adivinhação**: quando a apuração pede decisão (CT-e sem NF-e, uso e consumo, bonificação, Convênio 52/91, MVA), a geração pausa e devolve as pendências; a IA pergunta ao usuário e responde com `responder_pendencias`. Na bonificação, a etapa só é liberada com decisão para todas as notas.

## Ferramentas

| Grupo | Ferramentas |
|---|---|
| Sessão | `planaut_status` |
| Empresas | `listar_empresas`, `obter_empresa`, `salvar_empresa`, `excluir_empresa`, `definir_termo_acordo`, `remover_termo_acordo` |
| Perfis | `listar_perfis`, `obter_perfil`, `salvar_perfil`, `configurar_perfil`, `duplicar_perfil`, `copiar_regras_entre_perfis`, `excluir_perfil` |
| Regras | `listar_regras`, `salvar_regra_aliquota`, `salvar_regra_cfop`, `salvar_regra_reducao`, `salvar_regra_reclassificacao`, `salvar_regra_exclusao`, `salvar_regra_fcp`, `excluir_regra`, `adicionar_excecao_regra`, `remover_excecao_regra`, `carregar_exclusoes_padrao_ba`, `aplicar_preset_fcp_bebidas_ba` |
| Modelos | `listar_templates`, `obter_template`, `enviar_template`, `promover_template`, `desativar_template` |
| Consultas | `listar_solicitacoes`, `obter_solicitacao` |
| Planilhas | `listar_arquivos_fiscais`, `gerar_planilhas`, `responder_pendencias`, `cancelar_geracao`, `preencher_datas_entrada` |

Convenções:

- Percentuais são sempre explícitos (`aliquota_percentual: 20.5` = 20,5%). O MCP converte para a fração da API em texto, sem a ambiguidade de `1` virar 100%.
- `salvar_*` sem id cria; com id altera só os campos enviados.
- Regra de CFOP **global** (vale para todos os perfis) só é criada com `global: true`.
- `configurar_perfil` altera uma chave de `configuracoes_extras` por vez e preserva as demais.
- Ferramentas de exclusão são marcadas como destrutivas (o cliente pede confirmação).
- `enviar_template` copia por padrão o mapeamento do modelo em uso do mesmo tipo (ou parte do padrão do formulário do site, `frontend/src/lib/templateMapping.ts`, ou de um modelo escolhido), aplica ajustes, confere as colunas obrigatórias do tipo e as abas do .xlsx e mostra as diferenças para o modelo em uso; com `simular: true`, faz tudo isso sem enviar. Partir do modelo em uso preserva ajustes que o layout sugerido pelo site (o dos modelos oficiais) não conhece, como a aba fixa. O arquivo precisa estar numa pasta liberada. Enviar, promover e desativar exigem administrador ou Contador Sênior (a API decide).
- Fora do escopo, de propósito: gestão de usuários (continua no site).

## Instalação

No site, a tela **Integração com IA** (administrador e Contador Sênior) tem os botões de download, o endereço e o e-mail para copiar e os comandos abaixo já preenchidos.

### Claude Desktop (extensão `.mcpb`)

1. Baixe a [extensão da release mais recente](https://github.com/codisplanai/PlanilhaAT/releases/latest/download/planaut.mcpb) ou gere com `npm ci && npm run build` (`dist/planaut.mcpb`).
2. Dê dois cliques no arquivo e clique em **Instalar** (ou arraste o arquivo para as Configurações do Claude Desktop, ou use **Configurações → Extensões → Configurações avançadas → Instalar extensão…**).
3. Preencha:
   - **E-mail e senha do Planaut** (a senha fica no cofre do sistema operacional);
   - **Pastas dos arquivos fiscais**: onde ficam os XMLs/SPEDs dos clientes. O MCP não lê nem grava fora delas;
   - **Pasta das planilhas geradas** (opcional; precisa estar dentro das pastas acima);
   - **Endereço do Planaut** (padrão: produção).

O Claude Desktop já traz o Node.js; não é preciso instalar nada.

### Claude Code e outros clientes MCP

O mesmo servidor num arquivo só: baixe o [`planaut-mcp.mjs` da release mais recente](https://github.com/codisplanai/PlanilhaAT/releases/latest/download/planaut-mcp.mjs) ou use `dist/planaut-mcp.mjs` gerado pelo `npm run build`. Precisa do Node.js 20 ou mais recente.

```bash
claude mcp add \
  --env 'PLANAUT_EMAIL=voce@escritorio.com.br' \
  --env 'PLANAUT_SENHA=***' \
  --scope user --transport stdio \
  planaut -- node "$HOME/Planaut/planaut-mcp.mjs" "$HOME/Clientes"
```

As opções do `claude mcp add` vêm antes do nome do servidor, e o `--env` aceita vários pares: com o nome logo depois dele, o nome seria lido como mais um par, por isso `--scope`/`--transport` ficam no meio. O Claude Code grava esses valores, inclusive a senha, em `~/.claude.json`, sem criptografia; em computador compartilhado, prefira a extensão do Claude Desktop.

Configuração equivalente para clientes que usam JSON:

```json
{
  "mcpServers": {
    "planaut": {
      "command": "node",
      "args": ["/Users/voce/Planaut/planaut-mcp.mjs", "/Users/voce/Clientes"],
      "env": { "PLANAUT_EMAIL": "voce@escritorio.com.br", "PLANAUT_SENHA": "***" }
    }
  }
}
```

| Variável | Uso |
|---|---|
| `PLANAUT_URL` | Endereço do Planaut (padrão `https://planaut.codisplan.com.br`; `http` só em localhost) |
| `PLANAUT_EMAIL`, `PLANAUT_SENHA` | Login do usuário |
| `PLANAUT_PASTAS` | Pastas liberadas, separadas por `;` (alternativa aos argumentos; sem nenhuma, usa a pasta pessoal) |
| `PLANAUT_PASTA_SAIDA` | Pasta padrão das planilhas geradas |

### Versões

Cada release do site roda os testes do conector, gera `planaut.mcpb` e `planaut-mcp.mjs` com a versão da release (`PLANAUT_MCP_VERSION`) e anexa os dois à GitHub Release; por isso os links `releases/latest/download/...` sempre trazem o conector com o motor fiscal publicado. No `develop`, o pipeline roda os mesmos testes e o build. `planaut_status` mostra a versão instalada.

## Exemplos de pedidos

- "Quais empresas usam o perfil Comércio BA? Mostre as regras de FCP dele."
- "Cadastre a alíquota de 20,5% para BA no perfil 3 e uma exceção de 25% para o NCM 2203."
- "Gere as planilhas de outubro/2026 da empresa com CNPJ 12.345.678/0001-95 usando a pasta C:\Clientes\Mercado X\2026-10."
- "Preencha as datas de entrada da planilha gerada usando o SPED dessa mesma pasta."
- "Envie C:\Clientes\Modelos\parcial_2027.xlsx como nova versão do modelo da Antecipação Parcial para 100 linhas, sem colocar em uso. Simule antes."

## Desenvolvimento

```bash
cd mcp
npm ci
npm test            # testes do servidor (API simulada)
npm run test:motor  # suíte do motor fiscal (frontend/tests) com o DOM XML do MCP
npm run typecheck   # TypeScript estrito, incluindo o motor importado
npm run build       # dist/planaut.mcpb e dist/planaut-mcp.mjs (PLANAUT_MCP_VERSION=1.2.3 define a versão)
```

Teste ponta a ponta contra uma API local (SQLite e autenticação local):

```bash
# na raiz do repositório
ENABLE_LOCAL_AUTH=true AUTO_CREATE_SCHEMA=true SEED_DEFAULTS=true \
DATABASE_URL=sqlite:///./e2e.db uvicorn app.main:app --port 8765
# em outro terminal
cd mcp && PLANAUT_URL=http://127.0.0.1:8765 npm run e2e
```

O `e2e` cria perfil, alíquota e empresa, gera a Parcial respondendo a uma pendência de bonificação, preenche datas de entrada pelo SPED e gera uma Antecipação Tributária com MVA pendente decidida pelo "usuário".

Estrutura:

```text
mcp/
├── src/
│   ├── index.ts        # entrada stdio
│   ├── server.ts       # registro das ferramentas e instruções do servidor
│   ├── api.ts          # cliente da API (login, refresh por cookie, erros)
│   ├── generation.ts   # orquestra o motor: pendências, histórico, gravação
│   ├── entryDates.ts   # preenchimento de datas de entrada
│   ├── files.ts        # pastas liberadas, leitura e gravação sem sobrescrita
│   ├── dom.ts          # DOMParser/XMLSerializer para o motor no Node
│   ├── compat.ts       # DecompressionStream para Node antigo
│   └── tools/          # ferramentas por grupo
├── test/               # node:test
├── scripts/            # build, e2e, suíte do motor
└── manifest.base.json  # base do manifesto da extensão
```
