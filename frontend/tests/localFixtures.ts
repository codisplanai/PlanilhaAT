// Fixtures compartilhadas pelos testes de processamento local (DIFAL / indústria).
import fs from 'node:fs';
import path from 'node:path';
import { processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import type { LocalProcessingContext, LocalTemplateDescriptor } from '../src/types/localProcessing.ts';
import type { TipoPlanilha } from '../src/types/solicitacao.ts';

export const EMPRESA_CNPJ = '12345678000195';
const FORNECEDOR_CNPJ = '98765432000180';

/** Chave sintética de 44 dígitos do fornecedor SP. */
export function chave(aamm: string, numero: number): string {
  return `35${aamm}${FORNECEDOR_CNPJ}55001${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}0`;
}

export interface SpedNota {
  numero: string;
  chave: string;
  dtDoc: string; // ddmmaaaa
  dtEntrada: string; // ddmmaaaa
  itens: Array<[cfop: string, valor: string]>;
}

/** SPED de janeiro/2026 da empresa BA, uma C100 de entrada + C170 por item. */
export function spedJaneiro(notas: SpedNota[]): string {
  const linhas = [
    `|0000|019|0|01012026|31012026|Cliente BA|${EMPRESA_CNPJ}||BA|123|2927408|||A|1|`,
    `|0150|F1|FORNECEDOR SP|1058|${FORNECEDOR_CNPJ}||SP|3550308||R|1||C|`,
    '|0200|P1|PRODUTO|||UN|01|21069090|||18,00||',
  ];
  for (const nota of notas) {
    const total = nota.itens.reduce((sum, [, v]) => sum + Number(v.replace(',', '.')), 0);
    const totalTxt = total.toFixed(2).replace('.', ',');
    linhas.push(
      `|C100|0|1|F1|55|00|1|${nota.numero}|${nota.chave}|${nota.dtDoc}|${nota.dtEntrada}|${totalTxt}|0|0,00|0,00|${totalTxt}|0|0,00|0,00|0,00|${totalTxt}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
    );
    nota.itens.forEach(([cfop, valor], index) => {
      linhas.push(
        `|C170|${index + 1}|P1|PRODUTO|1,000|UN|${valor}|0,00|0|000|${cfop}||${valor}|12,00|0,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|`,
      );
    });
  }
  linhas.push(`|9999|${linhas.length + 1}|`);
  return linhas.join('\n');
}

/** XML mínimo de NF-e de SP para a empresa BA, um item com pICMS 12%. */
export function xmlNfe(numero: string, chaveAcesso: string, valor: string, dataEmissao: string, cfop: string): string {
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe>
  <infNFe Id="NFe${chaveAcesso}">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>${dataEmissao}T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>${FORNECEDOR_CNPJ}</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>${EMPRESA_CNPJ}</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vProd>${valor}</vProd><vBC>${valor}</vBC><vNF>${valor}</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>P1</cProd><xProd>PRODUTO</xProd><NCM>21069090</NCM><CFOP>${cfop}</CFOP><vProd>${valor}</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${valor}</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto></det>
  </infNFe></NFe></nfeProc>`;
}

const TEMPLATE_FILES: Partial<Record<TipoPlanilha, string>> = {
  antecipacao_parcial: 'modelo_padrao_antecipacao_parcial.xlsx',
  antecipacao_parcial_antecipado: 'modelo_padrao_antecipacao_parcial_antecipado.xlsx',
  antecipacao_parcial_simples: 'modelo_padrao_antecipacao_parcial_simples.xlsx',
  antecipacao_parcial_antecipado_simples: 'modelo_padrao_antecipacao_parcial_antecipado_simples.xlsx',
  antecipacao_tributaria: 'modelo_padrao_antecipacao_tributaria.xlsx',
  difal: 'modelo_padrao_difal.xlsx',
  difal_antecipado: 'modelo_padrao_difal.xlsx',
};

const DIFAL_COLUMNS = {
  data_entrada: 'B', data_emissao: 'C', numero_nota: 'D', v_total: 'E',
  ipi_despesas: 'F', aliq_simples: 'G', a_dst: 'I', a_ori: 'J',
};
const PARCIAL_COLUMNS = {
  data_entrada: 'B', data_emissao: 'C', numero_nota: 'D', v_total: 'E',
  base_calculo: 'F', ipi_despesas: 'G', a_dst: 'H', a_ori: 'I',
};
const TRIBUTARIA_COLUMNS = {
  data_entrada: 'B', data_emissao: 'C', numero_nota: 'D', v_total: 'E', base_calculo: 'F',
  ipi_despesas: 'G', mva: 'H', a_dst: 'J', a_ori: 'K',
};

function templateDescriptors(): LocalTemplateDescriptor[] {
  return (Object.keys(TEMPLATE_FILES) as TipoPlanilha[]).map((tipo, index) => ({
    id: index + 1,
    tipo,
    versao: 1,
    ativo: true,
    capacidade_linhas: 100,
    arquivo_path: '',
    arquivo_hash: '',
    mapeamento_campos: {
      start_row: 4,
      columns: tipo.startsWith('difal')
        ? DIFAL_COLUMNS
        : tipo.startsWith('antecipacao_tributaria') ? TRIBUTARIA_COLUMNS : PARCIAL_COLUMNS,
    },
  })) as LocalTemplateDescriptor[];
}

export function buildContext(
  options: { simples?: boolean; atividade?: 'comercio' | 'industria' } = {},
): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Cliente BA',
      cnpj: EMPRESA_CNPJ,
      inscricao_estadual: '123',
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: Boolean(options.simples),
      atividade: options.atividade ?? 'comercio',
    },
    perfil: { id: 1, nome: 'Perfil', configuracoes_extras: {} },
    regras_aliquotas: [{ id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205 } as never],
    regras_cfop: [
      { id: 1, perfil_regras_id: 1, cfop_sufixo: '102', destino: 'antecipacao_parcial', reclassificar_para: null, motivo: null },
      { id: 2, perfil_regras_id: 1, cfop_sufixo: '403', destino: 'antecipacao_tributaria', reclassificar_para: null, motivo: null },
    ] as never,
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: templateDescriptors(),
    mva_anexo: [],
  };
}

async function loadTemplate(template: LocalTemplateDescriptor): Promise<ArrayBuffer> {
  const file = TEMPLATE_FILES[template.tipo as TipoPlanilha]!;
  const local = path.resolve('storage/templates', file);
  const resolved = fs.existsSync(local) ? local : path.resolve('../storage/templates', file);
  const buf = fs.readFileSync(resolved);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function processar(
  context: LocalProcessingContext,
  input: { sped?: string; xmls?: Array<[nome: string, conteudo: string]> },
  bonusDecisions?: Record<string, boolean>,
) {
  return processFiscalLocally(
    {
      solicitacaoId: 'teste-local',
      periodoInicio: '2026-01-01',
      periodoFim: '2026-01-31',
      context,
      input: {
        xmlFiles: (input.xmls ?? []).map(([nome, conteudo]) => new File([conteudo], nome)),
        spedFile: input.sped ? new File([input.sped], 'sped.txt') : null,
        entrySheet: null,
      },
      bonusDecisions,
    },
    new Map(),
    loadTemplate,
  );
}
