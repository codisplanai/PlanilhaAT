import assert from 'node:assert/strict';
import test from 'node:test';

import { processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import {
  interstateRateKey,
  mvaColumnForNote,
  noOutputMessage,
  resolveMvaForItem,
} from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';
import type { LocalMvaEntry, LocalProcessingContext } from '../src/types/localProcessing.ts';

// Regras decididas para o fluxo geral da Antecipação Tributária:
// - CRT 1 (Simples) e 4 (MEI) usam a MVA original; CRT 2 e 3 usam a ajustada.
// - Sem CRT (nota só do SPED), CSOSN indica a original e CST a ajustada.
// - Item sem MVA determinável fica pendente em vez de ser calculado com MVA 0.

const ajustada = (a4: number, a7: number, a12: number, caso: string | null = null) => ({
  caso,
  aliquotas: { '4': a4, '7': a7, '12': a12 },
});

const ANEXO: LocalMvaEntry[] = [
  {
    ncm: '22011', item: '3.3', cest: ['03.003.00'],
    mva_ajustada: [ajustada(158.42, 150.34, 136.88)], mva_original: [{ caso: null, valor: 114 }],
  },
  {
    ncm: '22011', item: '3.3.1', cest: ['03.003.01'],
    mva_ajustada: [ajustada(158.42, 150.34, 136.88)], mva_original: [{ caso: null, valor: 114 }],
  },
  {
    ncm: '3004', item: '9.1.0', cest: ['13.001.00'],
    mva_ajustada: [ajustada(77.05, 71.52, 62.29)], mva_original: [{ caso: null, valor: 38.24 }],
  },
  {
    ncm: '3004', item: '9.1.1', cest: ['13.001.01'],
    mva_ajustada: [ajustada(70.31, 65.03, 56.25)], mva_original: [{ caso: null, valor: 33 }],
  },
  { ncm: '27101919', item: '6.4', cest: ['06.004.00'], mva_ajustada: [], mva_original: [] },
  {
    ncm: '8708', item: '1.99', cest: ['01.999.00'],
    mva_ajustada: [ajustada(64.9, 59.75, 51.16, 'fidelidade'), ajustada(107.43, 100.95, 90.15, 'demais')],
    mva_original: [{ caso: 'fidelidade', valor: 36.56 }, { caso: 'demais', valor: 71.78 }],
  },
  // Código curto (2202) com dois CESTs e código longo (220210) com outro CEST e outra
  // MVA: o NCM 2202.10.00 casa com os dois itens.
  {
    ncm: '2202', item: '3.7', cest: ['03.007.00', '03.008.00'],
    mva_ajustada: [ajustada(158.42, 150.34, 136.88)], mva_original: [{ caso: null, valor: 114 }],
  },
  {
    ncm: '220210', item: '3.9', cest: ['03.010.00'],
    mva_ajustada: [ajustada(165.08, 156.8, 142.99)], mva_original: [{ caso: null, valor: 114 }],
  },
];

function context(mvaAnexo: LocalMvaEntry[] = ANEXO): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Cliente BA LTDA',
      cnpj: '12345678000195',
      inscricao_estadual: null,
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
      a_ori_fixa_parcial: null,
    },
    perfil: { id: 1, nome: 'Padrão Geral', configuracoes_extras: {} },
    regras_aliquotas: [{
      id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205,
      parametros_extras: {}, criado_em: '', atualizado_em: '',
    }],
    regras_cfop: [{
      id: 1, perfil_regras_id: null, cfop_sufixo: '405', destino: 'antecipacao_tributaria',
      criado_em: '', atualizado_em: '',
    }],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [],
    mva_anexo: mvaAnexo,
  };
}

function note(rawMetadata: ExtractedNote['rawMetadata'], csosn?: string): ExtractedNote {
  const item: ExtractedItem = {
    itemNumero: 1, ncm: '22011000', cest: '', cfop: '6405', descricao: 'AGUA MINERAL',
    descricaoConfiavel: true, vItem: 1000, vTotal: 1000, baseCalculo: 1000, ipiDespesas: 0,
    aOri: csosn ? 0 : 0.12, vIcms: 0, csosn,
  };
  return {
    filename: 'nf.xml', chaveAcesso: '', numeroNota: '1', serie: '1', cnpjEmitente: '11222333000181',
    ufEmitente: 'SP', cnpjDestinatario: '12345678000195', ufDestinatario: 'BA', dataEmissao: '2026-03-10',
    vTotalNota: 1000, vBcNota: 1000, vIcmsNota: 0, origemExtracao: 'xml', rawMetadata, itens: [item],
  };
}

