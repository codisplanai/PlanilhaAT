import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveConvenio5291PartialConfig } from '../src/lib/localProcessing/convenio5291Global.ts';
import { classifyAnexoII } from '../src/lib/localProcessing/convenio5291Agricola.ts';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';

const note = {
  dataEmissao: '2026-09-12T00:00:00',
  ufEmitente: 'SP',
} as ExtractedNote;

const product = {
  ncm: '84678100',
  descricao: 'MOTOSSERRA A GASOLINA 1,5 KW',
  aOri: 0.07, pRedBC: 41.43, cstIcms: '20',
} as ExtractedItem;

test('ativação global de ambos os anexos em perfis legados sem nenhuma configuração', () => {
  const config = effectiveConvenio5291PartialConfig(undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.aplicar_automaticamente_seguros, true);
  assert.equal(config.solicitar_confirmacao_duvidosos, true);
  assert.equal(config.ajustes.length, 0);
  assert.equal(classifyAnexoII(config, note, product, 'BA').status, 'revisar');
});

test('perfil com enabled=false não bloqueia o convênio global; revisão é obrigatória', () => {
  const config = effectiveConvenio5291PartialConfig({
    enabled: false,
    aplicar_automaticamente_seguros: false,
    solicitar_confirmacao_duvidosos: false,
    considerar_cst20_como_indicio: false,
    ajustes: [],
  });
  assert.equal(config.enabled, true);
  assert.equal(config.aplicar_automaticamente_seguros, true);
  assert.equal(config.solicitar_confirmacao_duvidosos, true);
  assert.equal(classifyAnexoII(config, note, product, 'BA').status, 'revisar',
    'potência e registro do IBAMA não podem ser dispensados pela ativação global');
});

test('regras específicas de exclusão continuam eficazes após a ativação global', () => {
  const config = effectiveConvenio5291PartialConfig({
    enabled: false,
    aplicar_automaticamente_seguros: false,
    solicitar_confirmacao_duvidosos: false,
    considerar_cst20_como_indicio: true,
    ajustes: [{
      id: 'excluir-motosserra', ncm: '84678100', acao: 'nao_aplicar',
      termos_descricao: ['MOTOSSERRA'], motivo: 'Regra específica do perfil',
    }],
  });
  assert.equal(config.enabled, true);
  assert.equal(config.ajustes.length, 1);
  const result = classifyAnexoII(config, note, product, 'BA');
  assert.equal(result.status, 'nao_aplicar');
  assert.equal(result.motivo, 'Regra específica do perfil');
});

test('jurisdição e vigência impedem a concessão mesmo com ativação global', () => {
  const config = effectiveConvenio5291PartialConfig(undefined);
  assert.equal(classifyAnexoII(config, note, product, 'SP').status, 'fora_catalogo');
  assert.equal(classifyAnexoII(config, {
    ...note, dataEmissao: '2027-01-01T00:00:00',
  }, product, 'BA').status, 'nao_aplicar');
});

test('classificação não aplica benefício fora do catálogo apenas por ativação global', () => {
  const config = effectiveConvenio5291PartialConfig(undefined);
  const other = { ...product, ncm: '99999999' };
  assert.equal(classifyAnexoII(config, note, other, 'BA').status, 'fora_catalogo');
});
