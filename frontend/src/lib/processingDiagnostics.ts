export type DiagnosticLevel = 'debug' | 'info' | 'warning' | 'error';
export type DiagnosticStatus =
  | 'em_andamento'
  | 'aguardando_decisao'
  | 'concluido'
  | 'concluido_com_avisos'
  | 'parcialmente_concluido'
  | 'cancelado'
  | 'falhou';

export interface DiagnosticEvent {
  sequence: number;
  timestamp: string;
  level: DiagnosticLevel;
  stage: string;
  message: string;
  durationMs?: number;
  context?: Record<string, unknown>;
  exception?: {
    type: string;
    message: string;
    cause?: string;
    stack?: string;
  };
}

export interface DiagnosticAttempt {
  attemptId: string;
  requestId?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: DiagnosticStatus;
  currentStage: string;
  input: {
    fileCount: number;
    totalBytes: number;
    files: Array<{ index: number; extension: string; sizeBytes: number; fingerprint: string }>;
  };
  summary: {
    read: number;
    processed: number;
    ignored: number;
    rejected: number;
    outputs: number;
    warnings: number;
    errors: number;
  };
  events: DiagnosticEvent[];
  truncatedEvents: number;
}

export interface DiagnosticSession {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  timezone: string;
  appVersion: string;
  limits: {
    maxNonErrorEventsPerAttempt: number;
    maxStringLength: number;
    errorsAreNeverDiscarded: true;
  };
  attempts: DiagnosticAttempt[];
}

export interface DiagnosticRecorder {
  attempt: DiagnosticAttempt;
  event: (
    level: DiagnosticLevel,
    stage: string,
    message: string,
    context?: Record<string, unknown>,
    durationMs?: number,
  ) => void;
  error: (stage: string, error: unknown, message?: string, context?: Record<string, unknown>) => void;
  stage: (stage: string, message: string, context?: Record<string, unknown>) => void;
  setSummary: (values: Partial<DiagnosticAttempt['summary']>) => void;
  finish: (status: DiagnosticStatus, message: string, context?: Record<string, unknown>) => void;
}

const MAX_NON_ERROR_EVENTS = 500;
const MAX_STRING_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

function redactSensitive(value: string): string {
  return value
    .replace(/\b\d{44}\b/g, (match) => `${match.slice(0, 4)}…${match.slice(-4)}`)
    .replace(/\b\d{14}\b/g, (match) => `${match.slice(0, 2)}…${match.slice(-4)}`)
    .replace(/\b\d{11}\b/g, (match) => `${match.slice(0, 3)}…${match.slice(-2)}`)
    .replace(/\b([\w.+-])[\w.+-]*@([\w.-]+)\b/g, '$1***@$2');
}

function truncate(value: string, limit = MAX_STRING_LENGTH): string {
  const redacted = redactSensitive(value);
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit)}… [truncado]`;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[profundidade limitada]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return truncate(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { type: value.name, message: truncate(value.message) };
  if (Array.isArray(value)) {
    const selected = value.slice(0, 50).map((item) => sanitize(item, depth + 1));
    if (value.length > 50) selected.push(`[${value.length - 50} item(ns) omitido(s)]`);
    return selected;
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      const normalized = key.toLowerCase();
      if (/token|password|senha|cookie|authorization|auth_header|secret/.test(normalized)) {
        output[key] = '[removido]';
      } else {
        output[key] = sanitize(nested, depth + 1);
      }
    }
    return output;
  }
  return truncate(String(value));
}

function errorDetails(error: unknown): DiagnosticEvent['exception'] {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error
      ? `${error.cause.name}: ${truncate(error.cause.message)}`
      : error.cause ? truncate(String(error.cause)) : undefined;
    return {
      type: error.name || 'Error',
      message: truncate(error.message || 'Erro sem mensagem.'),
      cause,
      stack: error.stack ? truncate(error.stack, MAX_STACK_LENGTH) : undefined,
    };
  }
  return { type: typeof error, message: truncate(String(error)) };
}

function fingerprintFile(file: File): string {
  const source = `${file.name}|${file.size}|${file.lastModified}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeFileMetadata(files: File[]): DiagnosticAttempt['input'] {
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    files: files.map((file, index) => ({
      index: index + 1,
      extension: file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '(sem extensão)',
      sizeBytes: file.size,
      fingerprint: fingerprintFile(file),
    })),
  };
}

export function createDiagnosticSession(appVersion: string): DiagnosticSession {
  return {
    schemaVersion: 1,
    sessionId: createId('diag'),
    createdAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    appVersion,
    limits: {
      maxNonErrorEventsPerAttempt: MAX_NON_ERROR_EVENTS,
      maxStringLength: MAX_STRING_LENGTH,
      errorsAreNeverDiscarded: true,
    },
    attempts: [],
  };
}

