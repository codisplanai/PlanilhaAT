import assert from 'node:assert/strict';
import test from 'node:test';
import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import { resolveDestinationRate, resolveTributariaReduction } from '../src/lib/localProcessing/rules.ts';
import type { ExtractedItem } from '../src/lib/localProcessing/domain.ts';
import type { RegraReducao } from '../src/types/regraReducao.ts';
import { buildContext, chave, processar, spedJaneiro } from './localFixtures.ts';

const CANTONEIRA = 'CANTONEIRA 1 X 1/8 6M ASTM A36';

function regra(
  id: number,
  ncm: string,
  termos: string[],
  aliquota: number,
  extra: Partial<RegraReducao> = {},
): RegraReducao {
  return {
    id,
    perfil_regras_id: 1,
    ncm,
    termos_inclusao: termos,
    termos_exclusao: [],
    aliquota,
    escopo: 'antecipacao_parcial',
    descricao: null,
    excecoes: [],
    criado_em: '2026-11-18T00:00:00Z',
    atualizado_em: '2026-11-18T00:00:00Z',
    ...extra,
  };
}

function excecao(id: number, regraId: number, descricao: string, enquadrado = true) {
  return {
    id,
    regra_reducao_id: regraId,
    descricao_exata: descricao,
    enquadrado,
    observacao: null,
    criado_em: '2026-11-18T00:00:00Z',
    atualizado_em: '2026-11-18T00:00:00Z',
  };
}

function item(descricao: string, ncm = '72162100', descricaoConfiavel = true): ExtractedItem {
  return {
    itemNumero: 3,
    ncm,
    cest: '',
    cfop: '6102',
    descricao,
    descricaoConfiavel,
    vItem: 1000,
    vTotal: 1000,
    baseCalculo: 1000,
    ipiDespesas: 0,
    aOri: 0.07,
  } as ExtractedItem;
}

function contextoCom(regras: RegraReducao[]) {
  const context = buildContext();
  context.regras_reducao = regras;
  return context;
}

