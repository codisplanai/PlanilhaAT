import type { Convenio5291Config, Convenio5291Adjustment } from '../../types/perfil';
import type { ExtractedItem, ExtractedNote } from './domain';

export const CONVENIO_52_91_SOURCE_URL =
  'https://www.confaz.fazenda.gov.br/legislacao/convenios/1991/CV052_91';
export const CONVENIO_52_91_CATALOG_VERSION = 'CONFAZ vigente em 2026';
export const CONVENIO_52_91_SAFE_FROM = '2020-01-01';

export type Convenio5291Status = 'automatico' | 'revisar' | 'nao_aplicar' | 'fora_catalogo';

export interface Convenio5291Classification {
  status: Convenio5291Status;
  ncm: string;
  motivo: string;
  itemLegal?: string | null;
  descricaoLegal?: string | null;
  cst20: boolean;
  reducaoDestacada: boolean;
  operacaoQuatroPorCento: boolean;
  sugestaoAplicar: boolean;
  ajusteId?: string | null;
}

export interface Convenio5291Applied {
  applied: boolean;
  classification: Convenio5291Classification;
  decisionKey: string;
  aOri?: number;
  aDst?: number;
  baseSemIpi?: number;
  origemAliquota?: string;
}

// Relação corrente do Anexo I. Os códigos são normalizados sem pontuação.
// O catálogo jurídico permanece imutável no perfil; ajustes administrativos
// são aplicados em camada separada.
const EXACT_NCMS = new Set([
  '73071920','82073000','82071900',
  '84021100','84021200','84021900','84022000','84041010','84042000','84051000',
  '84061000','84068100','84068200','84101100','84101200','84101300','84109000','84128000',
  '84137010','84137080','84137090',
  '84148012','84148013','84148019','84148031','84148032','84148033','84148038','84148039',
  '84161000','84162010','84162090','84163000','84169000',
  '84171010','84171020','84171090','84172000','84178010','84178020','84178090',
  '84186910','84186999','84186920',
  '84193200','84193900','84194010','84194020','84194090','84195010','84195021','84195022','84195029','84195090',
  '84196000','84198110','84198190','84198911','84198919','84198920','84198930','84198940','84198999',
  '84201010','84201090','84209100',
  '84211110','84211190','84211290','84211910','84211990','84213990',
  '84222000','84223010','84223021','84223022','84223023','84223029','84224010','84224020','84224030','84224090',
  '84232000','84233011','84233019','84233090','84238110','84238190','84238200','84238900',
  '84242000','84243010','84243020','84243030','84243090','84248990',
  '84251100','84251910','84251990','84253110','84253190','84253910','84253990',
  '84261100','84262000','84263000','84269900','84279000',
  '84281000','84282010','84282090','84283100','84283200','84283300','84283910','84283920','84283930','84283990',
  '84342010','84342090','84351000',
  '84371000','84378010','84378090',
  '84381000','84382011','84382019','84382090','84383000','84384000','84385000','84386000','84388020','84388090',
  '84391010','84391020','84391030','84391090','84392000','84393010','84393020','84393030','84393090',
  '84401011','84401019','84401020','84401090',
  '84411010','84411090','84412000','84413010','84413090','84414000','84418000',
  '84423010','84423020',
  '84431110','84431190','84431200','84431310','84431321','84431329','84431390','84431400','84431500','84431600',
  '84431710','84431790','84431990','84439191','84439192','84439199','84433910',
  '84440010','84440020','84440090',
  '84451110','84451120','84451190','84451200','84451300','84451910','84451921','84451922','84451923','84451924',
  '84451925','84451926','84451927','84451929','84452000','84453010','84453090','84454011','84454012','84454018',
  '84454019','84454021','84454029','84454031','84454039','84454040','84454090','84459010','84459020','84459030',
  '84459040','84459090',
  '84461010','84461090','84462100','84462900','84463010','84463020','84463030','84463040','84463090',
  '84471100','84471200','84472021','84472029','84472030','84479010','84479020','84479090',
  '84481110','84481120','84481190','84481900',
  '84490010','84490020','84490080',
  '84502010','84502090',
  '84511000','84512910','84512990','84513010','84513091','84513099','84514010','84514021','84514029','84514090',
  '84515010','84515020','84515090','84518000',
  '84522110','84522120','84522190','84522910','84522921','84522922','84522923','84522929','84522924','84522925',
  '84531010','84531090','84532000','84538000',
  '84541000','84542010','84542090','84543010','84543020','84543090','84549010','84549090',
  '84551000','84552110','84552190','84552210','84552290','84553010','84553020','84553090','84559000',
  '84563011','84563019','84563090',
  '84571000','84572010','84572090','84573010','84573090',
  '84581110','84581191','84581199','84581910','84581990','84589100','84589900',
  '84591000','84592110','84592191','84592199','84592900','84593100','84593900','84594000','84595100','84595900',
  '84596100','84596900','84597000',
  '84601100','84601900','84602100','84602900','84603100','84603900','84604011','84604019','84604091','84604099',
  '84609011','84609012','84609019','84609090',
  '84612010','84612090','84613010','84613090','84614010','84614091','84614099','84615010','84615020','84615090',
  '84619010','84619090',
  '84621011','84621019','84621090','84622100','84622900','84623100','84623910','84623990','84624100','84624900',
  '84629111','84629191','84629119','84629199','84629910','84629920','84629990',
  '84631010','84631090','84632010','84632091','84632099','84633000','84639010','84639090',
  '84641000','84642010','84642021','84642029','84642090','84649011','84649019','84649090',
  '84651000','84659110','84659120','84659190','84659211','84659219','84659290','84659310','84659390','84659400',
  '84659511','84659512','84659591','84659592','84659600','84659900',
  '84662010','84663000','84669100','84669200','84669319','84669320','84669330','84669340','84669350','84669360',
  '84669410','84669420','84669430','84669490',
  '84671110','84671190','84671900','84678100','84678900',
  '84681000','84682000','84688010','84688090',
  '84741000','84742010','84742090','84743100','84743200','84743900','84748010','84748090',
  '84751000','84752100','84752910','84752990',
  '84771011','84771019','84771021','84771029','84771091','84771099','84772010','84772090','84773010','84773090',
  '84774010','84774090','84775100','84775911','84775919','84775990','84778010','84778090',
  '84781090',
  '84792000','84793000','84794000','84798110','84798190','84798922','84798999',
  '84801000','84803000','84804100','84804910','84804990','84805000','84806000','84807100','84807900',
  '84818093','84818095','84818097','84818099',
  '84834010','84834090',
  '85044010','85044090',
  '85141010','85142011','85142020','85143011','85143021','85143090','85149000',
  '85152100','85153110','85153190','85153900','85158010','85158090',
  '85433000','86071919','90241090','85437099',
]);

