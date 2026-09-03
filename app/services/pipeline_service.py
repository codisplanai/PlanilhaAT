import re
from datetime import datetime
from collections import defaultdict
from decimal import Decimal
from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session

from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.template_xlsx import TemplateXlsx
from app.core.exceptions import (
    ValidationException, NotFoundException, RuleResolutionException, PlanilhaATException,
)
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
from app.services.extraction.data_entrada_matcher import (
    DataEntradaMatcher,
)
from app.services.rules_engine.aliquota_resolver import AliquotaResolver, ResolucaoAliquota
from app.services.rules_engine.cfop_resolver import CfopResolver, ResolucaoCfop
from app.services.rules_engine.mva_resolver import MvaResolver
from app.services.calculation.factory import CalculatorFactory
from app.services.validation.sanity_checker import SanityChecker
from app.services.templates_admin.template_manager import TemplateManager
from app.services.pipeline_outputs import GeneratedArtifacts, PipelineOutputService
from app.services.pipeline_sources import PipelineSourceLoader
from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_TRIBUTARIA,
    DIFAL,
    STATUS_CONCLUIDO,
    STATUS_ERRO,
    STATUS_PENDENTE,
    STATUS_PROCESSANDO,
    TIPOS_PLANILHA_LEGADO,
)
from app.services.pipeline_helpers import (
    build_header_info,
    crossing_keys,
    enrich_sped_with_xml,
    ignored_note,
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
        self.output_service = PipelineOutputService(db)
        self.source_loader = PipelineSourceLoader(self.extractor, self.sped_extractor)

    @staticmethod
    def _chaves_cruzamento(nf: Any) -> List[str]:
        return crossing_keys(nf)

    @staticmethod
    def _enrich_sped_with_xml(nf_sped: Any, nf_xml: Any) -> None:
        enrich_sped_with_xml(nf_sped, nf_xml)

    def regenerate_outputs(self, solicitacao: Solicitacao) -> None:
        self.output_service.regenerate(solicitacao)

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

        claimed = (
            self.db.query(Solicitacao)
            .filter(
                Solicitacao.id == solicitacao_id,
                Solicitacao.status.in_([STATUS_PENDENTE, STATUS_ERRO]),
            )
            .update({Solicitacao.status: STATUS_PROCESSANDO}, synchronize_session=False)
        )
        if claimed != 1:
            raise ValidationException("Esta solicitação já está sendo processada ou foi concluída.")
        self.db.commit()
        self.db.refresh(solicitacao)

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

        sources = self.source_loader.load(
            solicitacao=solicitacao,
            empresa=empresa,
            xml_files=xml_files_bytes,
            sped_content=sped_file_bytes,
            sped_filename=sped_filename,
            entry_sheet_content=planilha_entradas_bytes,
            entry_sheet_filename=planilha_entradas_filename,
        )
        raw_nfs = sources.notes
        planilha_records = sources.entry_records
        sped_empresa_info = sources.sped_company_info

        generated_artifacts = GeneratedArtifacts()
        try:
            rows_por_destino: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
            notas_criadas: List[NotaFiscalProcessada] = []
            notas_ignoradas: List[Dict[str, Any]] = list(sources.ignored_notes)
            cfops_sem_regra: Dict[str, int] = defaultdict(int)
            # Carrega as regras dos três níveis uma vez: o resolver é chamado
            # item a item e sem isto faria consultas repetidas por nota.
            self.resolver.preload(empresa.perfil_regras_id, empresa.id)
            self.cfop_resolver.preload_reclassificacoes(empresa.perfil_regras_id)

            for filename, nf_data in raw_nfs:
                # 2. Camada 3: Validação de destinatário
                SanityChecker.validate_nf_destinatario(nf_data, empresa.cnpj)

                # 3. Regra Fundamental: Operação Interestadual (UF Fornecedor != UF Empresa Cliente)
                # Para apuração de antecipação parcial, antecipação tributária ou DIFAL, apenas notas
                # de fornecedores/terceiros de UF diferente da empresa cliente selecionada devem ser consideradas.
                uf_fornecedor = (nf_data.uf_emitente or "").strip().upper()
                uf_empresa_dest = (empresa.uf or "").strip().upper()

                if uf_fornecedor and uf_empresa_dest and uf_fornecedor == uf_empresa_dest:
                    notas_ignoradas.append(
                        ignored_note(
                            nf_data,
                            filename,
                            f"Operação interna estadual desconsiderada: UF do "
                            f"fornecedor/emitente ({uf_fornecedor}) é igual à UF da "
                            f"empresa ({uf_empresa_dest}). Antecipação e DIFAL aplicam-se "
                            f"exclusivamente a aquisições interestaduais.",
                        )
                    )
                    continue

                # 4. Camada 7: Checagem de período
                # Se a nota estiver fora do período definido, ela é ignorada e registrada no relatório
                if not SanityChecker.is_within_period(nf_data.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim):
                    dt_str = nf_data.data_emissao.strftime('%d/%m/%Y')
                    p_ini_str = solicitacao.periodo_inicio.strftime('%d/%m/%Y')
                    p_fim_str = solicitacao.periodo_fim.strftime('%d/%m/%Y')
                    notas_ignoradas.append(
                        ignored_note(
                            nf_data,
                            filename,
                            f"Data de emissão ({dt_str}) fora do período informado "
                            f"({p_ini_str} a {p_fim_str}).",
                        )
                    )
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

                # Se não foi fornecida/encontrada na planilha auxiliar, mas veio nativa no SPED:
                # Regra estrita: Apenas o SPED Fiscal (ou planilha auxiliar) fornece data de entrada real.
                if data_entrada_resolvida is None and nf_data.data_entrada is not None and nf_data.origem_extracao == "sped":
                    data_entrada_resolvida = nf_data.data_entrada
                    origem_data = "sped_fiscal"

                # 5.1. Comprovação de Entrada e Antecipação Parcial Paga Antecipadamente:
                # O SPED Fiscal e a Planilha Auxiliar de Entradas são as fontes válidas de comprovação de entrada.
                # Se ao menos uma dessas fontes foi enviada, uma nota é considerada com entrada comprovada se:
                #   - Constar no SPED Fiscal (nf_data.origem_extracao == "sped"); OU
                #   - Constar na Planilha Auxiliar (data_entrada_resolvida is not None).
                # Caso uma fonte tenha sido enviada mas a nota não tenha entrada comprovada em nenhuma delas,
                # entende-se que a mercadoria ainda não deu entrada física. A antecipação parcial é paga
                # adiantada e apurada na planilha 'Parcial Pago Antecipadamente'.
                # Se NENHUMA fonte de entradas foi enviada (apenas XMLs puros), nada é considerado antecipado.
                tem_fonte_entradas = (sped_file_bytes is not None) or bool(planilha_records)
                teve_entrada_comprovada = (nf_data.origem_extracao == "sped") or (data_entrada_resolvida is not None)
                pago_antecipadamente = (
                    tem_fonte_entradas
                    and not modo_legado
                    and not teve_entrada_comprovada
                )

                # 6. Roteamento por CFOP: cada item é classificado em qual planilha (destino) se aplica.
                # Itens cujo CFOP não tem regra cadastrada são descartados em silêncio (apenas contabilizados
                # no resumo agregado da solicitação). No modo legado (tipo único), itens de outro destino
                # também são descartados aqui, restringindo a apuração ao tipo solicitado.
                grupos: Dict[Tuple[str, Decimal, Decimal, str, str], List[Any]] = {}
                resolucoes: Dict[Tuple[str, Decimal, Decimal, str, str], List[ResolucaoAliquota]] = {}
                resolucoes_cfop: Dict[Tuple[str, Decimal, Decimal, str, str], List[ResolucaoCfop]] = {}

                for item in nf_data.itens:
                    resolucao_cfop = self.cfop_resolver.reclassificar_cfop(
                        perfil_regras_id=empresa.perfil_regras_id,
                        ncm=item.ncm,
                        descricao=item.descricao if item.descricao_confiavel else None,
                        cfop_original=item.cfop,
                    )
                    destino_item = resolucao_cfop.destino
                    if destino_item is None:
                        sufixo = re.sub(r"\D", "", item.cfop or "")
                        sufixo = sufixo[-3:] if len(sufixo) >= 3 else (sufixo or "????")
                        cfops_sem_regra[sufixo] += 1
                        continue

                    if resolucao_cfop.reclassificado:
                        item.cfop = resolucao_cfop.cfop_efetivo

                    if destino_item == ANTECIPACAO_PARCIAL and pago_antecipadamente:
                        destino_item = ANTECIPACAO_PARCIAL_ANTECIPADO

                    if modo_legado and destino_item != solicitacao.tipo_planilha:
                        continue

                    # Camada 5: Resolução determinística de A.DST em três níveis
                    try:
                        resolucao = self.resolver.resolve_a_dst(
                            perfil_regras_id=empresa.perfil_regras_id,
                            uf=empresa.uf,
                            ncm=item.ncm,
                            descricao=item.descricao if item.descricao_confiavel else None,
                            empresa_id=empresa.id,
                        )
                    except RuleResolutionException as err:
                        # Sem identificar a nota, a mensagem não é acionável.
                        raise RuleResolutionException(
                            f"NF-e {nf_data.numero_nota} (arquivo {filename}): {err.message}"
                        ) from err
                    a_dst = resolucao.aliquota
                    # A.ORI veio diretamente do XML/SPED (item.a_ori)
                    a_ori = item.a_ori

                    key = (
                        destino_item,
                        a_ori,
                        a_dst,
                        item.ncm if destino_item == ANTECIPACAO_TRIBUTARIA else "",
                        item.cest if destino_item == ANTECIPACAO_TRIBUTARIA else "",
                    )
                    if key not in grupos:
                        grupos[key] = []
                        resolucoes[key] = []
                        resolucoes_cfop[key] = []
                    grupos[key].append(item)
                    resolucoes[key].append(resolucao)
                    resolucoes_cfop[key].append(resolucao_cfop)

                if not grupos:
                    # Nenhum item desta nota foi roteado (CFOP sem regra ou fora do tipo legado solicitado)
                    continue

                qtd_itens_originais = len(nf_data.itens)
                qtd_itens_classificados = sum(len(v) for v in grupos.values())

                split_index_por_destino: Dict[str, int] = defaultdict(lambda: 1)

                for grupo_key, itens_objs in grupos.items():
                    destino_grupo, a_ori, a_dst, _group_ncm, _group_cest = grupo_key
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
                        notas_ignoradas.append(
                            ignored_note(
                                nf_data,
                                filename,
                                f"Valor total zerado ou sem valor comercial "
                                f"(R$ {v_total_grupo:.2f}). Documento fiscal "
                                f"complementar/ajuste desconsiderado para apuração.",
                            )
                        )
                        continue

                    mva_grupo = Decimal("0.00")
                    aliq_simples = "N"
                    if destino_grupo == ANTECIPACAO_TRIBUTARIA:
                        mva_grupo = MvaResolver.resolve_mva(
                            ncm=ncm_grupo,
                            a_ori=a_ori,
                            cest=itens_objs[0].cest if itens_objs else None,
                        )
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
                        notas_ignoradas.append(
                            ignored_note(nf_data, filename, str(val_err))
                        )
                        continue

                    # Regra estrita de Data de Entrada:
                    # 1. Na planilha/destino de Parcial Pago Antecipadamente, as mercadorias ainda não
                    #    deram entrada. A data de entrada DEVE ser estritamente None (vazia/nula) no banco e Excel.
                    # 2. Nas demais planilhas, a data de entrada é a informada no SPED Fiscal (ou planilha auxiliar).
                    #    Nunca deduzir ou utilizar data de emissão como fallback.
                    data_entrada_efetiva = (
                        None
                        if destino_grupo == ANTECIPACAO_PARCIAL_ANTECIPADO
                        else data_entrada_resolvida
                    )
                    origem_data_efetiva = (
                        None
                        if destino_grupo == ANTECIPACAO_PARCIAL_ANTECIPADO
                        else origem_data
                    )

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
                        data_entrada=data_entrada_efetiva,
                        origem_data_entrada=origem_data_efetiva,
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
                            "origem_a_dst": sorted({r.origem for r in resolucoes.get(grupo_key, [])}),
                            "detalhe_a_dst": "; ".join(
                                sorted({r.detalhe for r in resolucoes.get(grupo_key, [])})
                            ),
                            "cfop_reclassificado": any(
                                rc.reclassificado for rc in resolucoes_cfop.get(grupo_key, [])
                            ),
                            "detalhe_cfop": "; ".join(
                                sorted({rc.motivo for rc in resolucoes_cfop.get(grupo_key, []) if rc.motivo})
                            ),
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
                        "data_entrada": data_entrada_efetiva,
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

            ie_final = (empresa.inscricao_estadual or "").strip() or (sped_empresa_info.get("ie") if sped_empresa_info else "") or ""

            header_info = build_header_info(
                empresa,
                solicitacao.periodo_inicio,
                ie_final,
            )

            # Camada 8: geração de saída(s), armazenamento e compensação de artefatos.
            generated_artifacts = self.output_service.generate(
                solicitacao=solicitacao,
                empresa=empresa,
                rows_by_destination=rows_por_destino,
                legacy_mode=modo_legado,
                legacy_template=template_legado,
                header_info=header_info,
            )

            # Atualizar status e resultado da solicitação
            solicitacao.status = STATUS_CONCLUIDO
            solicitacao.total_notas_processadas = len(notas_criadas)
            solicitacao.notas_ignoradas = notas_ignoradas
            solicitacao.cfops_sem_regra = dict(cfops_sem_regra)
            solicitacao.mensagem_erro = None
            self.db.commit()
            self.db.refresh(solicitacao)

            return solicitacao

        except Exception as exc:
            self.db.rollback()
            generated_artifacts.cleanup()
            solicitacao.status = STATUS_ERRO
            # RuleResolutionException herda de PlanilhaATException, não de
            # ValidationException: sem isto, toda mensagem de regra chegava ao
            # usuário como "Falha interna".
            solicitacao.mensagem_erro = (
                str(exc) if isinstance(exc, PlanilhaATException)
                else "Falha interna ao processar os arquivos."
            )
            self.db.commit()
            raise
