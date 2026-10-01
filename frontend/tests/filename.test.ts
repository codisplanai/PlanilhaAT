import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSpreadsheetFilename,
  buildZipFilenameFromArtifacts,
  formatCompetenciaNome,
  resolveModeloPlanilha,
  resolveTipoCurto,
  sanitizeCompanyName,
} from '../src/lib/localProcessing/filename.ts';

test('sanitizeCompanyName: formata nome em PascalCase e remove LTDA', () => {
  assert.equal(sanitizeCompanyName('PASSO A PASSO CALCADOS LTDA'), 'PassoAPasso');
});

test('sanitizeCompanyName: remove acentuação e pontuações', () => {
  assert.equal(sanitizeCompanyName('SUPERMERCADO SÃO JOÃO & CIA LTDA'), 'SupermercadoSao');
});

test('sanitizeCompanyName: remove S/A e S.A.', () => {
  assert.equal(sanitizeCompanyName('AUTO PECAS BRASIL S/A'), 'AutoPecasBrasil');
  assert.equal(sanitizeCompanyName('BANCO DO NORDESTE S.A.'), 'BancoNordeste');
});

test('sanitizeCompanyName: respeita limite de tamanho sem cortar no meio da primeira palavra se couber', () => {
  const result = sanitizeCompanyName('EMPRESA COM NOME GIGANTESCO EXTRAORDINARIO');
  assert.ok(result.length <= 18);
  assert.equal(result, 'EmpresaNome');
});

test('sanitizeCompanyName: retorna Empresa se string for vazia ou apenas caracteres especiais', () => {
  assert.equal(sanitizeCompanyName(''), 'Empresa');
  assert.equal(sanitizeCompanyName('   '), 'Empresa');
  assert.equal(sanitizeCompanyName('---***---'), 'Empresa');
});

test('resolveModeloPlanilha: extrai RP das observações quando disponível', () => {
  assert.equal(
    resolveModeloPlanilha(
      'antecipacao_parcial',
      'Modelo oficial pré-definido de Antecipação Parcial (RP-153)',
    ),
    'RP-153',
  );
  assert.equal(
    resolveModeloPlanilha('difal', 'Modelo oficial pré-definido de DIFAL (RP-158)'),
    'RP-158',
  );
});

test('resolveModeloPlanilha: faz fallback para o mapeamento oficial quando observações forem nulas', () => {
  assert.equal(resolveModeloPlanilha('antecipacao_parcial', null), 'RP-153');
  assert.equal(resolveModeloPlanilha('antecipacao_parcial_antecipado', null), 'RP-155');
  assert.equal(resolveModeloPlanilha('antecipacao_parcial_simples', null), 'RP-154');
  assert.equal(resolveModeloPlanilha('antecipacao_parcial_antecipado_simples', null), 'RP-156');
  assert.equal(resolveModeloPlanilha('antecipacao_tributaria', null), 'RP-151');
  assert.equal(resolveModeloPlanilha('antecipacao_tributaria_antecipado', null), 'RP-151');
  assert.equal(resolveModeloPlanilha('difal', null), 'RP-158');
});

test('resolveTipoCurto: mapeia os tipos para siglas curtas', () => {
  assert.equal(resolveTipoCurto('antecipacao_parcial'), 'Parcial');
  assert.equal(resolveTipoCurto('antecipacao_parcial_antecipado'), 'Parcial-Antecipado');
  assert.equal(resolveTipoCurto('antecipacao_parcial_simples'), 'Parcial-Simples');
  assert.equal(resolveTipoCurto('antecipacao_parcial_antecipado_simples'), 'Parcial-Ant-Simples');
  assert.equal(resolveTipoCurto('antecipacao_tributaria'), 'AT');
  assert.equal(resolveTipoCurto('antecipacao_tributaria_antecipado'), 'AT-Antecipado');
  assert.equal(resolveTipoCurto('difal'), 'DIFAL');
});

test('formatCompetenciaNome: formata mês com dois dígitos e ano com 4', () => {
  assert.equal(formatCompetenciaNome(9, 2026), '09-2026');
  assert.equal(formatCompetenciaNome('08', '2026'), '08-2026');
  assert.equal(formatCompetenciaNome(12, 2025), '12-2025');
});

test('buildSpreadsheetFilename: gera o nome completo no padrão [Empresa]_[Modelo]_[Tipo]_[MM-AAAA].xlsx', () => {
  const filename = buildSpreadsheetFilename({
    razaoSocial: 'PASSO A PASSO CALCADOS LTDA',
    tipo: 'antecipacao_parcial',
    month: 9,
    year: 2026,
    observacoes: 'Modelo oficial pré-definido de Antecipação Parcial (RP-153)',
  });
  assert.equal(filename, 'PassoAPasso_RP-153_Parcial_09-2026.xlsx');
});

test('buildSpreadsheetFilename: gera nome curto e correto para DIFAL', () => {
  const filename = buildSpreadsheetFilename({
    razaoSocial: 'AUTO PECAS BRASIL S/A',
    tipo: 'difal',
    month: 8,
    year: 2026,
  });
  assert.equal(filename, 'AutoPecasBrasil_RP-158_DIFAL_08-2026.xlsx');
});

test('buildSpreadsheetFilename: gera nome curto e correto para AT Antecipado', () => {
  const filename = buildSpreadsheetFilename({
    razaoSocial: 'COMERCIAL SILVA ME',
    tipo: 'antecipacao_tributaria_antecipado',
    month: 10,
    year: 2026,
  });
  assert.equal(filename, 'ComercialSilva_RP-151_AT-Antecipado_10-2026.xlsx');
});

test('buildZipFilenameFromArtifacts: gera nome amigável para o arquivo zip quando houver artefatos', () => {
  const artifacts = [
    { filename: 'PassoAPasso_RP-153_Parcial_09-2026.xlsx' },
    { filename: 'PassoAPasso_RP-158_DIFAL_09-2026.xlsx' },
  ];
  assert.equal(
    buildZipFilenameFromArtifacts(artifacts, '123456789'),
    'PassoAPasso_Planilhas_09-2026.zip',
  );
});

test('buildZipFilenameFromArtifacts: usa fallback se não houver artefatos', () => {
  assert.equal(buildZipFilenameFromArtifacts([], 'abcdef123456'), 'planilhas_abcdef12.zip');
});