test('coluna da MVA pelo CRT: 1 e 4 original; 2 e 3 ajustada; desconhecido sem coluna', () => {
  assert.equal(mvaColumnForNote(note({ crt: '1' }, '102')), 'original');
  assert.equal(mvaColumnForNote(note({ crt: '4' }, '102')), 'original');
  // CRT 2 é marcado como Simples para A.ORI e DIFAL, mas usa a MVA ajustada.
  assert.equal(mvaColumnForNote(note({ crt: '2', fornecedor_simples_nacional: true })), 'ajustada');
  assert.equal(mvaColumnForNote(note({ crt: '3' })), 'ajustada');
  assert.equal(mvaColumnForNote(note({ crt: '9' })), null);
});

test('sem CRT (nota só do SPED), CSOSN indica a MVA original e CST a ajustada', () => {
  assert.equal(mvaColumnForNote(note({}, '102')), 'original');
  assert.equal(mvaColumnForNote(note({ fornecedor_simples_nacional: true })), 'original');
  assert.equal(mvaColumnForNote(note({})), 'ajustada');
});

test('faixa da MVA ajustada exige 4%, 7% ou 12% exatos, sem presumir 12%', () => {
  assert.equal(interstateRateKey(0.04), '4');
  assert.equal(interstateRateKey(0.07), '7');
  assert.equal(interstateRateKey(0.12), '12');
  assert.equal(interstateRateKey(12), '12');
  assert.equal(interstateRateKey(0.1), null);
  assert.equal(interstateRateKey(0.18), null);
  assert.equal(interstateRateKey(0), null);
  assert.equal(interstateRateKey(undefined), null);
});

test('a coluna escolhe entre MVA original e ajustada', () => {
  const original = resolveMvaForItem(context(), '22011000', '', 0, 'original');
  const adjusted = resolveMvaForItem(context(), '22011000', '', 0.07, 'ajustada');
  assert.equal(original.status, 'ok');
  assert.equal(original.status === 'ok' && original.mva, 114);
  assert.equal(adjusted.status === 'ok' && adjusted.mva, 150.34);
  assert.deepEqual(adjusted.anexoItems, ['3.3', '3.3.1']);
});

test('NCM fora do Anexo fica pendente em vez de MVA zero', () => {
  const result = resolveMvaForItem(context(), '99999999', '', 0.12, 'ajustada');
  assert.equal(result.status, 'pendente');
  assert.match(result.status === 'pendente' ? result.motivo : '', /não encontrado no Anexo 1/);
});

test('MVA não numérica e MVA condicional ficam pendentes', () => {
  const textual = resolveMvaForItem(context(), '27101919', '', 0.12, 'ajustada');
  assert.equal(textual.status, 'pendente');
  assert.match(textual.status === 'pendente' ? textual.motivo : '', /item 6\.4 do Anexo 1/);

  for (const [column, aOri] of [['ajustada', 0.12], ['original', 0]] as const) {
    const conditional = resolveMvaForItem(context(), '87089990', '', aOri, column);
    assert.equal(conditional.status, 'pendente');
    assert.match(conditional.status === 'pendente' ? conditional.motivo : '', /mais de um caso de MVA/);
  }
});

test('MVAs diferentes sem CEST ficam pendentes e o CEST desempata', () => {
  const withoutCest = resolveMvaForItem(context(), '30049099', '', 0.12, 'ajustada');
  assert.equal(withoutCest.status, 'pendente');
  assert.match(withoutCest.status === 'pendente' ? withoutCest.motivo : '', /56,25% \/ 62,29%/);

  const withCest = resolveMvaForItem(context(), '30049099', '13.001.01', 0.12, 'ajustada');
  assert.equal(withCest.status === 'ok' && withCest.mva, 56.25);
});

test('MVA ajustada sem A.ORI válida, regime desconhecido ou tabela vazia ficam pendentes', () => {
  for (const aOri of [undefined, 0, 0.18]) {
    const result = resolveMvaForItem(context(), '22011000', '', aOri, 'ajustada');
    assert.equal(result.status, 'pendente');
    assert.match(result.status === 'pendente' ? result.motivo : '', /só existe para 4%, 7% e 12%/);
  }
  const unknownRegime = resolveMvaForItem(context(), '22011000', '', 0.12, null);
  assert.match(unknownRegime.status === 'pendente' ? unknownRegime.motivo : '', /regime do fornecedor/);
  const emptyTable = resolveMvaForItem(context([]), '22011000', '', 0.12, 'ajustada');
  assert.match(emptyTable.status === 'pendente' ? emptyTable.motivo : '', /não está disponível/);
});

test('o CEST escolhe entre itens de códigos diferentes, inclusive pelo segundo CEST do item', () => {
  const cases: Array<[string, number, string[]]> = [
    ['03.007.00', 158.42, ['3.7']], // item de código mais curto não é descartado
    ['0300800', 158.42, ['3.7']], // segundo CEST do mesmo item
    ['03.010.00', 165.08, ['3.9']],
  ];
  for (const [cest, mva, items] of cases) {
    const result = resolveMvaForItem(context(), '22021000', cest, 0.04, 'ajustada');
    assert.equal(result.status, 'ok', cest);
    assert.equal(result.status === 'ok' && result.mva, mva, cest);
    assert.deepEqual(result.anexoItems, items, cest);
  }
});

