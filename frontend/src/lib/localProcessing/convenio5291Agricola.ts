/**
 * Convênio ICMS 52/91, Anexo II — catálogo consolidado aplicável à
 * antecipação parcial de entradas interestaduais para a Bahia.
 * Fonte: https://www.confaz.fazenda.gov.br/legislacao/convenios/1991/CV052_91
 * A descrição jurídica é indispensável; NCM isolado nunca concede o benefício.
 * Mudanças históricas anteriores a 2020 exigem conferência humana.
 */
import type { Convenio5291Config } from '../../types/perfil';
import type { ExtractedItem, ExtractedNote } from './domain';
import type { Convenio5291Decision } from '../../types/solicitacao';
import {
  convenioDecisionKey, fullIcmsCode, normalizeConvenioDescription,
  type Convenio5291Applied, type Convenio5291Classification,
} from './convenio5291.ts';

export const ANEXO_II_VALID_UNTIL = '2026-12-31';
export const ANEXO_II_SAFE_FROM = '2020-01-01';
type Entry = { item: string; description: string; ncms: string[]; validFrom?: string };
const item = (number: string, description: string, codes: string, validFrom?: string): Entry =>
  ({ item: number, description, ncms: codes.split(' '), validFrom });

/** Todas as entradas vigentes exibidas no Anexo II consolidado (redação de 2026). */
export const ANEXO_II_ITEMS: Entry[] = [
  item('1.1', 'Recipientes plásticos para transporte de leite até 300 litros', '39239000'),
  item('1.2', 'Recipientes de alumínio para transporte de leite até 300 litros', '76129090'),
  item('1.3', 'Recipientes de ferro ou aço para transporte de leite até 300 litros', '73101090 73102910 73102990'),
  item('1.4', 'Recipientes de latão para transporte de leite até 300 litros', '74199990'),
  item('2.1', 'Silos plásticos ou de lona plastificada, capacidade superior a 300 litros', '39173290 39251000', '2020-06-01'),
  item('2.2', 'Silos de ferro ou aço para grãos', '73090010'),
  item('2.3', 'Silos com ventiladores ou aquecedores incorporados', '84198999'),
  item('2.4', 'Silos metálicos com elevadores ou extratores incorporados', '84798940'),
  item('2.5', 'Silos pré-fabricados de madeira', '94060091'),
  item('2.6', 'Silos pré-fabricados de ferro ou aço', '94060092'),
  item('3', 'Troncos de contenção bovina', '44219000'),
  item('4.1', 'Comedouros para animais', '73269090'),
  item('4.2', 'Ninhos metálicos para aves', '73269090'),
  item('4.3', 'Esteiras especiais para pneus de tratores', '87087090'),
  item('5.1', 'Pás agrícolas', '82011000'),
  item('5.2', 'Forcados e forquilhas agrícolas', '82012000'),
  item('5.3', 'Enxadas, picaretas, sachos, ancinhos e semelhantes', '82013000'),
  item('5.4', 'Machados, podões e ferramentas com gume', '82014000'),
  item('5.5', 'Tesouras de podar de uma mão', '82015000'),
  item('5.6', 'Tesouras de podar de duas mãos', '82016000'),
  item('5.7', 'Outras ferramentas manuais de agricultura, horticultura e silvicultura', '82019000'),
  item('6', 'Cata-ventos para bombear água', '84128000'),
  item('7.1', 'Ventiladores para silos infláveis, sob condição de saída em conjunto', '84145990'),
  item('7.2', 'Compressores para silos infláveis, sob condição de saída em conjunto', '84148011'),
  item('7.3', 'Outros compressores para silos infláveis, sob condição de saída em conjunto', '84148019'),
  item('7.4', 'Coifas e exaustores para silos infláveis, sob condição de saída em conjunto', '84148090'),
  item('8', 'Secadores para produtos agrícolas', '84193100'),
  item('9', 'Balanças bovinas mecânicas ou eletrônicas', '84238200'),
  item('10.1', 'Pulverizadores manuais agrícolas para combate a pragas', '84244100'),
  item('10.2', 'Outros pulverizadores agrícolas para combate a pragas', '84244900'),
  item('10.3', 'Irrigadores e sistemas de aspersão para lavoura, inclusive seus elementos', '84248221'),
  item('10.4', 'Outros irrigadores e sistemas de irrigação, inclusive seus elementos', '84248229'),
  item('11.1', 'Máquinas apanhadoras e carregadoras de cana autopropulsadas', '84272090'),
  item('11.2', 'Carregadores acopláveis a trator agrícola', '84279000'),
  item('12', 'Plainas, valetadeiras e scrapers agrícolas nas condições da norma', '84306990'),
  item('13.1', 'Arados de disco', '84321000'),
  item('13.2', 'Enxadas rotativas', '84322900'),
  item('13.3', 'Semeadores-adubadores', '84323110 84323910'),
  item('13.4', 'Outros plantadores e transplantadores', '84323190'),
  item('13.5', 'Espalhadores de estrume e distribuidores de fertilizantes', '84324100 84324200'),
  item('13.6', 'Outras máquinas agrícolas para trabalho do solo', '84328000'),
  item('13.7', 'Partes de máquinas agrícolas de preparo do solo ou cultura', '84329000'),
  item('13.8', 'Grades de discos', '84322100'),
  item('14.1', 'Cortadores de grama motorizados com corte horizontal', '84331100'),
  item('14.2', 'Outros cortadores de grama', '84331900'),
  item('14.3', 'Ceifeiras e barras de corte com rotor de dedos e pente', '84332010'),
  item('14.4', 'Outras ceifeiras', '84332090'),
  item('14.5', 'Máquinas para colher ou dispor feno', '84333000'),
  item('14.6', 'Enfardadeiras de palha ou forragem', '84334000'),
  item('14.7', 'Ceifeiras-debulhadoras', '84335100'),
  item('14.8', 'Outras máquinas de debulha', '84335200'),
  item('14.9', 'Máquinas para colher raízes ou tubérculos', '84335300'),
  item('14.10', 'Colheitadeiras de algodão até dois sulcos e potência até 59,7 kW', '84335911'),
  item('14.11', 'Outras colheitadeiras de algodão', '84335919'),
  item('14.12', 'Outros aparelhos para colheita ou debulha', '84335990'),
  item('14.13', 'Selecionadores de frutas', '84336010'),
  item('14.14', 'Seleção de ovos com capacidade >= 36.000/h', '84336021'),
  item('14.15', 'Outras máquinas de seleção de ovos', '84336029'),
  item('14.16', 'Outras máquinas de seleção de produtos agrícolas', '84336090'),
  item('14.17', 'Partes de máquinas agrícolas de colheita e debulha', '84339090'),
  item('14.18', 'Derriçadores manuais de café', '84678900'),
  item('14.19', 'Roçadeiras e podadores com motor incorporado e potência >= 0,5 kW', '84678900 84672999', '2024-07-01'),
  item('15', 'Máquinas de ordenhar', '84341000'),
  item('16.1', 'Máquinas para preparar alimentos ou rações para animais', '84361000'),
  item('16.2', 'Chocadeiras e criadeiras', '84362100'),
  item('16.3', 'Outros aparelhos de avicultura', '84362900'),
  item('16.4', 'Outras máquinas para agricultura, horticultura ou silvicultura', '84368000'),
  item('16.5', 'Partes de máquinas de avicultura', '84369100'),
  item('16.6', 'Partes de máquinas para agricultura, horticultura ou silvicultura', '84369900'),
  item('17', 'Motosserras de corrente a combustão, potência >= 1,2 kW e registro IBAMA', '84678100', '2024-07-01'),
  item('18', 'Aparelhos de radionavegação para uso agrícola', '85269100'),
  item('19.1', 'Motocultores', '87011000'),
  item('19.2', 'Tratores agrícolas de rodas', '87019100 87019200 87019300 87019490 87019590'),
  item('20', 'Bombas não volumétricas nem centrífugas', '84138100'),
  item('21.1', 'Reboques autocarregáveis ou autodescarregáveis para uso agrícola', '87162000'),
  item('21.2', 'Veículos de tração animal', '87168000'),
  item('22.1', 'Aviões agrícolas a hélice até 2.000 kg, homologados', '88022010'),
  item('22.2', 'Aviões agrícolas a hélice até 15.000 kg, homologados', '88023010'),
  item('23.1', 'Hélices e rotores de aviões e suas partes', '88031000'),
  item('23.2', 'Trens de aterrissagem de aviões e suas partes', '88032000'),
  item('23.3', 'Outras partes de aviões', '88033000'),
  item('23.4', 'Outras partes da posição 88.02', '88039000'),
  item('24', 'Ovascan', '90278014'),
  item('25', 'Estufa agrícola pré-fabricada', '94060010'),
];