test('regras redundantes com a mesma alíquota: aplica a alíquota e devolve aviso', () => {
  // Caso real (perfil BAHIA FERRO SALVADOR): "CANT*" já cobre "CANTONEIRA*".
  const context = contextoCom([
    regra(22, '72162100', ['CANT*'], 0.12),
    regra(21, '72162100', ['CANTONEIRA*'], 0.12),
  ]);

  const res = resolveDestinationRate(context, item(CANTONEIRA), 'antecipacao_parcial');

  assert.equal(res.aliquota, 0.12);
  assert.equal(res.origem, 'reducao_produto:21', 'origem determinística: menor id');
  assert.match(res.detalhe, /regras #21 e #22 \(mesma alíquota de 12,00%\)/);
  assert.ok(res.aviso, 'esperava aviso de regras redundantes');
  assert.match(res.aviso!, /#21 \(termo "CANTONEIRA\*"\) e #22 \(termo "CANT\*"\)/);
  assert.match(res.aviso!, /aba Antecipação Parcial/);
  assert.match(res.aviso!, new RegExp(`"${CANTONEIRA}" \\(NCM 72162100\\)`));
  assert.match(res.aviso!, /todas com 12,00%; a alíquota foi aplicada/);
});

test('regras com alíquotas diferentes: conflito lista regras, termos, valores e a instrução', () => {
  const context = contextoCom([
    regra(21, '72162100', ['CANTONEIRA*'], 0.12, { descricao: 'Perfis — Decreto X' }),
    regra(22, '72162100', ['CANT*', 'PERFIL L'], 0.18),
  ]);

  assert.throws(
    () => resolveDestinationRate(context, item(CANTONEIRA), 'antecipacao_parcial'),
    (error: Error) => {
      const msg = error.message;
      assert.ok(msg.startsWith(`Conflito de regras de redução no item "${CANTONEIRA}" (NCM 72162100).`));
      assert.match(msg, /aba Antecipação Parcial casaram o mesmo item com valores diferentes/);
      assert.match(msg, /#21 "Perfis — Decreto X" — NCM 72162100, 12,00%, casou com o termo "CANTONEIRA\*"/);
      // Só o termo que casou aparece, não todos os termos da regra.
      assert.match(msg, /#22 sem descrição — NCM 72162100, 18,00%, casou com o termo "CANT\*"$/m);
      assert.match(msg, /Cadastre uma exceção com a descrição exata deste item na regra que deve prevalecer/);
      return true;
    },
  );
});

test('exceção enquadrada na regra que deve prevalecer resolve o conflito de alíquotas', () => {
  const context = contextoCom([
    regra(21, '72162100', ['CANTONEIRA*'], 0.12, {
      excecoes: [excecao(5, 21, 'CANTONEIRA 1 X 1 8 6M ASTM A36')],
    }),
    regra(22, '72162100', ['CANT*'], 0.18),
  ]);

  const res = resolveDestinationRate(context, item(CANTONEIRA), 'antecipacao_parcial');
  assert.equal(res.aliquota, 0.12);
  assert.equal(res.origem, 'excecao:5');
  assert.equal(res.aviso, undefined);
});

test('regra mais específica continua vencendo sem conflito nem aviso', () => {
  const context = contextoCom([
    regra(21, '7216', ['CANT*'], 0.18),
    regra(22, '72162100', ['CANT*'], 0.12),
  ]);

  const res = resolveDestinationRate(context, item(CANTONEIRA), 'antecipacao_parcial');
  assert.equal(res.aliquota, 0.12);
  assert.equal(res.origem, 'reducao_produto:22');
  assert.equal(res.aviso, undefined);
});

test('duas exceções enquadradas com a mesma alíquota: aplica e avisa', () => {
  const desc = 'CANTONEIRA 1 X 1 8 6M ASTM A36';
  const context = contextoCom([
    regra(21, '72162100', ['CANTONEIRA*'], 0.12, { excecoes: [excecao(7, 21, desc)] }),
    regra(22, '72162100', ['CANT*'], 0.12, { excecoes: [excecao(6, 22, desc)] }),
  ]);

  const res = resolveDestinationRate(context, item(CANTONEIRA), 'antecipacao_parcial');
  assert.equal(res.aliquota, 0.12);
  assert.equal(res.origem, 'excecao:7', 'origem da regra de menor id');
  assert.match(res.detalhe, /Exceções cadastradas nas regras #21 e #22/);
  assert.match(res.aviso!, /as exceções das reduções #21 \(exceção #7\) e #22 \(exceção #6\)/);
});

test('duas exceções enquadradas com alíquotas diferentes: conflito de exceções', () => {
  const desc = 'CANTONEIRA 1 X 1 8 6M ASTM A36';
  const context = contextoCom([
    regra(21, '72162100', ['CANTONEIRA*'], 0.12, { excecoes: [excecao(7, 21, desc)] }),
    regra(22, '72162100', ['CANT*'], 0.18, { excecoes: [excecao(6, 22, desc)] }),
  ]);

  assert.throws(
    () => resolveDestinationRate(context, item(CANTONEIRA), 'antecipacao_parcial'),
    (error: Error) => {
      assert.ok(error.message.startsWith('Conflito de exceções de redução no item'));
      assert.match(error.message, /#21 sem descrição — NCM 72162100, 12,00%, casou pela exceção de descrição exata #7/);
      assert.match(error.message, /Mantenha a exceção com esta descrição só na regra que deve prevalecer/);
      return true;
    },
  );
});

test('regras sem termos para o mesmo NCM: mesma alíquota aplica, alíquotas diferentes conflitam', () => {
  const iguais = contextoCom([regra(31, '7216', [], 0.12), regra(32, '7216', [], 0.12)]);
  const sped = item('Item Analítico C190 #1 (CFOP 2102)', '72162100', false);
  const res = resolveDestinationRate(iguais, sped, 'antecipacao_parcial');
  assert.equal(res.aliquota, 0.12);
  assert.match(res.aviso!, /#31 \(sem termos\) e #32 \(sem termos\)/);

  const diferentes = contextoCom([regra(31, '7216', [], 0.12), regra(32, '7216', [], 0.18)]);
  assert.throws(
    () => resolveDestinationRate(diferentes, sped, 'antecipacao_parcial'),
    /#32 sem descrição — NCM 7216, 18,00%, sem termos de inclusão \(vale para todo o NCM\)/,
  );
});

test('Antecipação Tributária: reduções de base redundantes usam "redução" e três casas', () => {
  const context = contextoCom([
    regra(41, '72142000', ['VERG*'], 0.41463, { escopo: 'antecipacao_tributaria' }),
    regra(42, '72142000', ['VERGALH*'], 0.41463, { escopo: 'antecipacao_tributaria' }),
  ]);

  const res = resolveTributariaReduction(context, item('VERGALHAO CA50 10MM', '72142000'));
  assert.equal(res?.aliquota, 0.41463);
  assert.match(res!.detalhe, /mesma redução de 41,463%/);
  assert.match(res!.aviso!, /aba Antecipação Tributária/);
  assert.match(res!.aviso!, /todas com 41,463%; a redução foi aplicada/);
});

function xmlCantoneira(numero: number): string {
  const chaveAcesso = chave('2601', numero);
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe>
  <infNFe Id="NFe${chaveAcesso}">
    <ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>98765432000180</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
    <total><ICMSTot><vProd>1000.00</vProd><vBC>1000.00</vBC><vNF>1000.00</vNF></ICMSTot></total>
    <det nItem="1"><prod><cProd>C1</cProd><xProd>${CANTONEIRA}</xProd><NCM>72162100</NCM><CFOP>6102</CFOP><vProd>1000.00</vProd></prod>
    <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>7.00</pICMS></ICMS00></ICMS></imposto></det>
  </infNFe></NFe></nfeProc>`;
}

function spedCantoneira(numero: number): string {
  return spedJaneiro([
    { numero: String(numero), chave: chave('2601', numero), dtDoc: '10012026', dtEntrada: '20012026', itens: [['2102', '1000,00']] },
  ]);
}

test('processamento local: regras redundantes não travam e o aviso sai com nota e item', async () => {
  const context = contextoCom([
    regra(21, '72162100', ['CANTONEIRA*'], 0.12),
    regra(22, '72162100', ['CANT*'], 0.12),
  ]);

  const result = await processar(context, {
    sped: spedCantoneira(1699),
    xmls: [['1699.xml', xmlCantoneira(1699)]],
  });

  const row = result.rowsByDestination.antecipacao_parcial?.[0];
  assert.ok(row, 'esperava linha de Antecipação Parcial');
  assert.equal(row.a_dst, 0.12);
  const aviso = result.avisosAvaliacao.find((entry) => entry.aviso.includes('reduções por produto'));
  assert.ok(aviso, 'esperava aviso de regras redundantes');
  assert.equal(aviso.numero_nota, '1699');
  assert.equal(aviso.item_numero, 1);
  assert.ok(aviso.arquivo, 'esperava o arquivo de origem da nota');
  assert.match(aviso.aviso, /^Item 1: As reduções por produto #21 \(termo "CANTONEIRA\*"\) e #22 \(termo "CANT\*"\)/);
});

test('processamento local: conflito de alíquotas para com a NF-e e o arquivo na mensagem', async () => {
  const context = contextoCom([
    regra(21, '72162100', ['CANTONEIRA*'], 0.12),
    regra(22, '72162100', ['CANT*'], 0.18),
  ]);

  await assert.rejects(
    () => processar(context, {
      sped: spedCantoneira(1699),
      xmls: [['1699.xml', xmlCantoneira(1699)]],
    }),
    (error: Error) => {
      // Com SPED e XML, a nota leva o arquivo do SPED; o que importa é a NF-e.
      assert.match(
        error.message,
        /^NF-e 1699 \(arquivo [^)]+\): Conflito de regras de redução no item "CANTONEIRA 1 X 1\/8 6M ASTM A36" \(NCM 72162100\)\./,
      );
      assert.match(error.message, /#21 sem descrição — NCM 72162100, 12,00%/);
      assert.match(error.message, /#22 sem descrição — NCM 72162100, 18,00%/);
      return true;
    },
  );
});