test('sem CEST, itens de códigos diferentes com MVAs diferentes ficam pendentes', () => {
  const result = resolveMvaForItem(context(), '22021000', '', 0.04, 'ajustada');
  assert.equal(result.status, 'pendente');
  const motivo = result.status === 'pendente' ? result.motivo : '';
  assert.match(motivo, /158,42% \/ 165,08%/);
  assert.match(motivo, /não traz CEST/);
  assert.deepEqual(result.anexoItems, ['3.7', '3.9']);
});

test('CEST divergente do NCM fica pendente em vez de ser ignorado', () => {
  const result = resolveMvaForItem(context(), '22021000', '03.003.00', 0.04, 'ajustada');
  assert.equal(result.status, 'pendente');
  const motivo = result.status === 'pendente' ? result.motivo : '';
  assert.match(motivo, /divergência entre NCM e CEST/);
  assert.match(motivo, /CEST 03\.003\.00/);
  assert.deepEqual(result.anexoItems, ['3.7', '3.9']);
});

test('mensagem sem planilha diferencia MVA pendente de "nada a recolher"', () => {
  assert.equal(noOutputMessage([{ tipo_exclusao: 'mercadoria' }]), 'Nenhum item a recolher na Parcial');
  assert.match(noOutputMessage([{ tipo_exclusao: 'mva_pendente' }]), /^Nenhuma planilha gerada/);
  assert.match(
    noOutputMessage([{ tipo_exclusao: 'mercadoria' }, { tipo_exclusao: 'mva_pendente' }]),
    /MVA pendente/,
  );
});

const SPED_MARCO_NCM_FORA_DO_ANEXO = [
  '|0000|019|0|01032026|31032026|Cliente BA|12345678000195||BA|123|2927408|||A|1|',
  '|0150|F1|FORNECEDOR SP|1058|11222333000181||SP|3550308||R|1||C|',
  '|0200|P1|PECA SEM MVA|||UN|01|87149990|||18,00||',
  '|C100|0|1|F1|55|00|1|705|35260311222333000181550010000007051000007051|10032026|20032026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|120,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  '|C170|1|P1|PECA SEM MVA|1,000|UN|1000,00|0,00|0|000|6405||1000,00|12,00|120,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|',
  '|9999|6|',
].join('\n');

test('processamento local: item sem MVA fica pendente, sem virar linha com MVA 0 nem interromper', async () => {
  const result = await processFiscalLocally(
    {
      solicitacaoId: 'teste-mva-pendente',
      periodoInicio: '2026-03-01',
      periodoFim: '2026-03-31',
      context: context(),
      input: { xmlFiles: [], spedFile: new File([SPED_MARCO_NCM_FORA_DO_ANEXO], 'sped.txt'), entrySheet: null },
    },
    new Map(),
  );

  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.itensExcluidos.length, 1);
  const [pending] = result.itensExcluidos;
  assert.equal(pending.tipo_exclusao, 'mva_pendente');
  assert.equal(pending.destino, 'antecipacao_tributaria');
  assert.equal(pending.ncm, '87149990');
  assert.equal(pending.v_total, 1000);
  assert.match(pending.motivo, /não encontrado no Anexo 1/);
  assert.match(result.mensagem ?? '', /^Nenhuma planilha gerada/);
});

const SPED_MARCO_CEST_DIVERGENTE = [
  '|0000|019|0|01032026|31032026|Cliente BA|12345678000195||BA|123|2927408|||A|1|',
  '|0150|F1|FORNECEDOR SP|1058|11222333000181||SP|3550308||R|1||C|',
  '|0200|P2|AGUA AROMATIZADA|||UN|01|22021000|||18,00||0300300|',
  '|C100|0|1|F1|55|00|1|707|35260311222333000181550010000007071000007071|10032026|20032026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|40,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  '|C170|1|P2|AGUA AROMATIZADA|1,000|UN|1000,00|0,00|0|000|6405||1000,00|4,00|40,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|',
  '|9999|6|',
].join('\n');

test('processamento local: CEST do cadastro do SPED que diverge do NCM gera pendência', async () => {
  const result = await processFiscalLocally(
    {
      solicitacaoId: 'teste-cest-divergente',
      periodoInicio: '2026-03-01',
      periodoFim: '2026-03-31',
      context: context(),
      input: { xmlFiles: [], spedFile: new File([SPED_MARCO_CEST_DIVERGENTE], 'sped.txt'), entrySheet: null },
    },
    new Map(),
  );

  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.itensExcluidos.length, 1);
  const [pending] = result.itensExcluidos;
  assert.equal(pending.tipo_exclusao, 'mva_pendente');
  assert.match(pending.motivo, /divergência entre NCM e CEST/);
  assert.match(pending.motivo, /CEST 03\.003\.00/);
});
