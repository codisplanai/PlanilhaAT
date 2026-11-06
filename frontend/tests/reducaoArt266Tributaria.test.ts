import assert from 'node:assert/strict';
import test from 'node:test';
import { installDomParserPolyfill } from './domPolyfill.ts';

installDomParserPolyfill();

import { processFiscalLocally } from '../src/lib/localProcessing/processor.ts';
import type { LocalProcessingContext } from '../src/types/localProcessing.ts';

const XML_ART266_II = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260814515925000180550010000509991030783820">
      <ide>
        <cUF>35</cUF>
        <nNF>50999</nNF>
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
          <vNF>2000.00</vNF>
          <vBC>2000.00</vBC>
          <vICMS>240.00</vICMS>
        </ICMSTot>
      </total>
      <det nItem="1">
        <prod>
          <cProd>1</cProd>
          <xProd>ARAME FARPADO GERDAU 500M</xProd>
          <NCM>73130000</NCM>
          <CEST>1005200</CEST>
          <CFOP>6403</CFOP>
          <vProd>1000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <vBC>1000.00</vBC>
              <pICMS>12.00</pICMS>
              <vICMS>120.00</vICMS>
            </ICMS00>
          </ICMS>
        </imposto>
      </det>
      <det nItem="2">
        <prod>
          <cProd>2</cProd>
          <xProd>PREGO DE COBRE ESPECIAL</xProd>
          <NCM>73170090</NCM>
          <CEST>1005700</CEST>
          <CFOP>6403</CFOP>
          <vProd>1000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <vBC>1000.00</vBC>
              <pICMS>12.00</pICMS>
              <vICMS>120.00</vICMS>
            </ICMS00>
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
      configuracoes_extras: {
        limitar_a_ori_reducoes: true,
      },
    },
    regras_aliquotas: [{ id: 1, perfil_regras_id: 1, uf: 'BA', ncm: null, aliquota: 0.205 } as never],
    regras_cfop: [
      { id: 1, perfil_regras_id: 1, cfop_sufixo: '403', destino: 'antecipacao_tributaria', reclassificar_para: null, motivo: null },
    ],
    regras_reducao: [
      {
        id: 10,
        perfil_regras_id: 1,
        ncm: '7313',
        termos_inclusao: [],
        termos_exclusao: [],
        aliquota: 0.41463,
        escopo: 'antecipacao_tributaria',
        descricao: "RICMS/BA Dec. 13.780/12, Art. 266, II, 'b' — Arame farpado",
        excecoes: [],
        criado_em: '2026-11-06T00:00:00Z',
        atualizado_em: '2026-11-06T00:00:00Z',
      },
      {
        id: 11,
        perfil_regras_id: 1,
        ncm: '7317',
        termos_inclusao: [],
        termos_exclusao: ['COBRE'],
        aliquota: 0.41463,
        escopo: 'antecipacao_tributaria',
        descricao: "RICMS/BA Dec. 13.780/12, Art. 266, II, 'f' — Tachas, pregos, grampos (exceto cobre)",
        excecoes: [],
        criado_em: '2026-11-06T00:00:00Z',
        atualizado_em: '2026-11-06T00:00:00Z',
      },
    ],
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
          },
          extra_options: {
            header_cell: 'A2',
            aliquota_format: 'percent_number',
          },
        },
      },
    ],
    mva_anexo: [
      {
        ncm: '7313',
        item: '8.52',
        cest: ['10.052.00'],
        mva_original: [{ caso: null, valor: 35 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 47.27, '7': 42.67, '12': 35 } }],
      },
      {
        ncm: '7317',
        item: '8.57',
        cest: ['10.057.00'],
        mva_original: [{ caso: null, valor: 35 }],
        mva_ajustada: [{ caso: null, aliquotas: { '4': 47.27, '7': 42.67, '12': 35 } }],
      },
    ],
  };
}

