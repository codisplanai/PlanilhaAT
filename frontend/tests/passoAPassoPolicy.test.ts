import assert from 'node:assert/strict';
import test from 'node:test';
import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import {
  classifyRevendaMva,
  getRevendaAntecipacaoConfig,
  redirectRevendaToAntecipacaoTributaria,
  routePaidEarlyDestination,
  resolveRevendaMva,
} from '../src/lib/localProcessing/rules.ts';
import { processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';
import type { MvaAntecipacaoTributariaConfig } from '../src/types/perfil.ts';

const config: MvaAntecipacaoTributariaConfig = {
  enabled: true,
  empresa_cnpj: '33906322000153',
  special_ncms: ['64039990'],
  description_fallback_ncms: ['62171000'],
  special_keywords: ['CINTO', 'CINTOS'],
  exclusion_keywords: ['MOCHILA', 'PALMILHA'],
  mvas: {
    especial: { '4': '61.81', '7': '56.75', '12': '48.33', original: '34.00' },
    demais: { '4': '69.06', '7': '63.77', '12': '54.97', original: '40.00' },
  },
};

function context(cnpj = '33906322000153'): LocalProcessingContext {
  return {
    empresa: {
      id: 1,
      razao_social: 'Passo a Passo Calçados',
      cnpj,
      inscricao_estadual: '26058360',
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
    },
    perfil: {
      id: 1,
      nome: 'Passo a Passo Calçados',
      configuracoes_extras: { mva_revenda_antecipacao_tributaria: config },
    },
    regras_aliquotas: [],
    regras_cfop: [],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [],
    mva_anexo: [],
  };
}

const shoe: ExtractedItem = {
  itemNumero: 1,
  ncm: '64039990',
  cest: '',
  cfop: '6102',
  descricao: 'CALÇADO FEMININO',
  descricaoConfiavel: true,
  vItem: 1000,
  vTotal: 1000,
  baseCalculo: 1000,
  ipiDespesas: 0,
  aOri: 0.07,
  vIcms: 70,
};

test('ativa a política somente para o CNPJ configurado', () => {
  assert.equal(getRevendaAntecipacaoConfig(context())?.empresa_cnpj, config.empresa_cnpj);
  assert.equal(getRevendaAntecipacaoConfig(context('12345678000195')), null);
});

test('redireciona toda revenda da Passo a Passo para Antecipação Tributária', () => {
  const active = getRevendaAntecipacaoConfig(context());
  assert.equal(
    redirectRevendaToAntecipacaoTributaria(active, 'antecipacao_parcial'),
    'antecipacao_tributaria',
  );
  assert.equal(redirectRevendaToAntecipacaoTributaria(active, 'difal'), 'difal');
});

test('separa a antecipação tributária paga antecipadamente', () => {
  assert.equal(
    routePaidEarlyDestination('antecipacao_tributaria', true),
    'antecipacao_tributaria_antecipado',
  );
  assert.equal(
    routePaidEarlyDestination('antecipacao_tributaria', false),
    'antecipacao_tributaria',
  );
  assert.equal(routePaidEarlyDestination('difal', true), 'difal');
});

test('classifica o produto e usa as MVAs exclusivas inclusive para fornecedor Simples', () => {
  const classification = classifyRevendaMva(config, shoe);
  assert.deepEqual(classification, { grupo: 'especial', fonte: 'ncm_exato' });
  assert.equal(resolveRevendaMva(config, classification.grupo, 0.07, false), 56.75);
  assert.equal(resolveRevendaMva(config, classification.grupo, 0.07, true), 34);
});

test('processamento local Passo a Passo: nota com entrada confirmada no SPED mantém data_entrada na Antecipação Tributária', async () => {
  const spedContent = [
    '|0000|019|0|01102026|31102026|Passo a Passo Calçados|33906322000153||BA|26058360|2927408|||A|1|',
    '|0150|F1|FORNECEDOR SP|1058|11222333000181||SP|3550308||R|1||C|',
    '|0200|P1|CALCADO FEMININO|||UN|01|64039990|||18,00||',
    '|C100|0|1|F1|55|00|1|25149|35261011222333000181550010000251491000025149|02102026|09102026|1000,00|0|0,00|0,00|1000,00|0|0,00|0,00|0,00|1000,00|70,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
    '|C170|1|P1|CALCADO FEMININO|1,000|UN|1000,00|0,00|0|000|6102||1000,00|7,00|70,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|',
    '|9999|6|',
  ].join('\n');

  const ctx = context();
  ctx.regras_cfop = [{ id: 1, perfil_regras_id: 1, cfop_sufixo: '102', destino: 'antecipacao_parcial', reclassificar_para: null, motivo: null }];
  ctx.regras_aliquotas = [{ id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205 } as never];
  ctx.templates_ativos = [{
    id: 12,
    tipo: 'antecipacao_tributaria',
    versao: 3,
    ativo: true,
    capacidade_linhas: 35,
    arquivo_path: '',
    arquivo_hash: '',
    mapeamento_campos: {
      start_row: 4,
      columns: {
        data_entrada: 'B',
        data_emissao: 'C',
        numero_nota: 'D',
        v_total: 'E',
        base_calculo: 'F',
        ipi_despesas: 'G',
        mva: 'H',
        a_dst: 'J',
        a_ori: 'K',
      },
    },
  }];



  const fs = await import('node:fs');
  const path = await import('node:path');
  const templatePath = fs.existsSync('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx')
    ? path.resolve('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx')
    : path.resolve('../storage/templates/modelo_padrao_antecipacao_tributaria.xlsx');
  const templateBuf = fs.readFileSync(templatePath);
  const templateBytes = new Map<number, ArrayBuffer>([
    [12, templateBuf.buffer.slice(templateBuf.byteOffset, templateBuf.byteOffset + templateBuf.byteLength)],
  ]);

  const result = await processFiscalLocally(
    {
      solicitacaoId: 'teste-passo-data-entrada',
      periodoInicio: '2026-10-01',
      periodoFim: '2026-10-31',
      context: ctx,
      input: { xmlFiles: [], spedFile: new File([spedContent], 'sped.txt'), entrySheet: null },
    },
    templateBytes,
  );

  assert.equal(result.notasProcessadas.length, 1);
  const [nota] = result.notasProcessadas;
  assert.equal(nota.destino_planilha, 'antecipacao_tributaria');
  assert.equal(nota.data_emissao, '2026-10-02T00:00:00');
  assert.equal(nota.data_entrada, '2026-10-09');
  assert.equal(nota.origem_data_entrada, 'sped_fiscal');
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].tipo, 'antecipacao_tributaria');
});


