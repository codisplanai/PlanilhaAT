import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatFcpCompetenceTab,
  formatFcpPercent,
  formatNotaFcpRateLabel,
  getNotaFcpInfo,
  sumSeparatedFcpByDestination,
} from '../src/lib/fcpSummary.ts';
import type { JsonObject } from '../src/types/common.ts';
import type { NotaFiscalProcessada, TipoPlanilha } from '../src/types/solicitacao.ts';

function makeNota(
  destino: TipoPlanilha | null,
  metadados: JsonObject,
): NotaFiscalProcessada {
  return {
    id: 'nota-1',
    solicitacao_id: 'sol-1',
    numero_nota: '1001',
    cnpj_destinatario: '12345678000199',
    data_emissao: '2026-11-10',
    item_numero: 1,
    ncm: '22030000',
    destino_planilha: destino,
    v_total: 1000,
    base_calculo: 1000,
    ipi_despesas: 0,
    a_ori: 0.12,
    a_dst_resolvida: 0.25,
    debito: 250,
    credito: 120,
    valor_devido: 130,
    metadados_extras: metadados,
    criado_em: '2026-11-10T10:00:00Z',
  };
}

test('getNotaFcpInfo identifica FCP separado, FCP somado e ausencia de FCP', () => {
  assert.deepEqual(
    getNotaFcpInfo({
      metadados_extras: {
        a_dst_base: '0.2500',
        fcp_aliquota: '0.0200',
        fcp_separado: true,
        fcp_valor_devido: '24.50',
      },
    }),
    { aliquota: 0.02, separado: true, valorDevido: 24.5 },
  );

  assert.deepEqual(
    getNotaFcpInfo({
      metadados_extras: {
        a_dst_base: '0.1800',
        fcp_aliquota: '0.0200',
        fcp_separado: false,
      },
    }),
    { aliquota: 0.02, separado: false, valorDevido: 0 },
  );

  for (const meta of [
    {},
    { fcp_aliquota: null, fcp_separado: false },
    { fcp_aliquota: 0, fcp_separado: true, fcp_valor_devido: '10.00' },
    { fcp_aliquota: '0.0000', fcp_separado: false },
    { fcp_aliquota: 'invalido', fcp_separado: true, fcp_valor_devido: '10.00' },
    { fcp_aliquota: -0.02, fcp_separado: true },
  ] satisfies JsonObject[]) {
    assert.deepEqual(
      getNotaFcpInfo({ metadados_extras: meta }),
      { aliquota: null, separado: false, valorDevido: 0 },
    );
  }
});

test('getNotaFcpInfo trata CT-e multi-aliquota com fcp_parcelas sem dupla contagem', () => {
  const cteMulti = makeNota('antecipacao_tributaria', {
    tipo_documento: 'cte',
    a_dst_base: '0.2050',
    fcp_separado: true,
    // Mesmo que o topo traga valor residual, fcp_parcelas prevalece sem somar duas vezes.
    fcp_valor_devido: '30.45',
    fcp_parcelas: [
      {
        v_total: '500.00',
        base_calculo: '500.00',
        mva: '0.40',
        reducao: null,
        fcp_aliquota: '0.0100',
        fcp_base_st: '700.00',
        debito: '7.00',
        fcp_valor_devido: '10.15',
        percentual_rateio: '50.0000',
        fcp_origem: 'fcp_produto:1',
        fcp_detalhe: 'FCP 1%',
      },
      {
        v_total: '500.00',
        base_calculo: '500.00',
        mva: '0.45',
        reducao: null,
        fcp_aliquota: '0.0200',
        fcp_base_st: '725.00',
        debito: '14.50',
        fcp_valor_devido: '20.30',
        percentual_rateio: '50.0000',
        fcp_origem: 'fcp_produto:2',
        fcp_detalhe: 'FCP 2%',
      },
    ],
  });

  assert.deepEqual(getNotaFcpInfo(cteMulti), {
    aliquota: 0.02,
    separado: true,
    valorDevido: 30.45,
  });
  assert.equal(formatNotaFcpRateLabel(cteMulti), '1% / 2%');
});

test('sumSeparatedFcpByDestination soma notas e parcelas CT-e sem misturar FCP somado no Simples', () => {
  const notas: NotaFiscalProcessada[] = [
    makeNota('antecipacao_tributaria', {
      fcp_aliquota: '0.0200',
      fcp_separado: true,
      fcp_valor_devido: '0.10',
    }),
    makeNota('antecipacao_tributaria', {
      tipo_documento: 'cte',
      fcp_separado: true,
      fcp_valor_devido: '999.99',
      fcp_parcelas: [
        { fcp_aliquota: '0.0100', fcp_valor_devido: '0.10' },
        { fcp_aliquota: '0.0200', fcp_valor_devido: '0.10' },
      ],
    }),
    makeNota('antecipacao_tributaria_antecipado', {
      fcp_aliquota: '0.0200',
      fcp_separado: true,
      fcp_valor_devido: '7.25',
    }),
    // Simples Nacional: FCP somado à alíquota (fcp_separado = false) não entra no total separado.
    makeNota('antecipacao_tributaria', {
      fcp_aliquota: '0.0200',
      fcp_separado: false,
      fcp_valor_devido: '50.00',
    }),
    // Parcial e DIFAL também somam na A.DST (fcp_separado = false).
    makeNota('antecipacao_parcial', {
      fcp_aliquota: '0.0200',
      fcp_separado: false,
    }),
    makeNota('difal', {
      fcp_aliquota: '0.0200',
      fcp_separado: false,
    }),
  ];

  assert.equal(sumSeparatedFcpByDestination(notas, 'antecipacao_tributaria'), 0.3);
  assert.equal(sumSeparatedFcpByDestination(notas, 'antecipacao_tributaria_antecipado'), 7.25);
  assert.equal(sumSeparatedFcpByDestination(notas, 'antecipacao_parcial'), 0);
  assert.equal(sumSeparatedFcpByDestination(notas, 'difal'), 0);
  assert.equal(sumSeparatedFcpByDestination(notas), 7.55);
  assert.equal(sumSeparatedFcpByDestination(undefined), 0);
  assert.equal(sumSeparatedFcpByDestination([]), 0);
});

test('helpers de formatacao exibem competencia e percentual de FCP limpos', () => {
  assert.equal(formatFcpCompetenceTab('2026-11-01'), '11-2026 FCP');
  assert.equal(formatFcpCompetenceTab('2026-03-15T00:00:00Z'), '03-2026 FCP');
  assert.equal(formatFcpCompetenceTab(''), 'FCP');
  assert.equal(formatFcpCompetenceTab(undefined), 'FCP');
  assert.equal(formatFcpPercent(0.02), '2%');
  assert.equal(formatFcpPercent(0.025), '2,5%');
});
