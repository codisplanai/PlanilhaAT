import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Bot,
  Building2,
  CalendarCheck2,
  Download,
  FileCode2,
  FileSpreadsheet,
  FolderLock,
  History,
  KeyRound,
  Laptop,
  ShieldCheck,
  Sliders,
  Terminal,
  UserCheck,
} from 'lucide-react';
import { clsx } from 'clsx';

import { baseApiUrl } from '../../api/client';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import {
  CONNECTOR_DESKTOP_FILE,
  CONNECTOR_DESKTOP_URL,
  CONNECTOR_SERVER_FILE,
  CONNECTOR_SERVER_URL,
  EMAIL_PLACEHOLDER,
  PASSWORD_PLACEHOLDER,
  buildClaudeCodeCommand,
  buildMcpJsonConfig,
  detectConnectorPlatform,
  exampleConnectorPaths,
  isDefaultPlanautUrl,
  resolvePlanautUrl,
  type ConnectorPlatform,
} from '../../lib/integracaoIa';
import { runtimeConfig } from '../../lib/runtimeConfig';
import type { User } from '../../types/auth';
import { CodeBlock, CopyButton } from './CopyButton';

const CAPACIDADES = [
  {
    icon: Building2,
    titulo: 'Empresas e termos de acordo',
    texto: 'Consulta, cadastra e altera empresas clientes e seus termos de acordo.',
  },
  {
    icon: Sliders,
    titulo: 'Perfis e regras',
    texto: 'Alíquotas de destino, roteamento de CFOP, reduções, reclassificações, exclusões da Parcial e FCP; duplica perfis e copia regras.',
  },
  {
    icon: FileCode2,
    titulo: 'Modelos de planilha',
    texto: 'Envia uma nova versão a partir de um .xlsx do computador, com o mapeamento do modelo em uso e uma simulação que mostra as diferenças antes do envio; também coloca versões em uso e desativa modelos exclusivos. O arquivo precisa estar numa das pastas liberadas.',
  },
  {
    icon: FileSpreadsheet,
    titulo: 'Geração de planilhas',
    texto: 'Antecipação Parcial, Antecipação Tributária e DIFAL a partir dos XML, ZIP e SPED das pastas liberadas, com o mesmo motor e os mesmos modelos do site.',
  },
  {
    icon: CalendarCheck2,
    titulo: 'Datas de entrada',
    texto: 'Preenche planilhas já geradas a partir do SPED ou da planilha contábil.',
  },
  {
    icon: History,
    titulo: 'Histórico',
    texto: 'Consulta as solicitações e os resultados já gerados.',
  },
];

const SEGURANCA = [
  {
    icon: FolderLock,
    texto: 'XML, ZIP e SPED são lidos só no seu computador, dentro das pastas liberadas. Para o Planaut vai apenas o resultado da apuração, como no site, e nenhuma planilha existente é sobrescrita.',
  },
  {
    icon: UserCheck,
    texto: 'A IA entra com o seu usuário e tem as suas permissões: o que você não pode fazer no site, ela também não consegue.',
  },
  {
    icon: KeyRound,
    texto: 'A senha fica só na configuração do conector; a IA não a recebe nas conversas.',
  },
  {
    icon: ShieldCheck,
    texto: 'Quando a apuração depende de uma decisão (bonificação, uso e consumo, Convênio 52/91, MVA, CT-e sem NF-e), a IA pergunta a você. Antes de excluir dados ou trocar o modelo em uso, ela confirma com você.',
  },
];

function exemplos(platform: ConnectorPlatform): string[] {
  const raiz = exampleConnectorPaths(platform).pastas[0];
  const sep = platform === 'windows' ? '\\' : '/';
  return [
    'Mostre o status do Planaut.',
    `Gere as planilhas de outubro de 2026 da empresa com CNPJ 12.345.678/0001-95 usando a pasta ${raiz}${sep}Mercado X${sep}2026-10.`,
    `Envie ${raiz}${sep}Modelos${sep}parcial_2027.xlsx como nova versão do modelo da Antecipação Parcial para 100 linhas, sem colocar em uso. Simule antes e me mostre o mapeamento.`,
    'Cadastre a alíquota de 20,5% para BA no perfil Comércio e uma exceção de 25% para o NCM 2203.',
    'Preencha as datas de entrada da planilha gerada usando o SPED da mesma pasta.',
  ];
}

const downloadLinkClass =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold tracking-tight transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600';

