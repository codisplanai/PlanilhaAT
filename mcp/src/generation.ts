import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PLANILHA_LABELS } from '../../frontend/src/constants/domain.ts';
import type { PlanautApi } from './api.ts';
import {
  processFiscalLocally,
  type Convenio5291Decision,
  type Convenio5291Pendencia,
  type CteSemNfePendencia,
  type LocalProcessingContext,
  type LocalProcessingResult,
  type LocalTemplateDescriptor,
  type MvaDecision,
  type MvaPending,
  type NotaBonificacaoPendencia,
  type Solicitacao,
  type TipoPlanilha,
  type UsoConsumoPending,
} from './engine.ts';
import {
  FileAccessError,
  type FolderPolicy,
  type FoundFile,
  MAX_SHEET_FILE_BYTES,
  MAX_SPED_FILE_BYTES,
  MAX_XML_FILE_BYTES,
  MAX_XML_TOTAL_BYTES,
  expandPaths,
  formatBytes,
  looksLikeSped,
  toWebFile,
  writeUniqueFile,
} from './files.ts';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 30;
const LIST_PREVIEW = 40;

export type Etapa = 'ctes_sem_nfe' | 'uso_consumo' | 'bonificacao' | 'convenio_52_91' | 'mva';

export class GeracaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeracaoError';
  }
}

export interface GeracaoInput {
  empresaId: number;
  periodoInicio: string;
  periodoFim: string;
  xmls: string[];
  speds: string[];
  planilhaEntrada: string | null;
  pastaSaida: string | null;
  recursivo: boolean;
}

export type BonusChoice = 'revenda' | 'ignorar' | 'uso_consumo';
export type UsoConsumoChoice = 'difal' | 'manter_regras';
export type ConvenioChoice = 'aplicar' | 'nao_aplicar' | 'anexo_i';

export interface DecisoesInput {
  ignorarCtesSemNfe?: boolean;
  adicionarXmls?: string[];
  usoConsumo?: Record<string, UsoConsumoChoice>;
  bonificacao?: Record<string, BonusChoice>;
  convenio5291?: Record<string, ConvenioChoice>;
  mva?: Record<string, { mva_percentual: number | null; justificativa: string }>;
}

interface PendingRef {
  etapa: Etapa;
  engineKey: string;
  /** Só para validar a resposta (ex.: Anexo I alternativo permitido). */
  permiteAnexoI?: boolean;
}

interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  input: GeracaoInput;
  running: boolean;
  finished: boolean;
  ignoreMissingCteNotes: boolean;
  usoConsumo: Record<string, boolean>;
  bonus: Record<string, boolean>;
  /** As chaves de bonificação conhecidas e a impressão dos arquivos quando foram listadas. */
  bonusKeys: string[] | null;
  bonusFingerprint: string | null;
  convenio: Record<string, Convenio5291Decision>;
  mva: Record<string, MvaDecision>;
  refs: Map<string, PendingRef>;
  refByEngineKey: Map<string, string>;
  counters: Record<Etapa, number>;
  pending: { etapa: Etapa; ids: string[] } | null;
  empresaResumo: string | null;
  /** Indústria troca "revenda" por "ignorar" na bonificação (mesmo valor no motor). */
  industria: boolean | null;
}

const ETAPA_PREFIX: Record<Etapa, string> = {
  ctes_sem_nfe: 'T',
  uso_consumo: 'U',
  bonificacao: 'B',
  convenio_52_91: 'C',
  mva: 'M',
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Mesmo critério do `formatPercent` do site: valores até 1 são frações. */
export function toPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const num = Number(value);
  return Math.round((Math.abs(num) <= 1 ? num * 100 : num) * 10_000) / 10_000;
}

function noteLabel(numero: string | null | undefined, serie?: string | null): string {
  const n = String(numero ?? '').trim() || '?';
  return serie ? `${n}/${serie}` : n;
}

function preview<T>(items: T[]): { itens: T[]; total: number; omitidos: number } {
  return { itens: items.slice(0, LIST_PREVIEW), total: items.length, omitidos: Math.max(0, items.length - LIST_PREVIEW) };
}

