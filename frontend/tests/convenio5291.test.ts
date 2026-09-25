import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyConvenio5291,
  convenioAliquotaOrigem,
  resolveConvenio5291Application,
} from '../src/lib/localProcessing/convenio5291.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';
import type { Convenio5291Config } from '../src/types/perfil.ts';

const config: Convenio5291Config = {
  enabled: true,
  aplicar_automaticamente_seguros: true,
  solicitar_confirmacao_duvidosos: true,
  considerar_cst20_como_indicio: true,
  ajustes: [],
};

function item(patch: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    itemNumero: 1,
    ncm: '84198190',
    cest: '',
    cfop: '6102',
    descricao: 'FRITADEIRA A GAS ZONA FRIA',
    descricaoConfiavel: true,
    vItem: 1000,
    vTotal: 1100,
    baseCalculo: 734.3,
    baseCalculoXml: 734.3,
    baseSemIpi: 1000,
    ipiDespesas: 100,
    vIpi: 100,
    aOri: 0.07,
    vIcms: 51.4,
    origemMercadoria: '0',
    cstIcms: '20',
    pRedBC: 26.57,
    ...patch,
  };
}

function note(patch: Partial<ExtractedNote> = {}): ExtractedNote {
  return {
    filename: 'nfe.xml',
    chaveAcesso: '29260900000000000100550010000000011000000000',
    numeroNota: '1',
    serie: '1',
    cnpjEmitente: '00000000000100',
    ufEmitente: 'SP',
    cnpjDestinatario: '11111111000111',
    ufDestinatario: 'BA',
    dataEmissao: '2026-08-01T10:00:00',
    dataEntrada: null,
    vTotalNota: 1100,
    vBcNota: 734.3,
    vIcmsNota: 51.4,
    origemExtracao: 'xml',
    rawMetadata: {},
    itens: [],
    ...patch,
  };
}

test('aplica automaticamente NCM e descrição seguros e usa base sem IPI', () => {
  const nf = note();
  const produto = item();
  const classification = classifyConvenio5291(config, nf, produto, 'BA');
  assert.equal(classification.status, 'automatico');

  const applied = resolveConvenio5291Application(config, nf, produto, 'BA');
  assert.equal(applied.applied, true);
  assert.equal(applied.aOri, 0.0514);
  assert.equal(applied.aDst, 0.088);
  assert.equal(applied.baseSemIpi, 1000);
});

test('não enquadra buffet frio apesar de CST 20', () => {
  const classification = classifyConvenio5291(config, note(), item({ descricao: 'BUFFET FRIO 4 CUBAS' }), 'BA');
  assert.equal(classification.status, 'nao_aplicar');
  assert.equal(classification.cst20, true);
});

test('NCM candidato sem descrição segura vai para revisão', () => {
  const classification = classifyConvenio5291(config, note(), item({
    ncm: '84382090',
    descricao: 'LIQUIDIFICADOR INDUSTRIAL 10 L',
  }), 'BA');
  assert.equal(classification.status, 'revisar');
  assert.equal(classification.sugestaoAplicar, true);
});

test('operação a 4% nunca é convertida automaticamente para 5,14%', () => {
  const produto = item({ ncm: '84238200', descricao: 'BALANCA ELETRONICA 32KG', aOri: 0.04, cstIcms: '00', origemMercadoria: '1', pRedBC: 0 });
  const classification = classifyConvenio5291(config, note(), produto, 'BA');
  assert.equal(classification.status, 'revisar');
  const rates = convenioAliquotaOrigem('SP', 0.04);
  assert.equal(rates.aliquota, 0.04);
  assert.equal(rates.origem, 'aliquota_4_preservada_xml');
});

test('ajuste do perfil pode bloquear um NCM sem apagar o catálogo', () => {
  const adjusted: Convenio5291Config = {
    ...config,
    ajustes: [{
      id: 'bloqueio',
      ncm: '84198190',
      acao: 'nao_aplicar',
      termos_descricao: ['FRITADEIRA'],
      vigencia_inicio: '2026-01-01',
      vigencia_fim: null,
      motivo: 'Ajuste local',
    }],
  };
  const classification = classifyConvenio5291(adjusted, note(), item(), 'BA');
  assert.equal(classification.status, 'nao_aplicar');
  assert.equal(classification.ajusteId, 'bloqueio');
});
