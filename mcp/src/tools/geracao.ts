import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { preencherDatasEntrada } from '../entryDates.ts';
import { expandPaths, formatBytes, type FoundFile } from '../files.ts';
import { monthPeriod } from '../generation.ts';
import { DESTRUCTIVE, READ_ONLY, WRITE, type ToolContext, safe } from './common.ts';

const SNIFF_BYTES = 12 * 1024;
const MAX_LISTED_FILES = 150;

type XmlKind = 'nfe' | 'cte' | 'evento' | 'inutilizacao' | 'desconhecido';

interface XmlSniff {
  kind: XmlKind;
  emissao: string | null;
  cnpjDestinatario: string | null;
  cnpjEmitente: string | null;
}

async function readHead(filePath: string, bytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

const tag = (name: string) => `<(?:[\\w-]+:)?${name}[\\s>]`;

/** Leitura superficial do começo do XML, só para orientar a escolha de empresa e período. */
export function sniffXml(head: string): XmlSniff {
  const has = (name: string) => new RegExp(tag(name)).test(head);
  let kind: XmlKind = 'desconhecido';
  if (has('inutNFe') || has('procInutNFe')) kind = 'inutilizacao';
  else if (has('procEventoNFe') || has('infEvento') || has('envEvento')) kind = 'evento';
  else if (has('infCte')) kind = 'cte';
  else if (has('infNFe')) kind = 'nfe';
  const date = /<(?:[\w-]+:)?dhEmi>(\d{4}-\d{2}-\d{2})/.exec(head) ?? /<(?:[\w-]+:)?dEmi>(\d{4}-\d{2}-\d{2})/.exec(head);
  const dest = /<(?:[\w-]+:)?dest>[\s\S]*?<(?:[\w-]+:)?(?:CNPJ|CPF)>(\d{11,14})</.exec(head);
  const emit = /<(?:[\w-]+:)?emit>[\s\S]*?<(?:[\w-]+:)?CNPJ>(\d{14})</.exec(head);
  return {
    kind,
    emissao: date?.[1] ?? null,
    cnpjDestinatario: kind === 'nfe' ? dest?.[1] ?? null : null,
    cnpjEmitente: emit?.[1] ?? null,
  };
}

/** Registro |0000| do SPED: período, nome e CNPJ do contribuinte. */
export function parseSpedHeader(head: string): { periodo: string | null; nome: string | null; cnpj: string | null } {
  const line = head.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const fields = line.split('|');
  if (fields[1] !== '0000') return { periodo: null, nome: null, cnpj: null };
  const toIso = (value: string | undefined) => (value && /^\d{8}$/.test(value)
    ? `${value.slice(4, 8)}-${value.slice(2, 4)}-${value.slice(0, 2)}`
    : null);
  const inicio = toIso(fields[4]);
  const fim = toIso(fields[5]);
  return {
    periodo: inicio && fim ? `${inicio} a ${fim}` : null,
    nome: fields[6] || null,
    cnpj: fields[7] || null,
  };
}

function rangeOf(dates: string[]): { de: string; ate: string } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { de: sorted[0], ate: sorted[sorted.length - 1] };
}

function topCounts(values: string[], limit = 6): Array<{ cnpj: string; notas: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cnpj, notas]) => ({ cnpj, notas }));
}

const caminhos = (description: string) => z.array(z.string().min(1)).describe(description);

