// Só notas autorizadas (com ou sem carta de correção) entram na apuração.
// Os XMLs são sintéticos, com a mesma estrutura dos arquivos de evento/inutilização da SEFAZ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomParserPolyfill } from './domPolyfill.ts';
import { buildContext, chave, processar, spedJaneiro, xmlNfe } from './localFixtures.ts';
import {
  NfeEventRegistry,
  parseNfeEventDoc,
  parseNfeInutDoc,
} from '../src/lib/localProcessing/nfeEvents.ts';
import { parseXmlDocument } from '../src/lib/localProcessing/xml.ts';

installDomParserPolyfill();

const FORNECEDOR = '98765432000180';

function evento(chaveNfe: string, tp = '110111', cStat = '135', desc = 'Cancelamento'): string {
  const ret = cStat
    ? `<retEvento versao="1.00"><infEvento Id="ID1"><tpAmb>1</tpAmb><cStat>${cStat}</cStat><chNFe>${chaveNfe}</chNFe>`
      + `<tpEvento>${tp}</tpEvento><xEvento>${desc} Homologado</xEvento><nSeqEvento>1</nSeqEvento>`
      + '<dhRegEvento>2026-01-20T16:00:55-03:00</dhRegEvento><nProt>135260000000009</nProt></infEvento></retEvento>'
    : '';
  return `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00">`
    + `<infEvento Id="ID${tp}${chaveNfe}01"><cOrgao>35</cOrgao><tpAmb>1</tpAmb><CNPJ>${FORNECEDOR}</CNPJ>`
    + `<chNFe>${chaveNfe}</chNFe><dhEvento>2026-01-20T16:00:40-03:00</dhEvento><tpEvento>${tp}</tpEvento>`
    + `<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${desc}</descEvento>`
    + `</detEvento></infEvento></evento>${ret}</procEventoNFe>`;
}

function inutilizacao(ini: number, fim: number, cStat = '102'): string {
  return `<ProcInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><inutNFe versao="4.00">`
    + `<infInut Id="ID35"><tpAmb>1</tpAmb><xServ>INUTILIZAR</xServ><cUF>35</cUF><ano>26</ano><CNPJ>${FORNECEDOR}</CNPJ>`
    + `<mod>55</mod><serie>1</serie><nNFIni>${ini}</nNFIni><nNFFin>${fim}</nNFFin><xJust>Falha na numeracao</xJust></infInut></inutNFe>`
    + `<retInutNFe versao="4.00"><infInut><tpAmb>1</tpAmb><cStat>${cStat}</cStat><cUF>35</cUF><ano>26</ano>`
    + `<CNPJ>${FORNECEDOR}</CNPJ><mod>55</mod><serie>1</serie><nNFIni>${ini}</nNFIni><nNFFin>${fim}</nNFFin>`
    + '<nProt>135260000000010</nProt></infInut></retInutNFe></ProcInutNFe>';
}

function comProtocolo(xml: string, chaveNfe: string, cStat = '100'): string {
  return xml.replace(
    '</nfeProc>',
    `<protNFe versao="4.00"><infProt><chNFe>${chaveNfe}</chNFe><nProt>135260000000001</nProt><cStat>${cStat}</cStat></infProt></protNFe></nfeProc>`,
  );
}

function nota(numero: number, cStat = '100'): { numero: string; chave: string; xml: string } {
  const chaveNfe = chave('2601', numero);
  return {
    numero: String(numero),
    chave: chaveNfe,
    xml: comProtocolo(xmlNfe(String(numero), chaveNfe, '1000.00', '2026-01-10', '6102'), chaveNfe, cStat),
  };
}

function spedDe(...notas: Array<{ numero: string; chave: string }>): string {
  return spedJaneiro(notas.map((n) => ({
    numero: n.numero, chave: n.chave, dtDoc: '10012026', dtEntrada: '20012026', itens: [['2102', '1000,00']],
  })));
}

const numeros = (result: Awaited<ReturnType<typeof processar>>) =>
  result.notasProcessadas.map((n) => n.numero_nota).sort();
const motivo = (result: Awaited<ReturnType<typeof processar>>, numero: string) =>
  result.notasIgnoradas.find((n) => n.numero_nota === numero)?.motivo ?? '';

test('lê evento de cancelamento homologado', () => {
  const ev = parseNfeEventDoc(parseXmlDocument(evento(chave('2601', 701)), 'ev.xml'))!;
  assert.equal(ev.tpEvento, '110111');
  assert.equal(ev.cStat, '135');
  assert.equal(ev.protocolo, '135260000000009');
  const registry = new NfeEventRegistry();
  registry.addEvent(ev);
  assert.match(registry.invalidityReason({ chaveAcesso: ev.chave, cnpjEmitente: '', serie: '', numeroNota: '' }) ?? '', /cancelada/);
});

