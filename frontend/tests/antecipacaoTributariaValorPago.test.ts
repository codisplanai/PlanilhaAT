import assert from 'node:assert/strict';
import test from 'node:test';
import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import { calculateTax } from '../src/lib/localProcessing/calculations.ts';
import { parseNfeXml } from '../src/lib/localProcessing/xml.ts';
import { processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

const SAMPLE_XML_WITH_ST = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260814515925000180550010000508831030783820">
      <ide>
        <cUF>35</cUF>
        <nNF>50883</nNF>
        <serie>1</serie>
        <dhEmi>2026-08-10T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>14515925000180</CNPJ>
        <xNome>FORNECEDOR SP</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>14064976000132</CNPJ>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <total>
        <ICMSTot>
          <vNF>1000.00</vNF>
          <vBC>1000.00</vBC>
          <vICMS>70.00</vICMS>
          <vST>50.00</vST>
        </ICMSTot>
      </total>
      <det nItem="1">
        <prod>
          <cProd>101</cProd>
          <xProd>PRODUTO COM ST DESTACADA</xProd>
          <NCM>84649090</NCM>
          <CFOP>6403</CFOP>
          <vProd>1000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS10>
              <orig>0</orig>
              <CST>10</CST>
              <vBC>1000.00</vBC>
              <pICMS>7.00</pICMS>
              <vICMS>70.00</vICMS>
              <vBCST>1500.00</vBCST>
              <pICMSST>20.50</pICMSST>
              <vICMSST>50.00</vICMSST>
            </ICMS10>
          </ICMS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`;

const SAMPLE_XML_ST_EXCEEDS = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260814515925000180550010000508831030783821">
      <ide>
        <cUF>35</cUF>
        <nNF>50884</nNF>
        <serie>1</serie>
        <dhEmi>2026-08-10T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>14515925000180</CNPJ>
        <xNome>FORNECEDOR SP</xNome>
        <enderEmit><UF>SP</UF></enderEmit>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>14064976000132</CNPJ>
        <enderDest><UF>BA</UF></enderDest>
      </dest>
      <total>
        <ICMSTot>
          <vNF>1000.00</vNF>
          <vBC>1000.00</vBC>
          <vICMS>70.00</vICMS>
          <vST>400.00</vST>
        </ICMSTot>
      </total>
      <det nItem="1">
        <prod>
          <cProd>102</cProd>
          <xProd>PRODUTO COM ST SUPERIOR</xProd>
          <NCM>84649090</NCM>
          <CFOP>6403</CFOP>
          <vProd>1000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS10>
              <orig>0</orig>
              <CST>10</CST>
              <vBC>1000.00</vBC>
              <pICMS>7.00</pICMS>
              <vICMS>70.00</vICMS>
              <vBCST>2000.00</vBCST>
              <pICMSST>20.50</pICMSST>
              <vICMSST>400.00</vICMSST>
            </ICMS10>
          </ICMS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`;

function buildContext(): LocalProcessingContext {
  return {
    empresa: {
      id: 74,
      razao_social: 'COMAPEL COMERCIO INDUSTRIA E AGRICULTURA LTDA',
      cnpj: '14064976000132',
      inscricao_estadual: '08194549',
      uf: 'BA',
      perfil_regras_id: 1,
      optante_simples_nacional: false,
    },
    perfil: {
      id: 1,
      nome: 'Perfil Padrão',
      configuracoes_extras: {},
    },
    regras_aliquotas: [{ id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205 } as never],
    regras_cfop: [
      { id: 1, perfil_regras_id: 1, cfop_sufixo: '403', destino: 'antecipacao_tributaria', reclassificar_para: null, motivo: null },
    ],
    regras_reducao: [],
    regras_reclassificacao: [],
    regras_exclusao_parcial: [],
    margens_seguranca_templates: {},
    templates_ativos: [
      {
        id: 1,
        tipo: 'antecipacao_tributaria',
        nome_arquivo: 'template.xlsx',
        capacidade_linhas: 100,
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
            valor_pago: 'S',
          },
        },
      },
    ],
    mva_anexo: [
      {
        ncm: '84649090',
        item: '1.1',
        cest: [],
        mva_original: [{ caso: null, valor: 40 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 40, '7': 40, '12': 40 } }],
      },
    ],
  };
}