// Subposição de seis dígitos expressamente usada no item 56.5.
const PREFIX_NCMS = ['846729'];

// Correlações NCM 2022 observadas nos documentos reais. Como cada código novo
// pode agregar mais de um subtipo antigo, entram sempre como revisão.
const CORRELATED_2022_NCMS = new Set(['85141900', '85143900']);

const AUTO_RULES: Array<{
  ncm: string;
  itemLegal: string;
  descricaoLegal: string;
  termos: string[];
}> = [
  { ncm: '84172000', itemLegal: '13.4', descricaoLegal: 'Fornos de padaria, pastelaria ou indústria de bolachas e biscoitos', termos: ['FORNO'] },
  { ncm: '84186999', itemLegal: '14.2', descricaoLegal: 'Máquinas de fabricar gelo e instalações frigoríficas industriais especificadas', termos: ['MAQUINA DE GELO'] },
  { ncm: '84198190', itemLegal: '15.13', descricaoLegal: 'Aparelhos para preparação de bebidas quentes ou cozimento/aquecimento de alimentos', termos: ['FRITADEIRA', 'FRITADOR', 'FOGAO', 'SANDUICHEIRA', 'BUFFET TERM', 'FORNO INDL', 'CH BIF'] },
  { ncm: '84198920', itemLegal: '15.16', descricaoLegal: 'Estufas', termos: ['ESTUFA'] },
  { ncm: '84198999', itemLegal: '15.19', descricaoLegal: 'Outros aparelhos para tratamento por mudança de temperatura', termos: ['MESA TERMICA'] },
  { ncm: '84224090', itemLegal: '18.10', descricaoLegal: 'Outras máquinas e aparelhos para empacotar ou embalar mercadorias', termos: ['SELADORA', 'EMBALA'] },
  { ncm: '84238200', itemLegal: '19.8', descricaoLegal: 'Balanças de capacidade superior a 30 kg e não superior a 5.000 kg', termos: ['BALANCA', '31KG', '32KG', '50KG', '300KG'] },
  { ncm: '84381000', itemLegal: '28.1', descricaoLegal: 'Máquinas e aparelhos para indústrias de panificação, pastelaria, bolachas/biscoitos e massas', termos: ['AMASSADEIRA', 'BATEDEIRA', 'CILINDRO SOVADOR', 'MODELADORA DE PAO', 'FATIADEIRA PAO'] },
];