function sha256Hex(buffer: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Converte "AAAA-MM" no primeiro e no último dia do mês. */
export function monthPeriod(competencia: string): { inicio: string; fim: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!match) throw new GeracaoError('Competência deve estar no formato AAAA-MM (ex.: 2026-10).');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new GeracaoError('Mês da competência inválido.');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { inicio: `${year}-${mm}-01`, fim: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

export function validatePeriod(inicio: string, fim: string): void {
  if (!validIsoDate(inicio) || !validIsoDate(fim)) {
    throw new GeracaoError('Datas do período devem estar no formato AAAA-MM-DD.');
  }
  if (fim < inicio) throw new GeracaoError('A data final do período não pode ser anterior à data inicial.');
}

interface CollectedInputs {
  xml: FoundFile[];
  sped: FoundFile[];
  entrySheet: FoundFile | null;
  fingerprint: string;
}

export class GeracaoManager {
  private readonly sessions = new Map<string, Session>();
  private readonly templateCache = new Map<string, ArrayBuffer>();
  private readonly api: PlanautApi;
  private readonly policy: FolderPolicy;
  private readonly defaultOutputDir: string | null;

  constructor(api: PlanautApi, policy: FolderPolicy, defaultOutputDir: string | null) {
    this.api = api;
    this.policy = policy;
    this.defaultOutputDir = defaultOutputDir;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.sessions.delete(oldest.id);
    }
  }

  private session(id: string): Session {
    this.prune();
    const session = this.sessions.get(id.trim());
    if (!session) {
      throw new GeracaoError(
        `Geração "${id}" não encontrada. Ela pode ter expirado ou o servidor MCP foi reiniciado; `
        + 'comece de novo com gerar_planilhas (as decisões precisarão ser confirmadas novamente).',
      );
    }
    return session;
  }

  async start(input: GeracaoInput): Promise<Record<string, unknown>> {
    validatePeriod(input.periodoInicio, input.periodoFim);
    if (input.xmls.length === 0 && input.speds.length === 0) {
      throw new GeracaoError('Informe os XMLs de NF-e/CT-e (arquivos, ZIPs ou pastas), o(s) SPED Fiscal, ou ambos.');
    }
    this.prune();
    const session: Session = {
      id: `g-${randomBytes(4).toString('hex')}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      input,
      running: false,
      finished: false,
      ignoreMissingCteNotes: false,
      usoConsumo: {},
      bonus: {},
      bonusKeys: null,
      bonusFingerprint: null,
      convenio: {},
      mva: {},
      refs: new Map(),
      refByEngineKey: new Map(),
      counters: { ctes_sem_nfe: 0, uso_consumo: 0, bonificacao: 0, convenio_52_91: 0, mva: 0 },
      pending: null,
      empresaResumo: null,
      industria: null,
    };
    this.sessions.set(session.id, session);
    try {
      return await this.run(session);
    } catch (error) {
      // Falha antes de qualquer pendência: não há o que retomar.
      if (!session.pending) this.sessions.delete(session.id);
      throw error;
    }
  }

  async answer(id: string, decisoes: DecisoesInput): Promise<Record<string, unknown>> {
    const session = this.session(id);
    if (session.finished) {
      throw new GeracaoError('Esta geração já foi concluída. Para gerar de novo, chame gerar_planilhas.');
    }
    if (session.running) throw new GeracaoError('Esta geração já está em andamento.');
    try {
      await this.applyDecisions(session, decisoes);
    } catch (error) {
      if (error instanceof FileAccessError) throw new GeracaoError(error.message);
      throw error;
    }
    return this.run(session);
  }

  cancel(id: string): Record<string, unknown> {
    const session = this.session(id);
    if (session.running) throw new GeracaoError('A geração está em andamento; aguarde o término para cancelar.');
    this.sessions.delete(session.id);
    return {
      status: 'cancelada',
      geracao_id: session.id,
      mensagem: 'Geração cancelada. Nada foi registrado no histórico do Planaut e nenhuma planilha foi gravada.',
    };
  }

  private resolveRef(session: Session, id: string, etapa: Etapa): PendingRef {
    const ref = session.refs.get(id.trim().toUpperCase());
    if (!ref || ref.etapa !== etapa) {
      throw new GeracaoError(`Pendência "${id}" não pertence à etapa ${etapa} desta geração. Use os ids devolvidos na última resposta.`);
    }
    return ref;
  }

  /**
   * Valida tudo antes de gravar: uma decisão inválida no meio da lista não
   * deixa a geração com metade das respostas aplicadas, e um caminho extra
   * inexistente não fica preso na geração quebrando as próximas tentativas.
   */
  private async applyDecisions(session: Session, decisoes: DecisoesInput): Promise<void> {
    const extraXmls: string[] = [];
    for (const raw of decisoes.adicionarXmls ?? []) {
      await this.policy.resolveExisting(raw);
      extraXmls.push(raw);
    }

    const usoConsumo: Record<string, boolean> = {};
    for (const [id, choice] of Object.entries(decisoes.usoConsumo ?? {})) {
      const ref = this.resolveRef(session, id, 'uso_consumo');
      if (choice !== 'difal' && choice !== 'manter_regras') {
        throw new GeracaoError(`Decisão de uso e consumo inválida para ${id}: use "difal" ou "manter_regras".`);
      }
      usoConsumo[ref.engineKey] = choice === 'difal';
    }

    const bonus: Record<string, boolean> = {};
    for (const [id, choice] of Object.entries(decisoes.bonificacao ?? {})) {
      const ref = this.resolveRef(session, id, 'bonificacao');
      if (choice !== 'revenda' && choice !== 'ignorar' && choice !== 'uso_consumo') {
        throw new GeracaoError(`Decisão de bonificação inválida para ${id}: use "revenda", "ignorar" ou "uso_consumo".`);
      }
      // No motor, "revenda" (comércio) e "ignorar" (indústria) são o mesmo valor:
      // aceitar a opção da outra atividade faria o item ir para onde o usuário não pediu.
      if (choice === 'revenda' && session.industria === true) {
        throw new GeracaoError(`A empresa é industrial: para ${id} use "ignorar" ou "uso_consumo" (indústria não recolhe Antecipação Parcial).`);
      }
      if (choice === 'ignorar' && session.industria === false) {
        throw new GeracaoError(`A empresa é comercial: para ${id} use "revenda" (Antecipação Parcial) ou "uso_consumo" (DIFAL).`);
      }
      // Contrato do motor: true = não é uso/consumo (revenda; na indústria, ignorar).
      bonus[ref.engineKey] = choice !== 'uso_consumo';
    }

    const convenio: Record<string, Convenio5291Decision> = {};
    for (const [id, choice] of Object.entries(decisoes.convenio5291 ?? {})) {
      const ref = this.resolveRef(session, id, 'convenio_52_91');
      if (choice !== 'aplicar' && choice !== 'nao_aplicar' && choice !== 'anexo_i') {
        throw new GeracaoError(`Decisão do Convênio 52/91 inválida para ${id}: use "aplicar", "nao_aplicar" ou "anexo_i".`);
      }
      if (choice === 'anexo_i' && !ref.permiteAnexoI) {
        throw new GeracaoError(`O item ${id} não admite a alternativa "anexo_i"; use "aplicar" ou "nao_aplicar".`);
      }
      convenio[ref.engineKey] = choice === 'anexo_i' ? 'anexo_i' : choice === 'aplicar';
    }

    const mva: Record<string, MvaDecision> = {};
    for (const [id, value] of Object.entries(decisoes.mva ?? {})) {
      const ref = this.resolveRef(session, id, 'mva');
      const justificativa = String(value?.justificativa ?? '').trim();
      if (justificativa.length < 5 || justificativa.length > 500) {
        throw new GeracaoError(`A MVA do item ${id} exige justificativa fiscal entre 5 e 500 caracteres.`);
      }
      const percentual = value?.mva_percentual;
      if (percentual !== null && (typeof percentual !== 'number' || !Number.isFinite(percentual) || percentual < 0 || percentual > 10_000)) {
        throw new GeracaoError(`MVA inválida para ${id}: informe o percentual (ex.: 45.5 para 45,5%) ou null para manter pendente.`);
      }
      mva[ref.engineKey] = { mva: percentual ?? null, justificativa };
    }

    if (extraXmls.length) session.input = { ...session.input, xmls: [...session.input.xmls, ...extraXmls] };
    if (decisoes.ignorarCtesSemNfe === true) session.ignoreMissingCteNotes = true;
    Object.assign(session.usoConsumo, usoConsumo);
    Object.assign(session.bonus, bonus);
    Object.assign(session.convenio, convenio);
    Object.assign(session.mva, mva);
  }

  private refFor(session: Session, etapa: Etapa, engineKey: string, extra: Partial<PendingRef> = {}): string {
    const composite = `${etapa}|${engineKey}`;
    let id = session.refByEngineKey.get(composite);
    if (!id) {
      session.counters[etapa] += 1;
      id = `${ETAPA_PREFIX[etapa]}${session.counters[etapa]}`;
      session.refByEngineKey.set(composite, id);
    }
    session.refs.set(id, { etapa, engineKey, ...extra });
    return id;
  }

  /**
   * Expande os caminhos informados. Arquivo citado diretamente precisa ser do
   * tipo esperado (erro claro se não for); de pastas, só entram os arquivos do
   * tipo esperado e o resto é ignorado.
   */
  private async expand(
    inputs: string[],
    recursive: boolean,
    accept: (file: FoundFile) => Promise<boolean> | boolean,
    rejectMessage: (file: FoundFile) => string,
  ): Promise<FoundFile[]> {
    const result: FoundFile[] = [];
    const seen = new Set<string>();
    for (const raw of inputs) {
      const real = await this.policy.resolveExisting(raw);
      const explicit = (await fs.stat(real)).isFile();
      for (const file of await expandPaths(this.policy, [real], { recursive })) {
        if (seen.has(file.path)) continue;
        if (!(await accept(file))) {
          if (explicit) throw new GeracaoError(rejectMessage(file));
          continue;
        }
        seen.add(file.path);
        result.push(file);
      }
    }
    return result;
  }

  private async collect(input: GeracaoInput): Promise<CollectedInputs> {
    const xml = await this.expand(
      input.xmls,
      input.recursivo,
      (file) => file.kind === 'xml' || file.kind === 'zip',
      (file) => `Use apenas .xml ou .zip em "xmls": ${file.name}.`,
    );
    for (const file of xml) {
      if (file.size === 0) throw new GeracaoError(`O arquivo ${file.name} está vazio.`);
      if (file.size > MAX_XML_FILE_BYTES) {
        throw new GeracaoError(`O arquivo ${file.name} tem ${formatBytes(file.size)}; o limite por XML/ZIP é ${formatBytes(MAX_XML_FILE_BYTES)}.`);
      }
    }
    const xmlTotal = xml.reduce((sum, file) => sum + file.size, 0);
    if (xmlTotal > MAX_XML_TOTAL_BYTES) {
      throw new GeracaoError(`O conjunto de XMLs/ZIPs soma ${formatBytes(xmlTotal)}; o limite é ${formatBytes(MAX_XML_TOTAL_BYTES)}. Divida o período ou os arquivos.`);
    }

    const sped = await this.expand(
      input.speds,
      input.recursivo,
      async (file) => file.kind === 'sped' && file.size > 0 && (await looksLikeSped(file.path)),
      (file) => (file.kind !== 'sped'
        ? `SPED Fiscal deve ser um arquivo .txt: ${file.name}.`
        : `O arquivo ${file.name} não parece um SPED Fiscal (não começa com o registro |0000|).`),
    );
    for (const file of sped) {
      if (file.size > MAX_SPED_FILE_BYTES) {
        throw new GeracaoError(`O SPED ${file.name} tem ${formatBytes(file.size)}; o limite é ${formatBytes(MAX_SPED_FILE_BYTES)}.`);
      }
    }

    let entrySheet: FoundFile | null = null;
    if (input.planilhaEntrada) {
      const [file] = await expandPaths(this.policy, [input.planilhaEntrada]);
      const lower = file?.name.toLowerCase() ?? '';
      if (!file || !(lower.endsWith('.xlsx') || lower.endsWith('.xls'))) {
        throw new GeracaoError('A planilha de entrada (contábil) deve ser um arquivo .xlsx ou .xls.');
      }
      if (file.size === 0 || file.size > MAX_SHEET_FILE_BYTES) {
        throw new GeracaoError(`A planilha de entrada está vazia ou passa de ${formatBytes(MAX_SHEET_FILE_BYTES)}.`);
      }
      entrySheet = file;
    }

    if (xml.length === 0 && sped.length === 0) {
      throw new GeracaoError('Nenhum XML/ZIP ou SPED Fiscal foi encontrado nos caminhos informados.');
    }

    const fingerprint = createHash('sha1')
      .update([...xml, ...sped, ...(entrySheet ? [entrySheet] : [])]
        .map((file) => `${file.path}|${file.size}|${file.modifiedAt.getTime()}`)
        .join('\n'))
      .digest('hex');
    return { xml, sped, entrySheet, fingerprint };
  }

  private async loadTemplate(template: LocalTemplateDescriptor): Promise<ArrayBuffer> {
    const expected = (template.arquivo_hash ?? '').trim().toLowerCase();
    const cacheKey = `${template.id}|${expected}`;
    const cached = this.templateCache.get(cacheKey);
    if (cached) return cached.slice(0);
    let bytes: ArrayBuffer;
    try {
      bytes = await this.api.getBytes(`/templates/${template.id}/arquivo`);
    } catch (error) {
      throw new GeracaoError(
        `Não foi possível carregar o modelo oficial ${template.tipo} v${template.versao}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (expected && sha256Hex(bytes) !== expected) {
      throw new GeracaoError(
        `O modelo oficial ${template.tipo} v${template.versao} recebido não corresponde à versão ativa. `
        + 'O processamento foi bloqueado para evitar gerar uma planilha a partir do arquivo errado.',
      );
    }
    this.templateCache.set(cacheKey, bytes);
    return bytes.slice(0);
  }

  private async execute(
    session: Session,
    context: LocalProcessingContext,
    files: { xml: File[]; sped: File[]; entrySheet: File | null },
    withBonus: boolean,
  ): Promise<LocalProcessingResult> {
    const { input } = session;
    return processFiscalLocally(
      {
        solicitacaoId: session.id,
        periodoInicio: input.periodoInicio,
        periodoFim: input.periodoFim,
        context,
        input: { xmlFiles: files.xml, spedFiles: files.sped, entrySheet: files.entrySheet },
        bonusDecisions: withBonus ? { ...session.bonus } : undefined,
        usoConsumoDecisions: { ...session.usoConsumo },
        convenio5291Decisions: { ...session.convenio },
        reviewPendingMva: true,
        mvaDecisions: { ...session.mva },
        ignoreMissingCteNotes: session.ignoreMissingCteNotes,
      },
      new Map(),
      (template) => this.loadTemplate(template),
    );
  }

  private async run(session: Session): Promise<Record<string, unknown>> {
    if (session.running) throw new GeracaoError('Esta geração já está em andamento.');
    session.running = true;
    session.updatedAt = Date.now();
    try {
      const collected = await this.collect(session.input);
      const context = await this.api.get<LocalProcessingContext>('/processamento-local/contexto', {
        empresa_id: session.input.empresaId,
      });
      const empresa = context.empresa;
      session.industria = empresa.atividade === 'industria';
      session.empresaResumo = `${empresa.razao_social} (CNPJ ${empresa.cnpj}, ${empresa.uf}${empresa.atividade === 'industria' ? ', indústria' : ''}${empresa.optante_simples_nacional ? ', Simples Nacional' : ''})`;

      const files = {
        xml: await Promise.all(collected.xml.map(toWebFile)),
        sped: await Promise.all(collected.sped.map(toWebFile)),
        entrySheet: collected.entrySheet ? await toWebFile(collected.entrySheet) : null,
      };

      // Bonificação é a única etapa em que o motor não filtra as notas já
      // decididas: com o mapa presente, nota sem decisão seguiria a regra de
      // CFOP em silêncio. Por isso o mapa só vai ao motor quando cobre todas as
      // notas listadas para os mesmos arquivos.
      let bonusReady = session.bonusKeys !== null
        && session.bonusFingerprint === collected.fingerprint
        && session.bonusKeys.every((key) => typeof session.bonus[key] === 'boolean');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await this.execute(session, context, files, bonusReady);
        const pre = result.preAnalysis;
        if (pre.requer_decisao && pre.notas_bonificacao.length > 0 && !bonusReady) {
          const keys = pre.notas_bonificacao.map((nota) => nota.chave_acesso || nota.numero_nota);
          session.bonusKeys = keys;
          session.bonusFingerprint = collected.fingerprint;
          if (keys.every((key) => typeof session.bonus[key] === 'boolean')) {
            bonusReady = true;
            continue;
          }
          return this.pendingResponse(session, context, 'bonificacao', pre.notas_bonificacao);
        }
        if (pre.requer_decisao) {
          if (pre.ctes_sem_nfe?.length) return this.pendingResponse(session, context, 'ctes_sem_nfe', pre.ctes_sem_nfe);
          if (pre.notas_uso_consumo?.length) return this.pendingResponse(session, context, 'uso_consumo', pre.notas_uso_consumo);
          if (pre.itens_convenio_52_91.length) return this.pendingResponse(session, context, 'convenio_52_91', pre.itens_convenio_52_91);
          if (pre.itens_mva?.length) return this.pendingResponse(session, context, 'mva', pre.itens_mva);
          throw new GeracaoError('O motor pediu uma decisão que este servidor MCP não reconhece. Gere esta planilha pelo site.');
        }
        return await this.finish(session, context, collected, result);
      }
      throw new GeracaoError('Não foi possível estabilizar as decisões de bonificação. Gere esta planilha pelo site.');
    } catch (error) {
      if (error instanceof FileAccessError) throw new GeracaoError(error.message);
      throw error;
    } finally {
      session.running = false;
      session.updatedAt = Date.now();
    }
  }

  private pendingResponse(
    session: Session,
    context: LocalProcessingContext,
    etapa: Etapa,
    items: unknown[],
  ): Record<string, unknown> {
    const industria = context.empresa.atividade === 'industria';
    let pendencias: Array<Record<string, unknown>> = [];
    let instrucao = '';
    let responder = '';

    switch (etapa) {
      case 'ctes_sem_nfe': {
        pendencias = (items as CteSemNfePendencia[]).map((cte) => ({
          cte: noteLabel(cte.cte_numero, cte.cte_serie),
          chave_cte: cte.cte_chave_acesso,
          transportadora: cte.nome_emitente || null,
          cnpj_transportadora: cte.cnpj_emitente || null,
          valor_frete: round2(cte.valor_total),
          nfes_faltantes: cte.nfes_faltantes.map((nfe) => ({
            nota: noteLabel(nfe.numero_nota, nfe.serie),
            chave: nfe.chave_acesso,
          })),
        }));
        instrucao = 'Há CT-e(s) cujas NF-e(s) originárias não estão entre os XMLs. Sem elas o frete não pode ser rateado. '
          + 'Pergunte ao usuário se ele vai fornecer os XMLs dessas NF-e(s) ou se quer continuar sem elas.';
        responder = 'responder_pendencias com adicionar_xmls (caminhos dos XMLs/ZIP das NF-e faltantes; se o usuário os copiou para a mesma pasta, '
          + 'basta chamar responder_pendencias sem decisões) ou com ignorar_ctes_sem_nfe=true.';
        break;
      }
      case 'uso_consumo': {
        pendencias = (items as UsoConsumoPending[]).map((nota) => ({
          id: this.refFor(session, 'uso_consumo', nota.key),
          nota: noteLabel(nota.numeroNota, nota.serie),
          chave: nota.chaveAcesso,
          fornecedor: nota.fornecedor,
          cnpj_fornecedor: nota.cnpj,
          itens: nota.quantidadeItens,
          valor_total: round2(nota.valorTotal),
        }));
        instrucao = 'Notas de fornecedores cadastrados como "uso e consumo (confirmação)" nesta empresa. '
          + 'Para cada nota, o usuário decide: "difal" (todos os itens vão para a DIFAL) ou "manter_regras" (segue a classificação fiscal normal).';
        responder = 'responder_pendencias com uso_consumo: { "<id>": "difal" | "manter_regras" } para cada nota.';
        break;
      }
      case 'bonificacao': {
        pendencias = (items as NotaBonificacaoPendencia[]).map((nota) => {
          const key = nota.chave_acesso || nota.numero_nota;
          const sugestao: BonusChoice = industria ? 'uso_consumo' : nota.sugestao_revenda ? 'revenda' : 'uso_consumo';
          const decided = session.bonus[key];
          return {
            id: this.refFor(session, 'bonificacao', key),
            nota: noteLabel(nota.numero_nota, nota.serie),
            chave: nota.chave_acesso,
            emitente: nota.nome_emitente || null,
            cnpj_emitente: nota.cnpj_emitente || null,
            cfops: nota.cfops,
            valor_total: round2(nota.valor_total),
            tem_credito_icms: nota.tem_credito,
            sugestao_do_sistema: sugestao,
            motivo_sugestao: industria ? 'Indústria: o crédito não indica a destinação; confirme item a item.' : nota.motivo_sugestao,
            ...(typeof decided === 'boolean'
              ? { decisao_registrada: decided ? (industria ? 'ignorar' : 'revenda') : 'uso_consumo' }
              : {}),
          };
        });
        instrucao = industria
          ? 'Empresa industrial com entradas em CFOP 6910/6911/6949 (bonificação, amostra, outras). Para cada nota, o usuário decide: '
            + '"uso_consumo" (vai para a DIFAL) ou "ignorar" (não entra na apuração).'
          : 'Entradas em CFOP 6910/6911/6949 (bonificação, amostra, outras). Para cada nota, o usuário decide: '
            + '"revenda" (Antecipação Parcial) ou "uso_consumo" (DIFAL). A sugestão do sistema é só referência: confirme com o usuário.';
        responder = `responder_pendencias com bonificacao: { "<id>": ${industria ? '"ignorar" | "uso_consumo"' : '"revenda" | "uso_consumo"'} } para TODAS as notas listadas (decisões parciais não liberam a etapa).`;
        break;
      }
      case 'convenio_52_91': {
        pendencias = (items as Convenio5291Pendencia[]).map((item) => ({
          id: this.refFor(session, 'convenio_52_91', item.decision_key, { permiteAnexoI: Boolean(item.alternativa_anexo_i) }),
          anexo: item.anexo ?? 'I',
          nota: noteLabel(item.numero_nota, item.serie),
          chave: item.chave_acesso,
          item: item.item_numero,
          fornecedor: item.fornecedor ?? null,
          uf_origem: item.uf_origem ?? null,
          ncm: item.ncm,
          descricao: item.descricao,
          item_legal: item.item_legal ?? null,
          descricao_legal: item.descricao_legal ?? null,
          cst: item.cst,
          p_icms_percentual: toPercent(item.p_icms),
          p_red_bc_percentual: toPercent(item.p_red_bc),
          carga_efetiva_xml_percentual: toPercent(item.carga_efetiva_xml),
          ...(item.anexo === 'II'
            ? {
              carga_origem_convenio_percentual: toPercent(item.carga_origem_convenio),
              carga_interna_convenio_percentual: toPercent(item.carga_interna_convenio ?? 0.056),
            }
            : {}),
          motivo: item.motivo,
          sugestao_do_sistema: item.sugestao_aplicar ? 'aplicar' : 'nao_aplicar',
          aceita_anexo_i: Boolean(item.alternativa_anexo_i),
          grupo_identico: `${item.anexo ?? 'I'}|${item.ncm}|${item.descricao_normalizada}`,
        }));
        instrucao = 'Itens com possível redução de base pelo Convênio ICMS 52/91 que o sistema não pode decidir sozinho. '
          + 'Para cada item, o usuário decide "aplicar" (aplica o anexo indicado), "nao_aplicar" ou, quando aceita_anexo_i=true, "anexo_i". '
          + 'Itens com o mesmo grupo_identico costumam receber a mesma decisão, mas confirme com o usuário.';
        responder = 'responder_pendencias com convenio_52_91: { "<id>": "aplicar" | "nao_aplicar" | "anexo_i" } para cada item.';
        break;
      }
      case 'mva': {
        pendencias = (items as MvaPending[]).map((item) => ({
          id: this.refFor(session, 'mva', item.key),
          nota: item.numeroNota,
          chave: item.chaveAcesso,
          item: item.itemNumero,
          descricao: item.descricao,
          ncm: item.ncm,
          cest: item.cest || null,
          cfop: item.cfop,
          a_ori_percentual: toPercent(item.aOri),
          a_dst_percentual: toPercent(item.aDst),
          coluna_mva: item.column ?? 'indefinida',
          mva_no_xml_percentual: item.mvaXml,
          motivo: item.motivo,
          sugestoes: item.suggestions.map((s) => ({ rotulo: s.label, mva_percentual: s.value })),
        }));
        instrucao = 'Itens da Antecipação Tributária cuja MVA não pôde ser determinada pelo Anexo 1. '
          + 'Para cada item, o usuário informa a MVA em percentual (ex.: 45.5) com justificativa fiscal, '
          + 'ou mantém pendente (mva_percentual = null; o item fica fora da apuração).';
        responder = 'responder_pendencias com mva: { "<id>": { "mva_percentual": número | null, "justificativa": "texto de 5 a 500 caracteres" } }.';
        break;
      }
    }

    session.pending = {
      etapa,
      ids: pendencias.map((item) => String(item.id ?? '')).filter(Boolean),
    };
    return {
      status: 'aguardando_decisao',
      geracao_id: session.id,
      empresa: session.empresaResumo,
      periodo: `${session.input.periodoInicio} a ${session.input.periodoFim}`,
      etapa,
      instrucao: `${instrucao} Nunca decida no lugar do usuário: apresente as pendências e registre a resposta dele.`,
      como_responder: responder,
      total_pendencias: pendencias.length,
      pendencias,
      decisoes_registradas: {
        uso_consumo: Object.keys(session.usoConsumo).length,
        bonificacao: Object.keys(session.bonus).length,
        convenio_52_91: Object.keys(session.convenio).length,
        mva: Object.keys(session.mva).length,
        ignorar_ctes_sem_nfe: session.ignoreMissingCteNotes,
      },
    };
  }

  private async resolveOutputDir(session: Session): Promise<string> {
    const requested = session.input.pastaSaida ?? this.defaultOutputDir;
    if (requested) return this.policy.resolveOutputDir(requested);
    const first = session.input.xmls[0] ?? session.input.speds[0];
    const real = await this.policy.resolveExisting(first);
    const stat = await fs.stat(real);
    return this.policy.resolveOutputDir(stat.isDirectory() ? real : path.dirname(real));
  }

  private async finish(
    session: Session,
    context: LocalProcessingContext,
    collected: CollectedInputs,
    result: LocalProcessingResult,
  ): Promise<Record<string, unknown>> {
    const outputDir = await this.resolveOutputDir(session);

    const saidas = (Object.entries(result.rowsByDestination) as Array<[TipoPlanilha, NonNullable<LocalProcessingResult['rowsByDestination'][TipoPlanilha]>]>)
      .filter(([, rows]) => Boolean(rows?.length))
      .map(([tipo, rows]) => {
        const artifact = result.artifacts.find((item) => item.tipo === tipo);
        return {
          tipo,
          template_id: artifact?.templateId ?? null,
          total_notas: rows.length,
          total_valor_devido: rows.reduce((sum, row) => sum + Number(row.valor_devido), 0),
          aviso: artifact ? null : `Nenhum template ativo cadastrado para ${tipo}.`,
        };
      });

    // Mesmo contrato do site (buildPersistPayload): só dados estruturados,
    // nunca o conteúdo dos arquivos fiscais.
    const payload = {
      notas_processadas: result.notasProcessadas.map((note) => ({
        chave_acesso: note.chave_acesso,
        numero_nota: note.numero_nota,
        serie: note.serie,
        cnpj_emitente: note.cnpj_emitente,
        uf_emitente: note.uf_emitente,
        cnpj_destinatario: note.cnpj_destinatario,
        uf_destinatario: note.uf_destinatario,
        data_emissao: note.data_emissao,
        data_entrada: note.data_entrada,
        origem_data_entrada: note.origem_data_entrada,
        item_numero: note.item_numero,
        ncm: note.ncm,
        cfop: note.cfop,
        destino_planilha: note.destino_planilha,
        v_total: Number(note.v_total),
        base_calculo: Number(note.base_calculo),
        ipi_despesas: Number(note.ipi_despesas),
        a_ori: Number(note.a_ori),
        a_dst_resolvida: Number(note.a_dst_resolvida),
        debito: Number(note.debito),
        credito: Number(note.credito),
        valor_devido: Number(note.valor_devido),
        metadados_extras: note.metadados_extras as Record<string, unknown>,
      })),
      saidas,
      notas_ignoradas: result.notasIgnoradas,
      itens_excluidos: result.itensExcluidos,
      avisos_avaliacao: result.avisosAvaliacao,
      cfops_sem_regra: result.cfopsSemRegra,
      mensagem: result.mensagem ?? null,
    };

    const solicitacao = await this.api.post<Solicitacao>('/solicitacoes', {
      empresa_id: session.input.empresaId,
      periodo_inicio: session.input.periodoInicio,
      periodo_fim: session.input.periodoFim,
    });
    let persisted: Solicitacao;
    try {
      persisted = await this.api.post<Solicitacao>(
        `/processamento-local/solicitacoes/${solicitacao.id}/resultado`,
        payload,
        { timeoutMs: 120_000 },
      );
    } catch (error) {
      // Sem resultado registrado, a solicitação ficaria "pendente" para sempre no histórico.
      await this.api.delete(`/solicitacoes/${solicitacao.id}`).catch(() => undefined);
      throw error;
    }

    session.finished = true;
    session.pending = null;

    const gravadas: Array<Record<string, unknown>> = [];
    const falhas: string[] = [];
    for (const artifact of result.artifacts) {
      try {
        const filePath = await writeUniqueFile(outputDir, artifact.filename, artifact.bytes);
        gravadas.push({
          tipo: artifact.tipo,
          planilha: PLANILHA_LABELS[artifact.tipo] ?? artifact.tipo,
          arquivo: filePath,
          linhas: artifact.totalNotas,
          valor_devido: round2(artifact.totalValorDevido),
        });
      } catch (error) {
        falhas.push(`${artifact.filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const semTemplate = saidas.filter((saida) => saida.aviso).map((saida) => saida.aviso);
    const ignoradas = result.notasIgnoradas.map((nota) => ({
      nota: noteLabel(nota.numero_nota, nota.serie),
      chave: nota.chave_acesso ?? null,
      motivo: nota.motivo,
      arquivo: nota.arquivo ?? null,
    }));
    const excluidos = result.itensExcluidos.map((item) => ({
      nota: noteLabel(item.numero_nota, item.serie),
      item: item.item_numero,
      ncm: item.ncm,
      descricao: item.descricao,
      tipo_exclusao: item.tipo_exclusao,
      motivo: item.motivo,
      ...(item.valor_devido != null ? { valor_devido: round2(item.valor_devido) } : {}),
    }));
    const avisos = result.avisosAvaliacao.map((aviso) => ({
      nota: noteLabel(aviso.numero_nota, aviso.serie),
      item: aviso.item_numero,
      aviso: aviso.aviso,
    }));
    const fcp = Object.entries(result.fcpRowsByDestination ?? {})
      .filter(([, rows]) => Boolean(rows?.length))
      .map(([tipo, rows]) => ({
        tipo,
        linhas: rows!.length,
        valor_devido: round2(rows!.reduce((sum, row) => sum + Number(row.valor_devido), 0)),
      }));

    return {
      status: falhas.length ? 'concluida_com_falha_na_gravacao' : 'concluida',
      geracao_id: session.id,
      solicitacao_id: persisted.id,
      empresa: session.empresaResumo,
      periodo: `${session.input.periodoInicio} a ${session.input.periodoFim}`,
      pasta_saida: outputDir,
      planilhas: gravadas,
      ...(fcp.length ? { fcp_em_aba_separada: fcp } : {}),
      ...(falhas.length
        ? { falhas_gravacao: falhas, observacao: 'A apuração foi registrada no histórico, mas algumas planilhas não puderam ser gravadas. Gere novamente.' }
        : {}),
      ...(semTemplate.length ? { saidas_sem_template: semTemplate } : {}),
      mensagem: result.mensagem ?? null,
      arquivos_lidos: {
        xml_zip: collected.xml.length,
        sped: collected.sped.length,
        planilha_entrada: collected.entrySheet?.name ?? null,
      },
      resumo: {
        registros_processados: result.notasProcessadas.length,
        notas_ignoradas: ignoradas.length,
        itens_excluidos: excluidos.length,
        avisos: avisos.length,
        cfops_sem_regra: result.cfopsSemRegra,
      },
      notas_ignoradas: preview(ignoradas),
      itens_excluidos: preview(excluidos),
      avisos: preview(avisos),
      ...(context.empresa.optante_simples_nacional ? { simples_nacional: true } : {}),
    };
  }
}