test('Antecipação Tributária: aplica redução de 41,463% (Art. 266, II), mantém A.DST 20,5%, A.ORI integral e desdobra item excluído por COBRE', async () => {
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
      solicitacaoId: 'teste-art266-ii',
      periodoInicio: '2026-08-01',
      periodoFim: '2026-08-31',
      context,
      input: {
        xmlFiles: [new File([XML_ART266_II], 'nota_art266.xml')],
        spedFile: null,
        entrySheet: null,
      },
    },
    templateBytes,
  );

  // Ambos os itens têm MVA 35%, mas o item 1 (7313) recebe redução 41,463% e o item 2 (7317 COBRE) não:
  assert.equal(result.notasProcessadas.length, 2);

  const comReducao = result.notasProcessadas.find((n) => (n.metadados_extras as Record<string, unknown>).reducao === '0.41463');
  const semReducao = result.notasProcessadas.find((n) => (n.metadados_extras as Record<string, unknown>).reducao == null);

  assert.ok(comReducao, 'Deve existir linha com redução de 0.41463');
  assert.ok(semReducao, 'Deve existir linha sem redução (prego de cobre)');

  // Na linha com redução: A.DST = 20,5%, A.ORI = 12% (sem trava de 10%)
  assert.equal(comReducao.a_dst_resolvida, 0.205);
  assert.equal(comReducao.a_ori, 0.12);
  // Base ST = 1000 * 1.35 * (1 - 0.41463) = 790.2495 -> Débito (20,5%) = 162.00
  assert.equal(comReducao.debito, 162.0);
  assert.equal(comReducao.credito, 120.0);
  assert.equal(comReducao.valor_devido, 42.0);

  // Na linha sem redução: Base ST = 1350 -> Débito (20,5%) = 276.75
  assert.equal(semReducao.a_dst_resolvida, 0.205);
  assert.equal(semReducao.a_ori, 0.12);
  assert.equal(semReducao.debito, 276.75);
  assert.equal(semReducao.credito, 120.0);
  assert.equal(semReducao.valor_devido, 156.75);

  // Verifica que o valor 41.463 foi gravado na célula I4 do Excel gerado
  const { readZip } = await import('../src/lib/localProcessing/zip.ts');
  const entries = await readZip(result.artifacts[0].bytes);
  const allSheetsXml = Array.from(entries.entries())
    .filter(([name]) => name.startsWith('xl/worksheets/sheet'))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join('\n');
  assert.match(allSheetsXml, /<c[^>]*r="I4"[^>]*><v>41\.463<\/v><\/c>/);
  assert.match(allSheetsXml, /<c[^>]*r="J4"[^>]*><v>20\.5<\/v><\/c>/);
});

test('Antecipação Tributária: nota 51719 (VERG CA50 16mm RT 12m 2t NV, NCM 72142000) casa com termo "vergalhão" e grava Redução na coluna I', async () => {
  const context = buildContext();
  context.regras_reducao.push({
    id: 12,
    perfil_regras_id: 1,
    ncm: '72142000',
    termos_inclusao: ['vergalhão'],
    termos_exclusao: [],
    aliquota: 0.41463,
    escopo: 'antecipacao_tributaria',
    descricao: 'Vergalhão CA50 — Art. 266, II',
    excecoes: [],
    criado_em: '2026-11-06T00:00:00Z',
    atualizado_em: '2026-11-06T00:00:00Z',
  });
  context.mva_anexo.push({
    ncm: '72142000',
    item: '8.43.1',
    cest: ['10.043.01'],
    mva_original: [{ caso: null, valor: 33.48 }],
    mva_ajustada: [{ caso: null, aliquotas: { '4': 58.18, '7': 53.24, '12': 45 } }],
  });

  const xml51719 = XML_ART266_II
    .replace('<nNF>50999</nNF>', '<nNF>51719</nNF>')
    .replace(/<det nItem="1">[\s\S]*<\/det>/, `<det nItem="1">
        <prod>
          <cProd>000000000110006876</cProd>
          <xProd>VERG CA50 16mm RT 12m 2t NV</xProd>
          <NCM>72142000</NCM>
          <CEST>1004301</CEST>
          <CFOP>6403</CFOP>
          <vProd>28425.10</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>5</orig>
              <CST>00</CST>
              <vBC>28425.10</vBC>
              <pICMS>12.00</pICMS>
              <vICMS>3411.01</vICMS>
            </ICMS00>
          </ICMS>
        </imposto>
      </det>`)
    .replace('<vNF>2000.00</vNF>', '<vNF>28425.10</vNF>')
    .replace('<vBC>2000.00</vBC>', '<vBC>28425.10</vBC>')
    .replace('<vICMS>240.00</vICMS>', '<vICMS>3411.01</vICMS>');

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
      solicitacaoId: 'teste-51719',
      periodoInicio: '2026-08-01',
      periodoFim: '2026-08-31',
      context,
      input: {
        xmlFiles: [new File([xml51719], 'nota_51719.xml')],
        spedFile: null,
        entrySheet: null,
      },
    },
    templateBytes,
  );

  assert.equal(result.notasProcessadas.length, 1);
  assert.equal((result.notasProcessadas[0].metadados_extras as Record<string, unknown>).reducao, '0.41463');

  const { readZip } = await import('../src/lib/localProcessing/zip.ts');
  const entries = await readZip(result.artifacts[0].bytes);
  const allSheetsXml = Array.from(entries.entries())
    .filter(([name]) => name.startsWith('xl/worksheets/sheet'))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join('\n');
  assert.match(allSheetsXml, /<c[^>]*r="I4"[^>]*><v>41\.463<\/v><\/c>/);
});
