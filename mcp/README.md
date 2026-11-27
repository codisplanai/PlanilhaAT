# Planaut MCP

Servidor MCP **local** que conecta o Claude (ou outro cliente MCP) ao Planaut. Com ele a IA:

- consulta e altera **configurações fiscais**: empresas, termos de acordo, perfis de regras e as regras de cada seção (alíquotas de destino, roteamento de CFOP, reduções, reclassificações, exclusões da Parcial, FCP);
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
| Consultas | `listar_templates`, `listar_solicitacoes`, `obter_solicitacao` |
| Planilhas | `listar_arquivos_fiscais`, `gerar_planilhas`, `responder_pendencias`, `cancelar_geracao`, `preencher_datas_entrada` |

Convenções:

- Percentuais são sempre explícitos (`aliquota_percentual: 20.5` = 20,5%). O MCP converte para a fração da API em texto, sem a ambiguidade de `1` virar 100%.
- `salvar_*` sem id cria; com id altera só os campos enviados.
- Regra de CFOP **global** (vale para todos os perfis) só é criada com `global: true`.
- `configurar_perfil` altera uma chave de `configuracoes_extras` por vez e preserva as demais.
- Ferramentas de exclusão são marcadas como destrutivas (o cliente pede confirmação).
- Fora do escopo, de propósito: gestão de usuários e envio/promoção de modelos (continuam no site).

## Instalação

### Claude Desktop (extensão `.mcpb`)

1. Gere a extensão (`npm ci && npm run build`) ou use o arquivo `dist/planaut.mcpb` já gerado.
2. No Claude Desktop: **Configurações → Extensões**, arraste o `planaut.mcpb` para a janela (ou use *Instalar extensão*).
3. Preencha:
   - **E-mail e senha do Planaut** (a senha fica no cofre do sistema operacional);
   - **Pastas dos arquivos fiscais**: onde ficam os XMLs/SPEDs dos clientes. O MCP não lê nem grava fora delas;
   - **Pasta das planilhas geradas** (opcional; precisa estar dentro das pastas acima);
   - **Endereço do Planaut** (padrão: produção).

O Claude Desktop já traz o Node.js; não é preciso instalar nada.

### Claude Code e outros clientes MCP

Depois de `npm run build`, o servidor empacotado fica em `build/mcpb/server/index.js`:

```bash
claude mcp add planaut \
  --env PLANAUT_EMAIL=voce@escritorio.com.br \
  --env PLANAUT_SENHA='***' \
  -- node /caminho/PlanilhaAT/mcp/build/mcpb/server/index.js "/caminho/Clientes"
```

Configuração equivalente para clientes que usam JSON:

```json
{
  "mcpServers": {
    "planaut": {
      "command": "node",
      "args": ["/caminho/PlanilhaAT/mcp/build/mcpb/server/index.js", "/caminho/Clientes"],
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

## Exemplos de pedidos

- "Quais empresas usam o perfil Comércio BA? Mostre as regras de FCP dele."
- "Cadastre a alíquota de 20,5% para BA no perfil 3 e uma exceção de 25% para o NCM 2203."
- "Gere as planilhas de outubro/2026 da empresa com CNPJ 12.345.678/0001-95 usando a pasta C:\Clientes\Mercado X\2026-10."
- "Preencha as datas de entrada da planilha gerada usando o SPED dessa mesma pasta."

## Desenvolvimento

```bash
cd mcp
npm ci
npm test            # testes do servidor (API simulada)
npm run test:motor  # suíte do motor fiscal (frontend/tests) com o DOM XML do MCP
npm run typecheck   # TypeScript estrito, incluindo o motor importado
npm run build       # dist/planaut.mcpb
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