const Passo: React.FC<{ numero: number; titulo: string; children: React.ReactNode }> = ({ numero, titulo, children }) => (
  <li className="flex gap-3.5">
    <span
      aria-hidden="true"
      className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200 text-[11px] font-black flex items-center justify-center"
    >
      {numero}
    </span>
    <div className="min-w-0 flex-1 space-y-2.5">
      <p className="text-sm font-bold text-slate-900">{titulo}</p>
      <div className="text-xs text-slate-600 leading-relaxed space-y-2.5">{children}</div>
    </div>
  </li>
);

const Campo: React.FC<{ nome: string; valor?: string; children: React.ReactNode }> = ({ nome, valor, children }) => (
  <div className="rounded-lg border border-slate-200/90 bg-slate-50/60 px-3.5 py-2.5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{nome}</span>
      {valor && <CopyButton value={valor} label={`Copiar ${nome.toLowerCase()}`} />}
    </div>
    {valor && <p className="font-mono text-xs text-slate-900 break-words mt-0.5">{valor}</p>}
    <div className="text-[11px] text-slate-500 leading-relaxed mt-1">{children}</div>
  </div>
);

export const IntegracaoIaPage: React.FC = () => {
  const outlet = useOutletContext<{ user?: User | null } | null>();
  const email = outlet?.user?.email?.trim() || '';
  const [platform, setPlatform] = useState<ConnectorPlatform>(() =>
    detectConnectorPlatform(typeof navigator === 'undefined' ? '' : navigator.userAgent),
  );
  const planautUrl = useMemo(() => resolvePlanautUrl(baseApiUrl, window.location.origin), []);
  const usaEnderecoPadrao = isDefaultPlanautUrl(planautUrl);
  const versaoSite = runtimeConfig.appVersion || import.meta.env.VITE_APP_VERSION || '';

  const setup = { platform, planautUrl, email };
  const comandoClaudeCode = buildClaudeCodeCommand(setup);
  const configJson = buildMcpJsonConfig(setup);
  const caminhos = exampleConnectorPaths(platform);
  const pastaDoServidor = caminhos.server.slice(0, caminhos.server.lastIndexOf(platform === 'windows' ? '\\' : '/'));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Bot className="w-5 h-5" />}
        title="Integração com IA"
        description="Conecte o Claude ao Planaut com o seu login: a IA configura empresas, perfis e regras, envia modelos de planilha e gera as planilhas a partir dos arquivos do seu computador."
        badge={<Badge variant="warning" size="sm">Administrador · Contador Sênior</Badge>}
      />

      <Card
        title="Claude Desktop"
        subtitle="O caminho recomendado: a extensão instala com dois cliques e o Claude Desktop guarda a senha criptografada no cofre do sistema."
        headerAction={<Badge variant="success" size="sm">Recomendado</Badge>}
      >
        <ol className="space-y-6">
          <Passo numero={1} titulo="Baixe a extensão">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={CONNECTOR_DESKTOP_URL}
                rel="noopener noreferrer"
                className={clsx(
                  downloadLinkClass,
                  'bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 hover:from-blue-500 hover:via-blue-600 hover:to-indigo-600 text-white shadow-xs border border-blue-500/20',
                )}
              >
                <Download className="w-4 h-4" />
                Baixar {CONNECTOR_DESKTOP_FILE}
              </a>
              <span className="text-[11px] text-slate-500">
                Sempre a versão publicada mais recente, gerada com o mesmo motor de cálculo do site
                {versaoSite ? ` (site na versão ${versaoSite})` : ''}.
              </span>
            </div>
          </Passo>

          <Passo numero={2} titulo="Instale no Claude Desktop">
            <p>
              Dê dois cliques no arquivo baixado e clique em <strong>Instalar</strong>. Também dá para arrastar o arquivo
              para a janela de Configurações do Claude Desktop ou usar{' '}
              <strong>Configurações → Extensões → Configurações avançadas → Instalar extensão…</strong>
            </p>
          </Passo>

          <Passo numero={3} titulo="Preencha os campos da extensão">
            <div className="grid gap-2.5 md:grid-cols-2">
              <Campo nome="E-mail do Planaut" valor={email || undefined}>
                {email ? 'O seu e-mail de acesso. A IA terá as mesmas permissões do seu usuário.' : `O e-mail que você usa para entrar no Planaut (ex.: ${EMAIL_PLACEHOLDER}).`}
              </Campo>
              <Campo nome="Senha do Planaut">
                A mesma senha do site. É digitada só na extensão: o Claude Desktop a guarda criptografada no cofre do
                sistema (Keychain no macOS, Gerenciador de Credenciais no Windows).
              </Campo>
              <Campo nome="Pastas dos arquivos fiscais">
                Onde ficam os XML, ZIP e SPED dos clientes e os .xlsx de modelos que você for enviar. O conector não lê
                nem grava fora delas.
              </Campo>
              <Campo nome="Pasta das planilhas geradas">
                Opcional. Em branco, cada planilha é gravada na pasta dos XML usados.
              </Campo>
              <div className="md:col-span-2">
                <Campo nome="Endereço do Planaut" valor={planautUrl}>
                  {usaEnderecoPadrao ? (
                    'Já vem preenchido na extensão; não precisa mudar.'
                  ) : (
                    <span className="text-amber-700 font-semibold">
                      Este ambiente não usa o endereço padrão: troque o campo pelo endereço acima.
                    </span>
                  )}
                </Campo>
              </div>
            </div>
          </Passo>

          <Passo numero={4} titulo="Teste a conexão">
            <p>
              Ative a extensão e, numa conversa nova, peça <em>“Mostre o status do Planaut.”</em> A resposta traz o
              usuário conectado e a versão do conector. Quando sair uma versão nova do Planaut, baixe e instale a extensão
              de novo pelo botão acima.
            </p>
          </Passo>
        </ol>
      </Card>

      <Card
        title="Claude Code e outros clientes MCP"
        subtitle="Para quem usa o terminal: o mesmo servidor num arquivo só. Precisa do Node.js 20 ou mais recente."
        collapsible
        defaultOpen={false}
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sistema do computador">
            {([
              ['windows', 'Windows (PowerShell)', Laptop],
              ['unix', 'macOS / Linux', Terminal],
            ] as const).map(([id, rotulo, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={platform === id}
                onClick={() => setPlatform(id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                  platform === id ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 bg-slate-100 hover:bg-slate-200/80',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {rotulo}
              </button>
            ))}
          </div>

          <ol className="space-y-6">
            <Passo numero={1} titulo="Baixe o servidor">
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={CONNECTOR_SERVER_URL}
                  rel="noopener noreferrer"
                  className={clsx(downloadLinkClass, 'border border-slate-300/90 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs')}
                >
                  <Download className="w-4 h-4" />
                  Baixar {CONNECTOR_SERVER_FILE}
                </a>
                <span className="text-[11px] text-slate-500">
                  Salve em <code className="font-mono text-slate-700">{pastaDoServidor}</code> (ou ajuste o caminho nos
                  comandos abaixo).
                </span>
              </div>
            </Passo>

            <Passo numero={2} titulo={platform === 'windows' ? 'Adicione no Claude Code (PowerShell)' : 'Adicione no Claude Code (terminal)'}>
              <p>
                Troque <code className="font-mono text-slate-800">{PASSWORD_PLACEHOLDER}</code> pela sua senha, mantendo as
                aspas simples, e a pasta dos clientes pela sua. Com <code className="font-mono">--scope user</code> o
                conector vale em todos os seus projetos.
              </p>
              <CodeBlock value={comandoClaudeCode} label="Copiar comando do Claude Code" />
              <p className="text-amber-800 bg-amber-50 ring-1 ring-amber-600/15 rounded-lg px-3 py-2">
                O Claude Code grava esses valores, inclusive a senha, na configuração dele neste computador
                (<code className="font-mono">~/.claude.json</code>), sem criptografia. Em computador compartilhado, prefira
                a extensão do Claude Desktop.
              </p>
            </Passo>

            <Passo numero={3} titulo="Outros clientes MCP (configuração em JSON)">
              <CodeBlock value={configJson} label="Copiar configuração JSON" />
              <p>
                Opcionais: <code className="font-mono">PLANAUT_PASTA_SAIDA</code> (pasta das planilhas geradas) e{' '}
                <code className="font-mono">PLANAUT_PASTAS</code> (pastas liberadas separadas por “;”, no lugar dos
                argumentos).
              </p>
            </Passo>
          </ol>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="O que a IA consegue fazer" subtitle="As mesmas ações do site, com as permissões do seu usuário.">
          <ul className="space-y-3.5">
            {CAPACIDADES.map(({ icon: Icon, titulo, texto }) => (
              <li key={titulo} className="flex gap-3">
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
                <div>
                  <p className="text-xs font-bold text-slate-900">{titulo}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{texto}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Segurança" subtitle="O que o conector faz com os seus dados.">
          <ul className="space-y-3.5">
            {SEGURANCA.map(({ icon: Icon, texto }) => (
              <li key={texto} className="flex gap-3">
                <Icon className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <p className="text-xs text-slate-600 leading-relaxed">{texto}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Exemplos de pedidos" subtitle="Escreva como falaria com um colega; a IA escolhe as ferramentas.">
        <ul className="divide-y divide-slate-100">
          {exemplos(platform).map((exemplo) => (
            <li key={exemplo} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <p className="text-xs text-slate-700 leading-relaxed">{exemplo}</p>
              <CopyButton value={exemplo} label="Copiar exemplo" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};
