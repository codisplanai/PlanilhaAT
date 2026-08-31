import os
import re
from collections import defaultdict
from decimal import Decimal
from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session

from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.models.solicitacao_saida import SolicitacaoSaida
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.template_xlsx import TemplateXlsx
from app.core.config import settings
from app.core.exceptions import ValidationException, NotFoundException
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
from app.services.extraction.data_entrada_matcher import (
    DataEntradaMatcher,
    PlanilhaEntradaParser,
    PlanilhaEntradaRecord,
)
from app.services.rules_engine.aliquota_resolver import AliquotaResolver
from app.services.rules_engine.cfop_resolver import CfopResolver
from app.services.rules_engine.mva_resolver import MvaResolver
from app.services.calculation.factory import CalculatorFactory
from app.services.validation.sanity_checker import SanityChecker
from app.services.excel.template_filler import TemplateFiller
from app.services.templates_admin.template_manager import TemplateManager
from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_TRIBUTARIA,
    DIFAL,
    STATUS_CONCLUIDO,
    STATUS_ERRO,
    STATUS_PROCESSANDO,
    TIPOS_PLANILHA_LEGADO,
)
from app.services.pipeline_helpers import (
    build_header_info,
    crossing_keys,
    enrich_sped_with_xml,
    nfe_sort_key,
)


