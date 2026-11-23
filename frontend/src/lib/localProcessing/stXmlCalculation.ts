import type { ExtractedItem, ExtractedNote } from './domain';
import { roundCurrency } from './calculations.ts';

export function totalSemStXml(note: ExtractedNote): number {
  // vNF inclui o próprio ICMS-ST. Não reaplicar MVA sobre esse imposto.
  if (!Object.prototype.hasOwnProperty.call(note.rawMetadata,'icms_st_xml') || !(Number(note.vStNota)>0)
      || !note.itens?.length || note.itens.some(item=>item.baseSemIpi==null || item.vIpi==null)) return note.vTotalNota;
  // Confirmar pela soma econômica dos itens; algumas fontes legadas já
  // representam um total líquido de ST. Não descontar duas vezes.
  const economic=roundCurrency(note.itens.reduce((sum,item)=>sum+item.baseSemIpi!+item.vIpi!,0));
  const net=roundCurrency(note.vTotalNota-Number(note.vStNota));
  return Math.abs(net-economic)<0.000001 ? net : note.vTotalNota;
}

const close=(a:number,b:number)=>Math.abs(a-b)<0.000001;

/**
 * A NF-e calcula ICMS/ST por item e arredonda a BC-ST antes do débito.
 * Reconhecer quitação integral apenas quando TODOS os itens têm evidência
 * consistente com o cálculo independente. Não usar tolerância monetária
 * para ignorar diferenças reais, não assumir recolhimento pelo cabeçalho.
 * Não altera os casos com IPI, redução, FCP ou diferença de alíquotas.
 */
export function stIntegralmenteCobertoPorItem(items: ExtractedItem[], mva:number, aOri:number, aDst:number,
  reducao:number|null, fcp:number|null, vTotal:number, base:number, valorPago:number):
  {debito:number;credito:number}|null {
  if (!items.length || reducao || fcp || !(valorPago>0)) return null;
  const fraction = mva>1 ? mva/100 : mva;
  let debito=0,credito=0,pago=0,total=0,bases=0;
  for(const item of items){
    const e=item.stXml, economic=item.baseSemIpi, bc=item.baseCalculoXml;
    if(!e || economic==null || bc==null || economic<=0 || bc<=0
      || e.modalidade!=='4' || e.valor<=0 || Number(item.vIpi??0)!==0 || item.ipiDespesas!==0
      || Number(item.vDesc??0)!==0 || Number(item.pRedBC??0)!==0 || !close(item.aOri,aOri)
      || !close(e.mva,fraction*100) || !close(e.aliquota,aDst*100)
      || !close(economic,bc) || !close(item.vIcmsSt??0,e.valor)) return null;
    const baseSt=roundCurrency(economic*(1+fraction));
    const d=roundCurrency(baseSt*aDst), cr=roundCurrency(bc*aOri);
    if(!close(baseSt,e.base)||!close(cr,item.vIcms)||!close(roundCurrency(d-cr),e.valor)) return null;
    debito+=d;credito+=cr;pago+=e.valor;total+=economic;bases+=bc;
  }
  if(!close(roundCurrency(pago),valorPago)||!close(roundCurrency(total),roundCurrency(vTotal))
     ||!close(roundCurrency(bases),roundCurrency(base))) return null;
  return {debito:roundCurrency(debito),credito:roundCurrency(credito)};
}