export function registerGeracaoTools({ server, policy, geracoes }: ToolContext): void {
  server.registerTool('listar_arquivos_fiscais', {
    title: 'Ver arquivos fiscais de uma pasta',
    description: 'Examina uma pasta do computador e resume os arquivos fiscais: quantos XMLs de NF-e, CT-e e eventos, ZIPs, SPEDs '
      + '(com período e CNPJ) e planilhas; o intervalo de emissão e os CNPJs destinatários mais frequentes das NF-e. '
      + 'Use para descobrir a empresa e a competência antes de gerar_planilhas. O conteúdo das notas não é enviado a lugar nenhum.',
    inputSchema: {
      pasta: z.string().min(1).describe('Caminho completo da pasta (ou de um arquivo).'),
      incluir_subpastas: z.boolean().default(false),
    },
    annotations: READ_ONLY,
  }, safe(async ({ pasta, incluir_subpastas }) => {
    const files = await expandPaths(policy, [pasta], { recursive: incluir_subpastas });
    const sniffs: Array<FoundFile & { sniff?: XmlSniff; sped?: ReturnType<typeof parseSpedHeader> }> = [];
    for (const file of files) {
      if (file.kind === 'xml') sniffs.push({ ...file, sniff: sniffXml(await readHead(file.path, SNIFF_BYTES)) });
      else if (file.kind === 'sped') sniffs.push({ ...file, sped: parseSpedHeader(await readHead(file.path, 2048)) });
      else sniffs.push(file);
    }
    const nfes = sniffs.filter((file) => file.sniff?.kind === 'nfe');
    const ctes = sniffs.filter((file) => file.sniff?.kind === 'cte');
    const speds = sniffs.filter((file) => file.kind === 'sped' && file.sped?.periodo);
    const base = (await policy.resolveExisting(pasta));
    return {
      pasta: base,
      total_arquivos: files.length,
      resumo: {
        nfe: nfes.length,
        cte: ctes.length,
        eventos: sniffs.filter((file) => file.sniff?.kind === 'evento').length,
        inutilizacoes: sniffs.filter((file) => file.sniff?.kind === 'inutilizacao').length,
        xml_nao_reconhecido: sniffs.filter((file) => file.sniff?.kind === 'desconhecido').length,
        zip: files.filter((file) => file.kind === 'zip').length,
        sped: speds.length,
        planilhas: files.filter((file) => file.kind === 'planilha').length,
        outros: sniffs.filter((file) => file.kind === 'outro' || (file.kind === 'sped' && !file.sped?.periodo)).length,
      },
      emissao_nfe: rangeOf(nfes.map((file) => file.sniff!.emissao).filter((date): date is string => Boolean(date))),
      emissao_cte: rangeOf(ctes.map((file) => file.sniff!.emissao).filter((date): date is string => Boolean(date))),
      cnpjs_destinatarios_nfe: topCounts(nfes.map((file) => file.sniff!.cnpjDestinatario).filter((cnpj): cnpj is string => Boolean(cnpj))),
      speds: speds.map((file) => ({ arquivo: file.path, periodo: file.sped!.periodo, contribuinte: file.sped!.nome, cnpj: file.sped!.cnpj })),
      zips: files.filter((file) => file.kind === 'zip').map((file) => ({ arquivo: file.path, tamanho: formatBytes(file.size) })),
      planilhas: files.filter((file) => file.kind === 'planilha').slice(0, 40).map((file) => file.path),
      arquivos: sniffs.slice(0, MAX_LISTED_FILES).map((file) => ({
        nome: path.relative(base, file.path) || file.name,
        tipo: file.sniff?.kind ?? file.kind,
        tamanho: formatBytes(file.size),
      })),
      arquivos_omitidos: Math.max(0, sniffs.length - MAX_LISTED_FILES),
    };
  }));

  server.registerTool('gerar_planilhas', {
    title: 'Gerar planilhas de apuração',
    description: 'Gera as planilhas de ICMS (Antecipação Parcial, Antecipação Tributária, DIFAL e controle) de uma empresa e competência a partir dos '
      + 'XMLs de NF-e/CT-e (arquivos, ZIPs ou pastas) e/ou do SPED Fiscal, usando o mesmo motor de cálculo e os mesmos modelos do site. '
      + 'Os arquivos são lidos neste computador e não são enviados ao servidor; só o resultado estruturado vai para o histórico do Planaut. '
      + 'Se o sistema precisar de decisões (bonificações, uso e consumo, Convênio 52/91, MVA, CT-e sem NF-e), devolve status '
      + '"aguardando_decisao" com as pendências: apresente-as ao usuário, nunca decida por ele, e envie as respostas com responder_pendencias. '
      + 'Ao concluir, grava os .xlsx na pasta de saída (sem sobrescrever) e informa totais, notas ignoradas e itens excluídos.',
    inputSchema: {
      empresa_id: z.number().int().positive(),
      competencia: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('Mês de apuração AAAA-MM; alternativa a periodo_inicio/periodo_fim.'),
      periodo_inicio: z.string().optional().describe('AAAA-MM-DD.'),
      periodo_fim: z.string().optional().describe('AAAA-MM-DD.'),
      xmls: caminhos('Arquivos .xml, .zip ou pastas com os XMLs de NF-e, CT-e e eventos (cancelamento, carta de correção).').default([]),
      speds: caminhos('Arquivos .txt do SPED Fiscal (ou pastas que os contenham).').default([]),
      planilha_entrada: z.string().optional().describe('Planilha do sistema contábil (.xlsx/.xls) com as datas de entrada, se houver.'),
      pasta_saida: z.string().optional().describe('Onde gravar as planilhas; padrão: configuração da extensão ou a pasta dos XMLs.'),
      incluir_subpastas: z.boolean().default(false).describe('Ler também subpastas das pastas informadas.'),
    },
    annotations: WRITE,
  }, safe(async (args) => {
    let inicio = args.periodo_inicio?.trim();
    let fim = args.periodo_fim?.trim();
    if (args.competencia) {
      if (inicio || fim) throw new Error('Use competencia OU periodo_inicio/periodo_fim, não os dois.');
      ({ inicio, fim } = monthPeriod(args.competencia));
    }
    if (!inicio || !fim) throw new Error('Informe a competência (AAAA-MM) ou periodo_inicio e periodo_fim.');
    return geracoes.start({
      empresaId: args.empresa_id,
      periodoInicio: inicio,
      periodoFim: fim,
      xmls: args.xmls,
      speds: args.speds,
      planilhaEntrada: args.planilha_entrada?.trim() || null,
      pastaSaida: args.pasta_saida?.trim() || null,
      recursivo: args.incluir_subpastas,
    });
  }));

  server.registerTool('responder_pendencias', {
    title: 'Responder pendências da geração',
    description: 'Envia as decisões do usuário para as pendências devolvidas por gerar_planilhas e retoma a geração do ponto em que parou. '
      + 'Use os ids das pendências (U1, B1, C1, M1...). Decisões anteriores ficam guardadas; a resposta pode trazer a próxima etapa de pendências '
      + 'ou o resultado final. Só envie o que o usuário decidiu.',
    inputSchema: {
      geracao_id: z.string().min(1),
      uso_consumo: z.record(z.string(), z.enum(['difal', 'manter_regras'])).optional(),
      bonificacao: z.record(z.string(), z.enum(['revenda', 'ignorar', 'uso_consumo'])).optional(),
      convenio_52_91: z.record(z.string(), z.enum(['aplicar', 'nao_aplicar', 'anexo_i'])).optional(),
      mva: z.record(z.string(), z.object({
        mva_percentual: z.number().min(0).max(10_000).nullable().describe('MVA em percentual (45.5 = 45,5%), ou null para manter pendente.'),
        justificativa: z.string().min(5).max(500),
      })).optional(),
      ignorar_ctes_sem_nfe: z.boolean().optional().describe('true continua sem as NF-e originárias dos CT-e listados.'),
      adicionar_xmls: caminhos('XMLs/ZIPs/pastas extras (ex.: NF-e originárias dos CT-e).').optional(),
    },
    annotations: WRITE,
  }, safe(async (args) => geracoes.answer(args.geracao_id, {
    usoConsumo: args.uso_consumo,
    bonificacao: args.bonificacao,
    convenio5291: args.convenio_52_91,
    mva: args.mva,
    ignorarCtesSemNfe: args.ignorar_ctes_sem_nfe,
    adicionarXmls: args.adicionar_xmls,
  })));

  server.registerTool('cancelar_geracao', {
    title: 'Cancelar geração',
    description: 'Descarta uma geração que está aguardando decisões. Nada é registrado no histórico e nenhuma planilha é gravada.',
    inputSchema: { geracao_id: z.string().min(1) },
    annotations: DESTRUCTIVE,
  }, safe(async ({ geracao_id }) => geracoes.cancel(geracao_id)));

  server.registerTool('preencher_datas_entrada', {
    title: 'Preencher datas de entrada',
    description: 'Completa a coluna de data de entrada de planilhas .xlsx já geradas pelo Planaut usando o SPED Fiscal e/ou a planilha de entradas '
      + 'do sistema contábil, e reordena as linhas (mesmo recurso da tela "Preencher Datas de Entrada"). Grava uma cópia; o original não muda.',
    inputSchema: {
      planilhas: caminhos('Planilhas .xlsx geradas pelo Planaut (ou pastas com elas).'),
      speds: caminhos('SPED Fiscal (.txt) com as datas de entrada.').default([]),
      planilhas_entrada: caminhos('Planilhas de entradas do sistema contábil (.xls, .xlsx, .csv, .txt, .tsv).').default([]),
      pasta_saida: z.string().optional().describe('Padrão: a mesma pasta de cada planilha.'),
    },
    annotations: WRITE,
  }, safe(async ({ planilhas, speds, planilhas_entrada, pasta_saida }) => preencherDatasEntrada(policy, {
    planilhas,
    speds,
    planilhasEntrada: planilhas_entrada,
    pastaSaida: pasta_saida?.trim() || null,
  })));
}
