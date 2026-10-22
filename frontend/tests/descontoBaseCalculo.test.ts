import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtractedItem, ExtractedNote } from '../src/lib/localProcessing/domain.ts';
import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

test('Tipagem de Desconto no Domínio: permite armazenar vDesc no item e vDescNota na nota', () => {
  const item: ExtractedItem = {
    itemNumero: 1,
    ncm: '84189900',
    cest: '',
    cfop: '6102',
    descricao: 'Item Teste',
    descricaoConfiavel: true,
    vItem: 8268,
    vTotal: 7275.84,
    baseCalculo: 7275.84,
    ipiDespesas: 0,
    aOri: 0.12,
    vIcms: 873.1,
    vDesc: 992.16,
  };
  assert.equal(item.vDesc, 992.16);

  const note: Partial<ExtractedNote> = {
    vTotalNota: 7275.84,
    vDescNota: 992.16,
  };
  assert.equal(note.vDescNota, 992.16);
});

test('Extração XML com Desconto: ajusta baseCalculo para valor líquido quando XML traz vBC bruto com desconto', async () => {
  const { parseNfeXml } = await import('../src/lib/localProcessing/xml.ts');
  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012345">
        <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>8268.00</vBC><vICMS>992.16</vICMS><vProd>8268.00</vProd><vDesc>992.16</vDesc><vNF>7275.84</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>8268.00</vProd><vDesc>992.16</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>8268.00</vBC><pICMS>12.00</pICMS><vICMS>992.16</vICMS></ICMS00></imposto></det>
      </infNFe>
    </NFe>`;
  const note = parseNfeXml(xml, 'teste.xml');
  assert.equal(note.vTotalNota, 7275.84);
  assert.equal(note.vDescNota, 992.16);
  assert.equal(note.itens[0].vTotal, 7275.84);
  assert.equal(note.itens[0].vDesc, 992.16);
  assert.equal(note.itens[0].baseCalculo, 7275.84);
});

test('Extração XML com Desconto: não reduz em duplicidade se o XML já enviou vBC líquido com o desconto abatido', async () => {
  const { parseNfeXml } = await import('../src/lib/localProcessing/xml.ts');
  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012346">
        <ide><nNF>1235</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>900.00</vBC><vICMS>108.00</vICMS><vProd>1000.00</vProd><vDesc>100.00</vDesc><vNF>900.00</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>1000.00</vProd><vDesc>100.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>900.00</vBC><pICMS>12.00</pICMS><vICMS>108.00</vICMS></ICMS00></imposto></det>
      </infNFe>
    </NFe>`;
  const note = parseNfeXml(xml, 'teste_ja_liquido.xml');
  assert.equal(note.itens[0].baseCalculo, 900.00);
});