export function createDiagnosticRecorder(
  session: DiagnosticSession,
  files: File[],
  onChange: () => void,
): DiagnosticRecorder {
  const attempt: DiagnosticAttempt = {
    attemptId: createId('tentativa'),
    startedAt: new Date().toISOString(),
    status: 'em_andamento',
    currentStage: 'preparacao',
    input: safeFileMetadata(files),
    summary: { read: 0, processed: 0, ignored: 0, rejected: 0, outputs: 0, warnings: 0, errors: 0 },
    events: [],
    truncatedEvents: 0,
  };
  session.attempts.push(attempt);

  const append = (
    entry: Omit<DiagnosticEvent, 'sequence' | 'timestamp'>,
    options: { force?: boolean; countLevel?: boolean } = {},
  ) => {
    if (!options.force && entry.level !== 'error') {
      const nonErrors = attempt.events.filter((item) => item.level !== 'error').length;
      if (nonErrors >= MAX_NON_ERROR_EVENTS) {
        attempt.truncatedEvents += 1;
        onChange();
        return;
      }
    }
    attempt.events.push({
      ...entry,
      sequence: attempt.events.length + attempt.truncatedEvents + 1,
      timestamp: new Date().toISOString(),
      context: entry.context ? sanitize(entry.context) as Record<string, unknown> : undefined,
    });
    if (options.countLevel !== false && entry.level === 'warning') attempt.summary.warnings += 1;
    if (options.countLevel !== false && entry.level === 'error') attempt.summary.errors += 1;
    onChange();
  };

  const recorder: DiagnosticRecorder = {
    attempt,
    event: (level, stage, message, context, durationMs) => append({
      level,
      stage,
      message: truncate(message),
      context,
      durationMs,
    }),
    error: (stage, error, message, context) => append({
      level: 'error',
      stage,
      message: truncate(message ?? (error instanceof Error ? error.message : 'Falha inesperada.')),
      context,
      exception: errorDetails(error),
    }),
    stage: (stage, message, context) => {
      attempt.currentStage = stage;
      append({ level: 'info', stage, message: truncate(message), context });
    },
    setSummary: (values) => {
      attempt.summary = { ...attempt.summary, ...values };
      onChange();
    },
    finish: (status, message, context) => {
      if (attempt.finishedAt) return;
      attempt.status = status;
      attempt.currentStage = 'finalizado';
      attempt.finishedAt = new Date().toISOString();
      attempt.durationMs = Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt);
      append({
        level: status === 'falhou' ? 'error' : status === 'concluido' ? 'info' : 'warning',
        stage: 'finalizacao',
        message: truncate(message),
        context,
        durationMs: attempt.durationMs,
      }, { force: true, countLevel: false });
    },
  };

  recorder.event('info', 'preparacao', 'Tentativa de processamento iniciada.', {
    quantidadeArquivos: attempt.input.fileCount,
    tamanhoTotalBytes: attempt.input.totalBytes,
    arquivos: attempt.input.files,
  });
  return recorder;
}

export function cloneDiagnosticSession(session: DiagnosticSession): DiagnosticSession {
  return structuredClone(session);
}

function triggerDownload(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadDiagnosticJson(session: DiagnosticSession): void {
  triggerDownload(
    JSON.stringify(session, null, 2),
    `diagnostico_${session.sessionId}.json`,
    'application/json;charset=utf-8',
  );
}

export function diagnosticAsText(session: DiagnosticSession): string {
  const lines = [
    'PLANAut — Diagnóstico temporário de processamento',
    `Sessão: ${session.sessionId}`,
    `Criada em: ${session.createdAt} (${session.timezone})`,
    `Versão: ${session.appVersion}`,
    `Limites: até ${session.limits.maxNonErrorEventsPerAttempt} eventos não críticos por tentativa; erros são preservados.`,
    '',
  ];
  for (const attempt of session.attempts) {
    lines.push(
      `Tentativa: ${attempt.attemptId}`,
      `Solicitação: ${attempt.requestId ?? 'não criada'}`,
      `Estado: ${attempt.status}`,
      `Início: ${attempt.startedAt}`,
      `Fim: ${attempt.finishedAt ?? 'em andamento'}`,
      `Duração: ${attempt.durationMs ?? 0} ms`,
      `Resumo: lidos=${attempt.summary.read}; processados=${attempt.summary.processed}; ignorados=${attempt.summary.ignored}; rejeitados=${attempt.summary.rejected}; saídas=${attempt.summary.outputs}; avisos=${attempt.summary.warnings}; erros=${attempt.summary.errors}`,
      `Eventos truncados: ${attempt.truncatedEvents}`,
      'Eventos:',
    );
    for (const event of attempt.events) {
      lines.push(`[${event.sequence}] ${event.timestamp} ${event.level.toUpperCase()} [${event.stage}] ${event.message}`);
      if (event.durationMs !== undefined) lines.push(`  duração_ms=${event.durationMs}`);
      if (event.context) lines.push(`  contexto=${JSON.stringify(event.context)}`);
      if (event.exception) lines.push(`  exceção=${JSON.stringify(event.exception)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function downloadDiagnosticText(session: DiagnosticSession): void {
  triggerDownload(
    diagnosticAsText(session),
    `diagnostico_${session.sessionId}.txt`,
    'text/plain;charset=utf-8',
  );
}