test('calculateTax: deduz valorPago do valorDevido em antecipacao_tributaria', () => {
  const result = calculateTax('antecipacao_tributaria', {
    vTotal: 1000,
    baseCalculo: 1000,
    ipiDespesas: 0,
    aOri: 0.07,
    aDst: 0.205,
    mva: 40,
    valorPago: 50,
  });

  // Base ST = 1000 * 1.40 = 1400
  // Débito = 1400 * 0.205 = 287.00
  // Crédito = 1000 * 0.07 = 70.00
  // Bruto = 287 - 70 = 217.00
  // Valor Devido = 217 - 50 = 167.00
  assert.equal(result.debito, 287.0);
  assert.equal(result.credito, 70.0);
  assert.equal(result.valorDevido, 167.0);
  assert.equal(result.detalhes.valor_pago, 50.0);
});

test('parseNfeXml: extrai vICMSST do item e vST da nota', () => {
  const parsed = parseNfeXml(SAMPLE_XML_WITH_ST, 'nota_st.xml');
  assert.equal(parsed.vStNota, 50.0);
  assert.equal(parsed.itens.length, 1);
  assert.equal(parsed.itens[0].vIcmsSt, 50.0);
});

test('processFiscalLocally: preenche valor_pago na linha quando ha diferenca positiva', async () => {
  const context = buildContext();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const templatePath = fs.existsSync('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx')
    ? path.resolve('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx')
    : path.resolve('../storage/templates/modelo_padrao_antecipacao_tributaria.xlsx');
  const templateBuf = fs.readFileSync(templatePath);
  const templateBytes = new Map<number, ArrayBuffer>([
    [1, templateBuf.buffer.slice(templateBuf.byteOffset, templateBuf.byteOffset + templateBuf.byteLength)],
  ]);

  const result = await processFiscalLocally(
    {
      solicitacaoId: 'teste-st-positivo',
      periodoInicio: '2026-08-01',
      periodoFim: '2026-08-31',
      context,
      input: {
        xmlFiles: [new File([SAMPLE_XML_WITH_ST], 'nota_st.xml')],
        spedFile: null,
        entrySheet: null,
      },
    },
    templateBytes,
  );

  assert.equal(result.notasProcessadas.length, 1);
  const nota = result.notasProcessadas[0];
  assert.equal(nota.numero_nota, '50883');
  assert.equal(nota.destino_planilha, 'antecipacao_tributaria');
  assert.equal(nota.debito, 287.0); // MVA 40%: 1000 * 1.4 * 0.205 = 287.00
  assert.equal(nota.credito, 70.0);
  assert.equal(nota.valor_devido, 167.0); // (287 - 70) - 50 = 167.00
});

test('processFiscalLocally: exclui da planilha quando ICMS ST cobre ou supera o imposto apurado', async () => {
  const context = buildContext();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const templatePath = fs.existsSync('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx')
    ? path.resolve('storage/templates/modelo_padrao_antecipacao_tributaria.xlsx')
    : path.resolve('../storage/templates/modelo_padrao_antecipacao_tributaria.xlsx');
  const templateBuf = fs.readFileSync(templatePath);
  const templateBytes = new Map<number, ArrayBuffer>([
    [1, templateBuf.buffer.slice(templateBuf.byteOffset, templateBuf.byteOffset + templateBuf.byteLength)],
  ]);

  const result = await processFiscalLocally(
    {
      solicitacaoId: 'teste-st-excede',
      periodoInicio: '2026-08-01',
      periodoFim: '2026-08-31',
      context,
      input: {
        xmlFiles: [new File([SAMPLE_XML_ST_EXCEEDS], 'nota_st_excede.xml')],
        spedFile: null,
        entrySheet: null,
      },
    },
    templateBytes,
  );

  // Removido da planilha:
  assert.equal(result.notasProcessadas.length, 0);
  assert.equal(result.artifacts.length, 0);

  // Registrado em itens excluídos:
  assert.equal(result.itensExcluidos.length, 1);
  assert.equal(result.itensExcluidos[0].numero_nota, '50884');
  assert.match(result.itensExcluidos[0].motivo, /ICMS ST destacado na nota/);
});