test('Extração XML com múltiplos itens: abate vDesc de cada item proporcionalmente', async () => {
  const { parseNfeXml } = await import('../src/lib/localProcessing/xml.ts');
  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012347">
        <ide><nNF>1236</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>1500.00</vBC><vICMS>180.00</vICMS><vProd>1500.00</vProd><vDesc>200.00</vDesc><vNF>1300.00</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>PROD 1</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>1000.00</vProd><vDesc>200.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS></ICMS00></ICMS></imposto>
        </det>
        <det nItem="2">
          <prod><cProd>2</cProd><xProd>PROD 2</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>500.00</vProd><vDesc>0.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS><vICMS>60.00</vICMS></ICMS00></ICMS></imposto>
        </det>
      </infNFe>
    </NFe>`;
  const note = parseNfeXml(xml, 'teste_multi.xml');
  assert.equal(note.itens.length, 2);
  assert.equal(note.itens[0].vTotal, 800.00);
  assert.equal(note.itens[0].baseCalculo, 800.00);
  assert.equal(note.itens[0].vDesc, 200.00);
  assert.equal(note.itens[1].vTotal, 500.00);
  assert.equal(note.itens[1].baseCalculo, 500.00);
  assert.equal(note.itens[1].vDesc, 0.00);
});

test('Extração SPED Fiscal com Desconto em C170: ajusta baseCalculo para valor líquido', async () => {
  const { parseSped } = await import('../src/lib/localProcessing/sped.ts');
  const spedText = [
    '|0000|014|0|01042026|30042026|EMPRESA DESTINATARIA|22222222000192|BA|42903840|2927408|||A|1|',
    '|0150|FORN01|FORNECEDOR SP|1058|11111111000191||2927408||||',
    '|0200|ITEM01|PRODUTO REFRIGERACAO|||UN|01|84189900|||||||',
    '|C100|0|1|FORN01|55|00|1|1234|35260000000000000000550010000012341000012345|10042026|12042026|7275,84|0|992,16|0|8268,00|0|0|0|0|8268,00|992,16|0|0|0|0|0|',
    '|C170|1|ITEM01|1|UN|1|8268,00|992,16|0|000|6102|UN|8268,00|12,00|992,16|0|0|0|0|0||||0|0||||||',
    '|9999|6|',
  ].join('\r\n');

  const { notes } = parseSped(spedText, 'sped.txt');
  assert.equal(notes.length, 1);
  const note = notes[0];
  assert.equal(note.vTotalNota, 7275.84);
  assert.equal(note.vDescNota, 992.16);
  assert.equal(note.itens[0].vTotal, 7275.84);
  assert.equal(note.itens[0].baseCalculo, 7275.84);
  assert.equal(note.itens[0].vDesc, 992.16);
});

test('Processamento Local: gera linha da planilha com v_total e base_calculo líquidos de desconto', async () => {
  const { processFiscalLocally } = await import('../src/lib/localProcessing/processor.ts');
  const xml = `
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012345">
        <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>8268.00</vBC><vICMS>992.16</vICMS><vProd>8268.00</vProd><vDesc>992.16</vDesc><vNF>7275.84</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>8268.00</vProd><vDesc>992.16</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>8268.00</vBC><pICMS>12.00</pICMS><vICMS>992.16</vICMS></ICMS00></imposto></det>
      </infNFe>
    </NFe>`;
  const { parseNfeXml: _parseNfeXml } = await import('../src/lib/localProcessing/xml.ts');

  const context: any = {
    empresa: {
      id: 1,
      razao_social: 'Empresa Teste',
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
      id: 1, perfil_regras_id: null, cfop_sufixo: '102', destino: 'antecipacao_parcial',
      criado_em: '', atualizado_em: '',
    }],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [{
      id: 1,
      tipo: 'antecipacao_parcial',
      versao: 1,
      capacidade_linhas: 100,
      arquivo_hash: 'hash',
      mapeamento_campos: {
        start_row: 4,
        columns: { v_total: 'E', base_calculo: 'F' },
      },
    }],
    mva_anexo: [],
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  const templatePath = fs.existsSync('storage/templates/modelo_padrao_antecipacao_parcial.xlsx')
    ? path.resolve('storage/templates/modelo_padrao_antecipacao_parcial.xlsx')
    : path.resolve('../storage/templates/modelo_padrao_antecipacao_parcial.xlsx');
  const templateBuf = fs.readFileSync(templatePath);
  const templateBytes = new Map<number, ArrayBuffer>([
    [1, templateBuf.buffer.slice(templateBuf.byteOffset, templateBuf.byteOffset + templateBuf.byteLength)],
  ]);

  const xmlBlob = new Blob([xml], { type: 'application/xml' });
  const xmlFile = new File([xmlBlob], 'teste.xml');

  const result = await processFiscalLocally(
    {
      solicitacaoId: 'teste-desconto',
      periodoInicio: '2026-04-01',
      periodoFim: '2026-04-30',
      context,
      input: { xmlFiles: [xmlFile], spedFile: null, entrySheet: null },
    },
    templateBytes,
  );

  assert.equal(result.notasProcessadas.length, 1);
  const row = result.notasProcessadas[0];
  assert.equal(row.v_total, 7275.84);
  assert.equal(row.base_calculo, 7275.84);
});