test('evento não homologado e carta de correção não invalidam a nota', () => {
  const registry = new NfeEventRegistry();
  for (const xml of [evento(chave('2601', 702), '110111', ''), evento(chave('2601', 702), '110110', '135', 'Carta de Correcao')]) {
    registry.addEvent(parseNfeEventDoc(parseXmlDocument(xml, 'ev.xml'))!);
  }
  assert.equal(registry.invalidityReason({ chaveAcesso: chave('2601', 702), cnpjEmitente: '', serie: '', numeroNota: '' }), null);
  assert.equal(registry.cartasCorrecao, 1);
});

test('inutilização cobre a faixa de numeração do emitente e da série', () => {
  const inut = parseNfeInutDoc(parseXmlDocument(inutilizacao(10, 20), 'inut.xml'))!;
  assert.equal(inut.numeroIni, 10);
  assert.equal(inut.cStat, '102');
  const registry = new NfeEventRegistry();
  registry.addInutilizacao(inut);
  const base = { chaveAcesso: '', cnpjEmitente: FORNECEDOR, serie: '1' };
  assert.ok(registry.invalidityReason({ ...base, numeroNota: '15' }));
  assert.equal(registry.invalidityReason({ ...base, numeroNota: '21' }), null);
  assert.equal(registry.invalidityReason({ ...base, serie: '2', numeroNota: '15' }), null);
});

test('nota cancelada (XML + SPED) é desconsiderada e as demais seguem', async () => {
  const cancelada = nota(711);
  const valida = nota(712);
  const result = await processar(buildContext(), {
    sped: spedDe(cancelada, valida),
    xmls: [['cancelada.xml', cancelada.xml], ['valida.xml', valida.xml], ['evento.xml', evento(cancelada.chave)]],
  });
  assert.deepEqual(numeros(result), ['712']);
  const reason = motivo(result, '711');
  assert.match(reason, /cancelada/);
  assert.match(reason, /110111/);
  assert.match(reason, /20\/01\/2026/);
});

test('a ordem dos arquivos no ZIP não importa', async () => {
  const cancelada = nota(713);
  const valida = nota(714);
  const result = await processar(buildContext(), {
    xmls: [['evento.xml', evento(cancelada.chave)], ['valida.xml', valida.xml], ['cancelada.xml', cancelada.xml]],
  });
  assert.deepEqual(numeros(result), ['714']);
});

test('cancelamento por substituição também desconsidera a nota', async () => {
  const cancelada = nota(715);
  const valida = nota(716);
  const result = await processar(buildContext(), {
    xmls: [
      ['a.xml', cancelada.xml], ['b.xml', valida.xml],
      ['ev.xml', evento(cancelada.chave, '110112', '135', 'Cancelamento por substituicao')],
    ],
  });
  assert.deepEqual(numeros(result), ['716']);
});

test('carta de correção mantém a nota', async () => {
  const a = nota(721);
  const b = nota(722);
  const result = await processar(buildContext(), {
    xmls: [['a.xml', a.xml], ['b.xml', b.xml], ['cce.xml', evento(a.chave, '110110', '135', 'Carta de Correcao')]],
  });
  assert.deepEqual(numeros(result), ['721', '722']);
});

test('nota inutilizada é desconsiderada', async () => {
  const inutilizada = nota(731);
  const valida = nota(740);
  const result = await processar(buildContext(), {
    xmls: [['a.xml', inutilizada.xml], ['b.xml', valida.xml], ['inut.xml', inutilizacao(730, 735)]],
  });
  assert.deepEqual(numeros(result), ['740']);
  assert.match(motivo(result, '731'), /inutilizada/);
});

test('uso denegado no protocolo é desconsiderado; XML sem protocolo segue válido', async () => {
  const denegada = nota(741, '110');
  const semProtocolo = xmlNfe('742', chave('2601', 742), '1000.00', '2026-01-10', '6102');
  const result = await processar(buildContext(), {
    xmls: [['a.xml', denegada.xml], ['b.xml', semProtocolo]],
  });
  assert.deepEqual(numeros(result), ['742']);
  assert.match(motivo(result, '741'), /denegado/);
});

test('todas canceladas gera mensagem clara', async () => {
  const cancelada = nota(751);
  await assert.rejects(
    processar(buildContext(), { xmls: [['a.xml', cancelada.xml], ['ev.xml', evento(cancelada.chave)]] }),
    /canceladas, inutilizadas ou não autorizadas/,
  );
});