const NON_MATCH_RULES: Array<{ ncm: string; termos: string[]; motivo: string }> = [
  { ncm: '84198190', termos: ['BUFFET FRIO'], motivo: 'A descrição indica equipamento frio; o item 15.13 exige preparação, cozimento ou aquecimento.' },
  { ncm: '84381000', termos: ['ASSAD 58X70', 'ESTEIRA 50GR', 'MESA 1 50X0 70'], motivo: 'A descrição identifica utensílio/estrutura, e não a máquina de panificação prevista no item 28.1.' },
  { ncm: '84388090', termos: ['EXTRATOR DE SUCOS', 'SUCO'], motivo: 'O item 28.9 é restrito à preparação de peixes, moluscos e crustáceos.' },
];

export function normalizeConvenioDescription(value?: string | null): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function includesAny(description: string, terms: string[]): boolean {
  return terms.some((term) => description.includes(normalizeConvenioDescription(term)));
}

function activeAdjustment(
  adjustment: Convenio5291Adjustment,
  ncm: string,
  description: string,
  emissionDate: string,
): boolean {
  if (String(adjustment.ncm || '').replace(/\D/g, '') !== ncm) return false;
  if (adjustment.vigencia_inicio && emissionDate < adjustment.vigencia_inicio) return false;
  if (adjustment.vigencia_fim && emissionDate > adjustment.vigencia_fim) return false;
  const terms = adjustment.termos_descricao ?? [];
  return terms.length === 0 || includesAny(description, terms);
}

export function isConvenio5291CatalogNcm(ncmRaw: string): boolean {
  const ncm = String(ncmRaw ?? '').replace(/\D/g, '');
  return EXACT_NCMS.has(ncm)
    || PREFIX_NCMS.some((prefix) => ncm.startsWith(prefix))
    || CORRELATED_2022_NCMS.has(ncm);
}

export function fullIcmsCode(item: ExtractedItem): string {
  const origem = String(item.origemMercadoria ?? '').replace(/\D/g, '');
  const tributacao = String(item.cstIcms ?? '').replace(/\D/g, '');
  return `${origem}${tributacao}`;
}

export function convenioDecisionKey(note: ExtractedNote, item: ExtractedItem): string {
  const identity = note.chaveAcesso || `${note.cnpjEmitente}|${note.serie}|${note.numeroNota}`;
  return `${identity}|${item.itemNumero}`;
}