const INDEX = new Map<string, Entry[]>();
for (const entry of ANEXO_II_ITEMS) for (const ncm of entry.ncms) {
  INDEX.set(ncm, [...(INDEX.get(ncm) ?? []), entry]);
}
export const isAnexoIINcm = (ncm: string): boolean => INDEX.has(String(ncm).replace(/\D/g, ''));

// Match semântico determinístico; requisitos técnicos (potência, IBAMA, tipo de bomba,
// uso, capacidade e destinação) continuam exigindo revisão humana, mesmo com termo.
// Exclusões de descrição evidenciadas nos XMLs de entrada da COMAPEL.
 // Aplicadas por NCM, para evitar rejeitar outros itens jurídicos legítimos.
const mismatchesByNcm: Record<string, string[]> = {
  '39173290': ['TUBO PEBD', 'TUBO POLIETILENO', 'MANGUEIRA'],
  '39251000': ['CAIXA D AGUA', 'CAIXA DAGUA', 'RESERVATORIO DE AGUA'],
  '73269090': ['GRELHA', 'ABRACADEIRA', 'JUNTA DO CILINDRO', 'GARFO DE PINTURA', 'SUPORTE P ROLO'],
  '84672999': ['ESMERILHADEIRA', 'LIXADEIRA', 'FURADEIRA'],
};
const obviousMismatch = ['ESMERILHADEIRA', 'LIXADEIRA', 'FURADEIRA'];
const safeByItem: Record<string, string[]> = {
  // Ferramentas manuais genéricas (pás, enxadas e picaretas) podem servir à
  // construção civil. Não automatizar apenas por seu nome ou NCM.
  '8': ['SECADOR AGRICOLA'],
  '13.1': ['ARADO DE DISCO'],
  '13.2': ['ENXADA ROTATIVA'],
  '13.8': ['GRADE DE DISCO'],
  '15': ['ORDENHADEIRA', 'MAQUINA DE ORDENHAR'],
};
const matches = (text: string, terms: string[]) =>
  terms.some((term) => text.includes(normalizeConvenioDescription(term)));

