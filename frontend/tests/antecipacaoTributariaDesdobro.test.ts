import test from 'node:test';
import assert from 'node:assert/strict';

import { groupKey } from '../src/lib/localProcessing/processor.ts';
import {
  classifyRevendaMva,
  resolveRevendaMva,
} from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { MvaAntecipacaoTributariaConfig } from '../src/types/perfil.ts';

const configPasso: MvaAntecipacaoTributariaConfig = {
  enabled: true,
  empresa_cnpj: '33906322000153',
  special_ncms: ['42022100', '64029990', '64039990'],
  description_fallback_ncms: [],
  special_keywords: [],
  exclusion_keywords: [],
  mvas: {
    especial: { '4': '61.81', '7': '56.75', '12': '48.33', original: '34.00' },
    demais: { '4': '69.06', '7': '63.77', '12': '54.97', original: '40.00' },
  },
};

test('groupKey: itens com NCMs distintos mas mesma MVA e mesmas alíquotas geram a mesma chave (sem desdobramento)', () => {
  const itemBolsa: ExtractedItem = {
    itemNumero: 1,
    ncm: '42022100',
    cest: '',
    cfop: '6101',
    descricao: 'BOLSA FEMININA COURO',
    descricaoConfiavel: true,
    vItem: 2771.91,
    vTotal: 2952.07,
    baseCalculo: 2771.91,
    ipiDespesas: 180.16,
    aOri: 0.07,
    vIcms: 194.03,
  };

  const itemCalcado: ExtractedItem = {
    itemNumero: 2,
    ncm: '64029990',
    cest: '',
    cfop: '6101',
    descricao: 'SANDALIA RASTEIRA',
    descricaoConfiavel: true,
    vItem: 1461.36,
    vTotal: 1461.36,
    baseCalculo: 1461.36,
    ipiDespesas: 0,
    aOri: 0.07,
    vIcms: 102.30,
  };

  const classBolsa = classifyRevendaMva(configPasso, itemBolsa);
  const classCalcado = classifyRevendaMva(configPasso, itemCalcado);

  const mvaBolsa = resolveRevendaMva(configPasso, classBolsa.grupo, itemBolsa.aOri, false);
  const mvaCalcado = resolveRevendaMva(configPasso, classCalcado.grupo, itemCalcado.aOri, false);

  assert.equal(mvaBolsa, 56.75);
  assert.equal(mvaCalcado, 56.75);

  const aDst = 0.205;
  const key1 = groupKey('antecipacao_tributaria_antecipado', itemBolsa.aOri, aDst, mvaBolsa, false);
  const key2 = groupKey('antecipacao_tributaria_antecipado', itemCalcado.aOri, aDst, mvaCalcado, false);

  // Devem ser idênticas para não desdobrar em 2 linhas
  assert.equal(key1, key2);
});

test('groupKey: itens com MVAs divergentes geram chaves diferentes (desdobramento em 2 linhas)', () => {
  const aOri = 0.07;
  const aDst = 0.205;

  const mvaEspecial = 56.75;
  const mvaDemais = 63.77;

  const keyEspecial = groupKey('antecipacao_tributaria', aOri, aDst, mvaEspecial, false);
  const keyDemais = groupKey('antecipacao_tributaria', aOri, aDst, mvaDemais, false);

  assert.notEqual(keyEspecial, keyDemais);
});

test('groupKey: itens com alíquotas interestaduais (A.ORI) divergentes geram chaves diferentes', () => {
  const aDst = 0.205;
  const mva = 56.75;

  const key7 = groupKey('antecipacao_tributaria', 0.07, aDst, mva, false);
  const key4 = groupKey('antecipacao_tributaria', 0.04, aDst, mva, false);

  assert.notEqual(key7, key4);
});

test('groupKey: itens com alíquotas internas (A.DST) divergentes geram chaves diferentes', () => {
  const aOri = 0.07;
  const mva = 56.75;

  const key205 = groupKey('antecipacao_tributaria', aOri, 0.205, mva, false);
  const key18 = groupKey('antecipacao_tributaria', aOri, 0.18, mva, false);

  assert.notEqual(key205, key18);
});