export function classifyConvenio5291(
  config: Convenio5291Config | undefined,
  note: ExtractedNote,
  item: ExtractedItem,
  ufDestino: string,
): Convenio5291Classification {
  const ncm = String(item.ncm ?? '').replace(/\D/g, '');
  const description = normalizeConvenioDescription(item.descricao);
  const cst = fullIcmsCode(item);
  const cst20 = cst.endsWith('20');
  const reducaoDestacada = Number(item.pRedBC ?? 0) > 0;
  const operacaoQuatroPorCento = Math.abs(Number(item.aOri ?? 0) - 0.04) < 0.0005;
  const evidence = config?.considerar_cst20_como_indicio === false
    ? false
    : (cst20 || reducaoDestacada);
  const base = { ncm, cst20, reducaoDestacada, operacaoQuatroPorCento };

  if (!config?.enabled || ufDestino.toUpperCase() !== 'BA') {
    return { ...base, status: 'fora_catalogo', motivo: 'Regra do Convênio 52/91 não está ativa para este perfil/destino.', sugestaoAplicar: false };
  }

  const emissionDate = note.dataEmissao.slice(0, 10);
  const adjustment = (config.ajustes ?? []).find((entry) =>
    activeAdjustment(entry, ncm, description, emissionDate),
  );
  if (adjustment) {
    if (adjustment.acao === 'nao_aplicar') {
      return { ...base, status: 'nao_aplicar', motivo: adjustment.motivo || 'Ajuste do perfil determinou não aplicar o Convênio.', sugestaoAplicar: false, ajusteId: adjustment.id };
    }
    if (adjustment.acao === 'revisar') {
      return { ...base, status: 'revisar', motivo: adjustment.motivo || 'Ajuste do perfil exige revisão manual.', sugestaoAplicar: evidence, ajusteId: adjustment.id };
    }
    return {
      ...base,
      status: 'automatico',
      motivo: adjustment.motivo || 'Ajuste do perfil autorizou aplicação automática.',
      sugestaoAplicar: true,
      ajusteId: adjustment.id,
    };
  }

  if (!isConvenio5291CatalogNcm(ncm)) {
    return { ...base, status: 'fora_catalogo', motivo: 'NCM não relacionado no catálogo corrente do Anexo I.', sugestaoAplicar: false };
  }

  if (emissionDate < CONVENIO_52_91_SAFE_FROM) {
    return {
      ...base,
      status: 'revisar',
      motivo: 'Documento anterior à janela do catálogo consolidado adotada pelo sistema; a vigência histórica deve ser confirmada.',
      sugestaoAplicar: evidence,
    };
  }

  const nonMatch = NON_MATCH_RULES.find((rule) => rule.ncm === ncm && includesAny(description, rule.termos));
  if (nonMatch) {
    return { ...base, status: 'nao_aplicar', motivo: nonMatch.motivo, sugestaoAplicar: false };
  }

  const auto = AUTO_RULES.find((rule) => rule.ncm === ncm && includesAny(description, rule.termos));
  if (auto) {
    if (operacaoQuatroPorCento) {
      return {
        ...base,
        status: 'revisar',
        motivo: 'Produto compatível com o Anexo I, porém a NF-e usa alíquota interestadual de 4%; exige confirmação do usuário.',
        itemLegal: auto.itemLegal,
        descricaoLegal: auto.descricaoLegal,
        sugestaoAplicar: false,
      };
    }
    if (config.aplicar_automaticamente_seguros === false) {
      return {
        ...base,
        status: 'revisar',
        motivo: 'Produto compatível com o Anexo I, mas o perfil exige confirmação manual.',
        itemLegal: auto.itemLegal,
        descricaoLegal: auto.descricaoLegal,
        sugestaoAplicar: true,
      };
    }
    return {
      ...base,
      status: 'automatico',
      motivo: 'NCM e descrição compatíveis com o item legal do Anexo I.',
      itemLegal: auto.itemLegal,
      descricaoLegal: auto.descricaoLegal,
      sugestaoAplicar: true,
    };
  }

  if (config.solicitar_confirmacao_duvidosos === false) {
    return { ...base, status: 'nao_aplicar', motivo: 'NCM consta no Anexo I, mas não há regra descritiva segura e o perfil não permite revisão manual.', sugestaoAplicar: false };
  }

  return {
    ...base,
    status: 'revisar',
    motivo: CORRELATED_2022_NCMS.has(ncm)
      ? 'NCM 2022 correlacionada a mais de um subtipo histórico do Anexo I; é necessário confirmar o produto.'
      : 'NCM consta no Anexo I, mas a descrição disponível não é suficiente para aplicação automática.',
    sugestaoAplicar: evidence,
  };
}

export function convenioAliquotaOrigem(ufOrigem: string, aliquotaXml: number): { aliquota: number; origem: string } {
  // No caso de 4%, a decisão manual confirma o benefício, mas a origem destacada
  // na NF-e é preservada: nunca transformamos 4% em 5,14% sem base legal específica.
  if (Math.abs(aliquotaXml - 0.04) < 0.0005) {
    return { aliquota: aliquotaXml, origem: 'aliquota_4_preservada_xml' };
  }
  const sulSudesteExcetoEs = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
  if (sulSudesteExcetoEs.has(ufOrigem.toUpperCase())) {
    return { aliquota: 0.0514, origem: 'carga_efetiva_5_14' };
  }
  return { aliquota: 0.088, origem: 'carga_efetiva_8_80' };
}

export function resolveConvenio5291Application(
  config: Convenio5291Config | undefined,
  note: ExtractedNote,
  item: ExtractedItem,
  ufDestino: string,
  decisions?: Record<string, boolean>,
): Convenio5291Applied {
  const classification = classifyConvenio5291(config, note, item, ufDestino);
  const decisionKey = convenioDecisionKey(note, item);
  const shouldApply = classification.status === 'automatico'
    || (classification.status === 'revisar' && decisions?.[decisionKey] === true);
  if (!shouldApply) return { applied: false, classification, decisionKey };

  const origin = convenioAliquotaOrigem(note.ufEmitente, item.aOri);
  return {
    applied: true,
    classification,
    decisionKey,
    aOri: origin.aliquota,
    aDst: 0.088,
    baseSemIpi: Number(item.baseSemIpi ?? (item.vTotal - Number(item.vIpi ?? 0))),
    origemAliquota: origin.origem,
  };
}