export function classifyAnexoII(
  config: Convenio5291Config | undefined,
  note: ExtractedNote,
  product: ExtractedItem,
  destinationUF: string,
): Convenio5291Classification {
  const ncm = String(product.ncm ?? '').replace(/\D/g, '');
  const entryList = INDEX.get(ncm) ?? [];
  const cst20 = fullIcmsCode(product).endsWith('20');
  const reducaoDestacada = Number(product.pRedBC ?? 0) > 0;
  const operacaoQuatroPorCento = Math.abs(Number(product.aOri ?? 0) - 0.04) < 0.0005;
  const base = { ncm, cst20, reducaoDestacada, operacaoQuatroPorCento };
  const off = (motivo: string): Convenio5291Classification => ({
    ...base, status: 'fora_catalogo', motivo, sugestaoAplicar: false,
  });
  if (!config?.enabled || destinationUF.toUpperCase() !== 'BA')
    return off('Anexo II desativado neste perfil ou destinatário fora da Bahia.');
  if (!entryList.length) return off('NCM não consta do Anexo II consolidado.');
  const date = note.dataEmissao.slice(0, 10);
  const d = normalizeConvenioDescription(product.descricao);
  const legal = entryList.map((entry) => entry.item).join(', ');
  const description = entryList.map((entry) => entry.description).join('; ');
  const identify = { itemLegal: legal, descricaoLegal: description };
  if (date > ANEXO_II_VALID_UNTIL) return {
    ...base, ...identify, status: 'nao_aplicar',
    motivo: 'Convênio sem prorrogação conhecida após 31/12/2026; não aplicar sem atualização legal.', sugestaoAplicar: false,
  };
  const ajuste = (config.ajustes ?? []).find((rule) => {
    if (rule.ncm.replace(/\D/g, '') !== ncm) return false;
    if (rule.vigencia_inicio && date < rule.vigencia_inicio) return false;
    if (rule.vigencia_fim && date > rule.vigencia_fim) return false;
    const terms = rule.termos_descricao ?? [];
    return !terms.length || matches(d, terms);
  });
  if (ajuste?.acao === 'nao_aplicar') return {
    ...base, ...identify, status: 'nao_aplicar',
    motivo: ajuste.motivo || 'Exclusão deste produto pelo Perfil de Regras.',
    sugestaoAplicar: false, ajusteId: ajuste.id,
  };
  if (matches(d, obviousMismatch) || matches(d, mismatchesByNcm[ncm] ?? [])) return {
    ...base, ...identify, status: 'nao_aplicar',
    motivo: 'Descrição incompatível com a mercadoria específica prevista no item legal.',
    sugestaoAplicar: false,
  };
  // Nunca dispensar requisitos jurídicos pela opção "Automático" do administrador.
  const ageNeedsReview = date < ANEXO_II_SAFE_FROM
    || entryList.some((entry) => entry.validFrom && date < entry.validFrom);
  const technical = ['14.19', '17', '20', '10.3', '10.4', '2.1', '7.1', '7.2', '7.3', '7.4', '22.1', '22.2', '14.10'];
  const technicalNeedsReview = entryList.some((entry) => technical.includes(entry.item));
  const safe = entryList.length === 1 && !technicalNeedsReview
    && matches(d, safeByItem[entryList[0].item] ?? []);
  if (safe && !ageNeedsReview && !operacaoQuatroPorCento
      && ajuste?.acao !== 'revisar' && config.aplicar_automaticamente_seguros) {
    return {
      ...base, ...identify, status: 'automatico',
      motivo: 'NCM e descrição compatíveis com item legal sem exigências técnicas adicionais identificadas.',
      sugestaoAplicar: true,
    };
  }
  if (config.solicitar_confirmacao_duvidosos === false && ajuste?.acao !== 'revisar')
    return {
      ...base, ...identify, status: 'nao_aplicar',
      motivo: 'Enquadramento depende de conferência técnica e a revisão manual está desativada.',
      sugestaoAplicar: false,
    };
  return {
    ...base, ...identify, status: 'revisar',
    motivo: ageNeedsReview ? 'Vigência histórica ou alteração do item legal exige conferência.'
      : operacaoQuatroPorCento ? 'Origem a 4%: confirmar mercadoria e preservar alíquota destacada.'
      : technicalNeedsReview ? 'Confirmar as características técnicas/uso previstos no Anexo II, além do NCM.'
      : entryList.length > 1 ? 'Mais de um item legal compartilha este NCM; confirmar a descrição.'
      : 'NCM candidato ao Anexo II; confirmar a descrição e destinação efetiva.',
    sugestaoAplicar: false,
    ajusteId: ajuste?.id ?? null,
  };
}

export function resolveAnexoIIApplication(
  config: Convenio5291Config | undefined,
  note: ExtractedNote,
  product: ExtractedItem,
  destinationUF: string,
  decisions?: Record<string, Convenio5291Decision>,
): Convenio5291Applied {
  const classification = classifyAnexoII(config, note, product, destinationUF);
  const decisionKey = convenioDecisionKey(note, product);
  const applied = classification.status === 'automatico'
    || (classification.status === 'revisar' && decisions?.[decisionKey] === true);
  if (!applied) return { applied: false, classification, decisionKey };
  const four = classification.operacaoQuatroPorCento;
  const selectedOrigin = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'])
    .has(note.ufEmitente.toUpperCase());
  const aOri = four ? product.aOri : selectedOrigin ? 0.041 : 0.07;
  return {
    applied: true, classification, decisionKey, aOri, aDst: 0.056,
    baseSemIpi: Number(product.baseSemIpi ?? (product.vTotal - Number(product.vIpi ?? 0))),
    origemAliquota: four ? 'aliquota_4_preservada_xml'
      : selectedOrigin ? 'anexo_ii_carga_4_10' : 'anexo_ii_carga_7_00',
  };
}