class ProcessingPipelineService:
    """
    Orquestrador completo de processamento:
    Executa a extração determinística (via XMLs ou SPED Fiscal EFD),
    correspondência opcional de Data de Entrada contábil,
    roteamento de cada item por CFOP para a planilha correta (Antecipação Parcial,
    Antecipação Tributária ou DIFAL), regras de alíquota, motor de cálculo,
    consolidação por NF-e (com desdobramento por destino e por alíquotas),
    validações de sanidade e preenchimento dos templates Excel sem sobrescrever fórmulas.

    Uma mesma NF-e pode conter itens de mais de uma natureza (ex: parte para revenda
    tributada, parte antecipada/ST, parte para uso/consumo) — nesse caso ela aparece
    em cada uma das planilhas geradas, apenas com os valores dos itens correspondentes.
    """

    def __init__(self, db: Session):
        self.db = db
        self.extractor = NFeXMLExtractor()
        self.sped_extractor = SpedFiscalExtractor()
        self.resolver = AliquotaResolver(db)
        self.cfop_resolver = CfopResolver(db)

    @staticmethod
    def _chaves_cruzamento(nf: Any) -> List[str]:
        return crossing_keys(nf)

    @staticmethod
    def _enrich_sped_with_xml(nf_sped: Any, nf_xml: Any) -> None:
        enrich_sped_with_xml(nf_sped, nf_xml)

    def process_solicitacao(
        self,
        solicitacao_id: str,
        xml_files_bytes: Optional[List[Tuple[str, bytes]]] = None, # [(filename, bytes), ...]
        sped_file_bytes: Optional[bytes] = None,
        sped_filename: Optional[str] = "sped_fiscal.txt",
        planilha_entradas_bytes: Optional[bytes] = None,
        planilha_entradas_filename: Optional[str] = "planilha_entradas.xlsx"
    ) -> Solicitacao:
        solicitacao = self.db.query(Solicitacao).filter(Solicitacao.id == solicitacao_id).first()
        if not solicitacao:
            raise NotFoundException(f"Solicitação ID '{solicitacao_id}' não encontrada.")

        empresa = self.db.query(Empresa).filter(Empresa.id == solicitacao.empresa_id).first()
        if not empresa:
            raise NotFoundException(f"Empresa ID '{solicitacao.empresa_id}' não encontrada.")

        # Validação de sanidade do CNPJ da Empresa
        SanityChecker.validate_cnpj(empresa.cnpj, "CNPJ da Empresa Solicitante")

        # Modo legado: solicitação criada explicitamente com um tipo único de planilha.
        # Modo padrão (novo): tipo_planilha omitido/"multi" -> roteamento automático por CFOP,
        # gerando todas as planilhas (Parcial, Tributária, DIFAL) que tiverem itens aplicáveis.
        modo_legado = bool(
            solicitacao.tipo_planilha
            and solicitacao.tipo_planilha in TIPOS_PLANILHA_LEGADO
        )
        template_legado = None
        if modo_legado:
            template_legado = self.db.query(TemplateXlsx).filter(TemplateXlsx.id == solicitacao.template_id).first()
            if not template_legado:
                template_legado = TemplateManager.get_active_template(self.db, solicitacao.tipo_planilha)
                solicitacao.template_id = template_legado.id

        if not xml_files_bytes and not sped_file_bytes:
            raise ValidationException("Nenhum arquivo XML de NF-e ou SPED Fiscal foi enviado para processamento.")

        # Guarda de competência: a partir do momento em que a ausência de uma nota no SPED
        # passa a significar "mercadoria ainda não entrou", subir o arquivo do mês errado
        # deixaria de ser inofensivo e passaria a jogar a apuração inteira na planilha
        # errada, sem sintoma visível. Por isso o período declarado no registro 0000
        # precisa ter interseção com o período da solicitação.
        sped_empresa_info: Dict[str, str] = {}
        if sped_file_bytes:
            sped_empresa_info = SpedFiscalExtractor.extract_empresa_info(sped_file_bytes)
            if not empresa.inscricao_estadual and sped_empresa_info.get("ie"):
                empresa.inscricao_estadual = sped_empresa_info["ie"]

            sped_ini, sped_fim = SpedFiscalExtractor.extract_periodo(sped_file_bytes)
            if sped_ini and sped_fim:
                sem_intersecao = sped_fim < solicitacao.periodo_inicio or sped_ini > solicitacao.periodo_fim
                if sem_intersecao:
                    raise ValidationException(
                        f"O arquivo SPED enviado refere-se ao período de "
                        f"{sped_ini.strftime('%d/%m/%Y')} a {sped_fim.strftime('%d/%m/%Y')}, "
                        f"que não coincide com o período da solicitação "
                        f"({solicitacao.periodo_inicio.strftime('%d/%m/%Y')} a "
                        f"{solicitacao.periodo_fim.strftime('%d/%m/%Y')}). "
                        f"Envie o SPED Fiscal da mesma competência que está sendo apurada."
                    )

        # Parse opcional da planilha de datas de entrada do sistema contábil
        planilha_records: List[PlanilhaEntradaRecord] = []
        if planilha_entradas_bytes:
            planilha_records = PlanilhaEntradaParser.parse(
                file_bytes=planilha_entradas_bytes,
                filename=planilha_entradas_filename or "planilha_entradas.xlsx"
            )

        # Extração das notas. As duas fontes são complementares e podem vir juntas:
        # os XMLs trazem o universo de notas EMITIDAS na competência; o SPED traz as que
        # efetivamente ENTRARAM no estabelecimento no mesmo período. Na interseção, a
        # escrituração do cliente (SPED) prevalece — é ela que reflete como a nota foi
        # de fato lançada, inclusive eventual reclassificação de CFOP.
        raw_nfs: List[Tuple[str, Any]] = []
        notas_sped: List[Any] = []

        if sped_file_bytes:
            notas_sped = self.sped_extractor.extract_from_sped(sped_file_bytes)
            for nf_item in notas_sped:
                raw_nfs.append((sped_filename or "sped_fiscal.txt", nf_item))

        if xml_files_bytes:
            # Mapa das notas do SPED por suas chaves de cruzamento para permitir enriquecimento
            sped_by_chave: Dict[str, Any] = {}
            for nf_item in notas_sped:
                for k in self._chaves_cruzamento(nf_item):
                    sped_by_chave[k] = nf_item

            for filename, xml_bytes in xml_files_bytes:
                try:
                    nf_item = self.extractor.extract_from_xml(xml_bytes)
                except ValidationException:
                    # Ignora arquivos auxiliares da SEFAZ (ex: eventos de cancelamento, CC-e, resumo)
                    # presentes no lote/ZIP para não inviabilizar o processamento das NF-e válidas.
                    continue

                chaves_xml = self._chaves_cruzamento(nf_item)

                sped_match = None
                for k in chaves_xml:
                    if k in sped_by_chave:
                        sped_match = sped_by_chave[k]
                        break

                if sped_match is not None:
                    # Já entrou pela via do SPED; enriquecemos os dados do SPED com o XML
                    self._enrich_sped_with_xml(sped_match, nf_item)
                    continue

                raw_nfs.append((filename, nf_item))

        if not raw_nfs:
            raise ValidationException("Nenhum arquivo XML de NF-e ou SPED Fiscal válido foi encontrado para processamento.")

        solicitacao.status = STATUS_PROCESSANDO
        self.db.commit()

        try:
            rows_por_destino: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
            notas_criadas: List[NotaFiscalProcessada] = []
            notas_ignoradas: List[Dict[str, Any]] = []
            cfops_sem_regra: Dict[str, int] = defaultdict(int)

            for filename, nf_data in raw_nfs:
                # 2. Camada 3: Validação de destinatário
                SanityChecker.validate_nf_destinatario(nf_data, empresa.cnpj)

                # 3. Regra Fundamental: Operação Interestadual (UF Fornecedor != UF Empresa Cliente)
                # Para apuração de antecipação parcial, antecipação tributária ou DIFAL, apenas notas
                # de fornecedores/terceiros de UF diferente da empresa cliente selecionada devem ser consideradas.
                uf_fornecedor = (nf_data.uf_emitente or "").strip().upper()
                uf_empresa_dest = (empresa.uf or "").strip().upper()

                if uf_fornecedor and uf_empresa_dest and uf_fornecedor == uf_empresa_dest:
                    dt_str = nf_data.data_emissao.strftime('%d/%m/%Y')
                    notas_ignoradas.append({
                        "numero_nota": nf_data.numero_nota,
                        "serie": nf_data.serie,
                        "chave_acesso": nf_data.chave_acesso,
                        "data_emissao": dt_str,
                        "motivo": f"Operação interna estadual desconsiderada: UF do fornecedor/emitente ({uf_fornecedor}) é igual à UF da empresa ({uf_empresa_dest}). Antecipação e DIFAL aplicam-se exclusivamente a aquisições interestaduais.",
                        "arquivo": filename
                    })
                    continue

                # 4. Camada 7: Checagem de período
                # Se a nota estiver fora do período definido, ela é ignorada e registrada no relatório
                if not SanityChecker.is_within_period(nf_data.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim):
                    dt_str = nf_data.data_emissao.strftime('%d/%m/%Y')
                    p_ini_str = solicitacao.periodo_inicio.strftime('%d/%m/%Y')
                    p_fim_str = solicitacao.periodo_fim.strftime('%d/%m/%Y')
                    notas_ignoradas.append({
                        "numero_nota": nf_data.numero_nota,
                        "serie": nf_data.serie,
                        "chave_acesso": nf_data.chave_acesso,
                        "data_emissao": dt_str,
                        "motivo": f"Data de emissão ({dt_str}) fora do período informado ({p_ini_str} a {p_fim_str}).",
                        "arquivo": filename
                    })
                    continue

                # 5. Enriquecimento: Correspondência de Data de Entrada
                data_entrada_resolvida = None
                origem_data = None

                if planilha_records:
                    data_entrada_resolvida, origem_data = DataEntradaMatcher.match_data_entrada(
                        nf_chave=nf_data.chave_acesso,
                        nf_cnpj_emitente=nf_data.cnpj_emitente,
                        nf_serie=nf_data.serie,
                        nf_numero=nf_data.numero_nota,
                        planilha_records=planilha_records
                    )

                # Se não foi fornecida/encontrada na planilha auxiliar, mas veio nativa no SPED ou NF:
                if data_entrada_resolvida is None and nf_data.data_entrada is not None:
                    data_entrada_resolvida = nf_data.data_entrada
                    origem_data = "sped_fiscal" if nf_data.origem_extracao == "sped" else "xml_nfe"

                # 5.1. Após a união das fontes, uma nota com origem_extracao == "xml" é uma nota
                # que foi EMITIDA na competência mas NÃO consta do SPED da mesma competência —
                # ou seja, a mercadoria ainda não deu entrada no estabelecimento. A antecipação
                # parcial dela é paga adiantada e apurada em planilha separada.
                # Só vale quando um SPED foi de fato enviado: sem ele, "ausente" não informa nada.
                pago_antecipadamente = (
                    sped_file_bytes is not None
                    and not modo_legado
                    and nf_data.origem_extracao == "xml"
                )

                # 6. Roteamento por CFOP: cada item é classificado em qual planilha (destino) se aplica.
                # Itens cujo CFOP não tem regra cadastrada são descartados em silêncio (apenas contabilizados
                # no resumo agregado da solicitação). No modo legado (tipo único), itens de outro destino
                # também são descartados aqui, restringindo a apuração ao tipo solicitado.
                grupos: Dict[Tuple[str, Decimal, Decimal], List[Any]] = {}

                for item in nf_data.itens:
                    destino_item = self.cfop_resolver.resolve_destino(empresa.perfil_regras_id, item.cfop)
                    if destino_item is None:
                        sufixo = re.sub(r"\D", "", item.cfop or "")
                        sufixo = sufixo[-3:] if len(sufixo) >= 3 else (sufixo or "????")
                        cfops_sem_regra[sufixo] += 1
                        continue

                    if destino_item == ANTECIPACAO_PARCIAL and pago_antecipadamente:
                        destino_item = ANTECIPACAO_PARCIAL_ANTECIPADO

                    if modo_legado and destino_item != solicitacao.tipo_planilha:
                        continue

                    # Camada 5: Resolução determinística de A.DST (NCM vs Estado)
                    a_dst = self.resolver.resolve_a_dst(
                        perfil_regras_id=empresa.perfil_regras_id,
                        uf=empresa.uf,
                        ncm=item.ncm
                    )
                    # A.ORI veio diretamente do XML/SPED (item.a_ori)
                    a_ori = item.a_ori

                    key = (destino_item, a_ori, a_dst)
                    if key not in grupos:
                        grupos[key] = []
                    grupos[key].append(item)

                if not grupos:
                    # Nenhum item desta nota foi roteado (CFOP sem regra ou fora do tipo legado solicitado)
                    continue

                qtd_itens_originais = len(nf_data.itens)
                qtd_itens_classificados = sum(len(v) for v in grupos.values())

                split_index_por_destino: Dict[str, int] = defaultdict(lambda: 1)

                for (destino_grupo, a_ori, a_dst), itens_objs in grupos.items():
                    split_index = split_index_por_destino[destino_grupo]

                    # Se a nota inteira produziu exatamente 1 bucket/grupo (nenhum item descartado e
                    # nenhum desdobramento por alíquota), o total oficial da NF-e pode ser usado direto.
                    # Caso contrário (múltiplos destinos, múltiplas alíquotas, ou itens descartados),
                    # os totais precisam ser somados a partir dos próprios itens do grupo.
                    usar_total_nota = (
                        len(grupos) == 1 and
                        qtd_itens_classificados == qtd_itens_originais and
                        nf_data.v_total_nota > 0
                    )

                    if usar_total_nota:
                        v_total_grupo = nf_data.v_total_nota
                        v_bc_grupo = nf_data.v_bc_nota if nf_data.v_bc_nota > 0 else sum(it.base_calculo for it in itens_objs)
                        ipi_despesas_grupo = sum(it.ipi_despesas for it in itens_objs)
                    else:
                        v_total_grupo = sum(it.v_total for it in itens_objs)
                        v_bc_grupo = sum(it.base_calculo for it in itens_objs)
                        ipi_despesas_grupo = sum(it.ipi_despesas for it in itens_objs)

                    # Se a base de cálculo for zero ou não declarada no grupo (ex: CST 60), a base é a mercadoria (v_total - ipi_despesas)
                    if v_bc_grupo <= Decimal("0.00"):
                        v_bc_grupo = v_total_grupo - ipi_despesas_grupo
                    elif v_bc_grupo > Decimal("0.00") and v_total_grupo > v_bc_grupo and ipi_despesas_grupo == Decimal("0.00"):
                        ipi_despesas_grupo = v_total_grupo - v_bc_grupo

                    ncm_grupo = itens_objs[0].ncm if itens_objs else ""
                    cfop_grupo = itens_objs[0].cfop if itens_objs else ""
                    descricao_grupo = itens_objs[0].descricao if len(itens_objs) == 1 else f"NF-e {nf_data.numero_nota} ({len(itens_objs)} itens)"

                    # Se o valor total for zero ou negativo (ex: nota complementar de ICMS, ajuste ou cancelada), ignora e registra no relatório
                    if v_total_grupo <= Decimal("0.00"):
                        dt_str = nf_data.data_emissao.strftime('%d/%m/%Y')
                        notas_ignoradas.append({
                            "numero_nota": nf_data.numero_nota,
                            "serie": nf_data.serie,
                            "chave_acesso": nf_data.chave_acesso,
                            "data_emissao": dt_str,
                            "motivo": f"Valor total zerado ou sem valor comercial (R$ {v_total_grupo:.2f}). Documento fiscal complementar/ajuste desconsiderado para apuração.",
                            "arquivo": filename
                        })
                        continue

                    mva_grupo = Decimal("0.00")
                    aliq_simples = "N"
                    if destino_grupo == ANTECIPACAO_TRIBUTARIA:
                        mva_grupo = MvaResolver.resolve_mva(ncm=ncm_grupo, a_ori=a_ori)
                    elif destino_grupo == DIFAL:
                        crt = (nf_data.raw_metadata.get("crt") or "").strip()
                        if crt in ("1", "2"):
                            aliq_simples = "S"
                        else:
                            aliq_simples = "N"

                    # Camada 6 e 7: Motor de cálculo (por destino) e validações numéricas
                    try:
                        calculator = CalculatorFactory.get_calculator(destino_grupo)
                        calc_result = calculator.calculate(
                            v_total=v_total_grupo,
                            base_calculo=v_bc_grupo,
                            ipi_despesas=ipi_despesas_grupo,
                            a_ori=a_ori,
                            a_dst=a_dst,
                            parametros_extras={"mva": mva_grupo, "aliq_simples": aliq_simples, "qtd_itens_grupo": len(itens_objs)}
                        )

                        SanityChecker.validate_numeric_values(
                            numero_nota=nf_data.numero_nota,
                            v_total=v_total_grupo,
                            base_calculo=v_bc_grupo,
                            a_ori=a_ori,
                            a_dst=a_dst
                        )
                    except ValidationException as val_err:
                        dt_str = nf_data.data_emissao.strftime('%d/%m/%Y')
                        notas_ignoradas.append({
                            "numero_nota": nf_data.numero_nota,
                            "serie": nf_data.serie,
                            "chave_acesso": nf_data.chave_acesso,
                            "data_emissao": dt_str,
                            "motivo": str(val_err),
                            "arquivo": filename
                        })
                        continue

                    # Criar registro de NotaFiscalProcessada
                    nf_proc = NotaFiscalProcessada(
                        solicitacao_id=solicitacao.id,
                        chave_acesso=nf_data.chave_acesso,
                        numero_nota=nf_data.numero_nota,
                        serie=nf_data.serie,
                        cnpj_emitente=nf_data.cnpj_emitente,
                        uf_emitente=nf_data.uf_emitente or uf_fornecedor,
                        cnpj_destinatario=nf_data.cnpj_destinatario,
                        uf_destinatario=empresa.uf,
                        data_emissao=nf_data.data_emissao,
                        data_entrada=data_entrada_resolvida,
                        origem_data_entrada=origem_data,
                        item_numero=split_index,
                        ncm=ncm_grupo,
                        cfop=cfop_grupo,
                        destino_planilha=destino_grupo,
                        v_total=v_total_grupo,
                        base_calculo=v_bc_grupo,
                        ipi_despesas=ipi_despesas_grupo,
                        a_ori=a_ori,
                        a_dst_resolvida=a_dst,
                        debito=calc_result.debito,
                        credito=calc_result.credito,
                        valor_devido=calc_result.valor_devido,
                        metadados_extras={
                            "desdobramento": len(grupos) > 1,
                            "subitem_index": split_index,
                            "total_subitens_destino": len(itens_objs),
                            "mva": str(mva_grupo),
                            "aliq_simples": aliq_simples,
                            **calc_result.detalhes
                        }
                    )
                    notas_criadas.append(nf_proc)

                    # Dados estruturados para escrita no Excel
                    rows_por_destino[destino_grupo].append({
                        "numero_nota": nf_data.numero_nota,
                        "serie": nf_data.serie,
                        "chave_acesso": nf_data.chave_acesso,
                        "cnpj_emitente": nf_data.cnpj_emitente,
                        "uf_emitente": nf_data.uf_emitente or uf_fornecedor,
                        "cnpj_destinatario": nf_data.cnpj_destinatario,
                        "uf_destinatario": empresa.uf,
                        "data_emissao": nf_data.data_emissao,
                        "data_entrada": data_entrada_resolvida,
                        "item_numero": split_index,
                        "descricao": descricao_grupo,
                        "ncm": ncm_grupo,
                        "cfop": cfop_grupo,
                        "v_total": v_total_grupo,
                        "base_calculo": v_bc_grupo,
                        "ipi_despesas": ipi_despesas_grupo,
                        "mva": mva_grupo,
                        "reducao": None,
                        "red": "",
                        "aliq_simples": aliq_simples,
                        "a_ori": a_ori,
                        "a_dst": a_dst,
                        "debito": calc_result.debito,
                        "credito": calc_result.credito,
                        "valor_devido": calc_result.valor_devido,
                    })
                    split_index_por_destino[destino_grupo] = split_index + 1

            total_rows = sum(len(v) for v in rows_por_destino.values())
            if total_rows == 0:
                total_ign = len(notas_ignoradas)
                p_ini_str = solicitacao.periodo_inicio.strftime('%d/%m/%Y')
                p_fim_str = solicitacao.periodo_fim.strftime('%d/%m/%Y')
                if total_ign > 0:
                    raise ValidationException(
                        f"Nenhuma NF-e válida para apuração interestadual encontrada dentro do período informado ({p_ini_str} a {p_fim_str}). "
                        f"Todas as {total_ign} nota(s) enviadas foram desconsideradas (motivos registrados no relatório de conferência)."
                    )
                elif cfops_sem_regra:
                    raise ValidationException(
                        "Nenhum item das notas enviadas correspondeu a um CFOP com regra de roteamento cadastrada "
                        "(Antecipação Parcial, Antecipação Tributária ou DIFAL). Cadastre as regras de CFOP em "
                        "'Perfis e Regras' antes de processar."
                    )
                else:
                    raise ValidationException("Nenhuma nota fiscal pôde ser processada a partir dos arquivos fornecidos.")

            # Ordenação cronológica aplicada dentro de cada planilha/destino
            for destino_key in list(rows_por_destino.keys()):
                rows_por_destino[destino_key].sort(key=nfe_sort_key)

            # Persistir todas as notas fiscais processadas (a ordem de exibição vem do order_by do relationship)
            for nf_proc in notas_criadas:
                self.db.add(nf_proc)

            ie_final = (empresa.inscricao_estadual or "").strip() or (sped_empresa_info.get("ie") if "sped_empresa_info" in locals() else "") or ""

            header_info = build_header_info(
                empresa,
                solicitacao.periodo_inicio,
                ie_final,
            )

            # Camada 8: Geração de saída(s) com proteção de fórmulas
            if modo_legado:
                destino = solicitacao.tipo_planilha
                rows = rows_por_destino.get(destino, [])
                if not rows:
                    raise ValidationException(
                        f"Nenhuma NF-e válida encontrada para o tipo de planilha '{destino}' com base nas regras de CFOP cadastradas."
                    )

                output_filename = f"planilha_{empresa.cnpj}_{destino}_{solicitacao.id[:8]}.xlsx"
                output_path = os.path.join(settings.OUTPUTS_DIR, output_filename)

                TemplateFiller.fill_template(
                    template_path=template_legado.arquivo_path,
                    mapping=template_legado.mapeamento_campos,
                    rows_data=rows,
                    output_path=output_path,
                    header_info=header_info
                )

                total_valor_devido = sum((r["valor_devido"] for r in rows), Decimal("0.00"))
                saida = SolicitacaoSaida(
                    solicitacao_id=solicitacao.id,
                    tipo=destino,
                    template_id=template_legado.id,
                    arquivo_path=output_path,
                    total_notas=len(rows),
                    total_valor_devido=total_valor_devido
                )
                self.db.add(saida)
                solicitacao.arquivo_saida_path = output_path
            else:
                for destino, rows in rows_por_destino.items():
                    total_valor_devido = sum((r["valor_devido"] for r in rows), Decimal("0.00"))

                    try:
                        template = TemplateManager.get_active_template(self.db, destino)
                    except NotFoundException as nf_err:
                        saida = SolicitacaoSaida(
                            solicitacao_id=solicitacao.id,
                            tipo=destino,
                            template_id=None,
                            arquivo_path=None,
                            total_notas=len(rows),
                            total_valor_devido=total_valor_devido,
                            aviso=str(nf_err)
                        )
                        self.db.add(saida)
                        continue

                    output_filename = f"planilha_{empresa.cnpj}_{destino}_{solicitacao.id[:8]}.xlsx"
                    output_path = os.path.join(settings.OUTPUTS_DIR, output_filename)

                    TemplateFiller.fill_template(
                        template_path=template.arquivo_path,
                        mapping=template.mapeamento_campos,
                        rows_data=rows,
                        output_path=output_path,
                        header_info=header_info
                    )

                    saida = SolicitacaoSaida(
                        solicitacao_id=solicitacao.id,
                        tipo=destino,
                        template_id=template.id,
                        arquivo_path=output_path,
                        total_notas=len(rows),
                        total_valor_devido=total_valor_devido
                    )
                    self.db.add(saida)

            # Atualizar status e resultado da solicitação
            solicitacao.status = STATUS_CONCLUIDO
            solicitacao.total_notas_processadas = len(notas_criadas)
            solicitacao.notas_ignoradas = notas_ignoradas
            solicitacao.cfops_sem_regra = dict(cfops_sem_regra)
            solicitacao.mensagem_erro = None
            self.db.commit()
            self.db.refresh(solicitacao)

            return solicitacao

        except Exception as e:
            self.db.rollback()
            solicitacao.status = STATUS_ERRO
            solicitacao.mensagem_erro = str(e)
            self.db.commit()
            raise e
