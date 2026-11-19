import re
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session

from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.template_xlsx import TemplateXlsx
from app.core.exceptions import (
    ValidationException, RuleResolutionException,
)
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
from app.services.extraction.data_entrada_matcher import (
    DataEntradaMatcher,
)
from app.services.rules_engine.aliquota_resolver import AliquotaResolver, ResolucaoAliquota
from app.services.rules_engine.cfop_resolver import CfopResolver, ResolucaoCfop
from app.services.rules_engine.interstate_rate_resolver import InterstateRateResolver
from app.services.rules_engine.mva_resolver import MvaResolver
from app.services.rules_engine.revenda_antecipacao_policy import RevendaAntecipacaoTributariaPolicy
from app.services.rules_engine.st_tributaria_exclusion import (
    should_exclude_st_from_tributaria,
    ST_TRIBUTARIA_EXCLUSION_REASON,
)
from app.services.rules_engine.parcial_decision import (
    DESTINOS_PARCIAL,
    DecisaoExclusaoItem,
    ParcialExclusionService,
)
from app.services.rules_engine.descricao_matcher import normalizar
from app.services.calculation.base import CalculationResult
from app.services.calculation.factory import CalculatorFactory
from app.services.validation.sanity_checker import SanityChecker
from app.services.templates_admin.template_manager import TemplateManager
from app.services.pipeline_outputs import GeneratedArtifacts, PipelineOutputService
from app.services.pipeline_lifecycle import PipelineLifecycle
from app.services.pipeline_analysis import (
    CFOP_SUFFIXES_REQUIRING_DESTINATION,
    PipelinePreAnalyzer,
    _nfe_disponivel_para_cte,
)
from app.services.pipeline_cte import (
    avaliar_nfe_para_cte,
    get_eligible_cte_nfe_keys,
    processar_ctes,
)
from app.services.pipeline_sources import PipelineSourceLoader
from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_SIMPLES,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    ATIVIDADE_INDUSTRIA,
    CONTROLE_IMPOSTO_PAGO_ENTRADA,
    DESTINOS_ANTECIPADOS,
    DESTINOS_DIFAL,
    DESTINOS_TRIBUTARIA,
    DIFAL,
    DIFAL_ANTECIPADO,
    MOTIVO_DIFAL_AGUARDANDO_ENTRADA,
    MOTIVO_EXCLUSAO_INDUSTRIA,
    NCM_SENTINELA,
    TIPO_EXCLUSAO_MVA_PENDENTE,
    TIPOS_PLANILHA_LEGADO,
)
from app.services.pipeline_helpers import (
    aceita_difal_retroativa,
    aviso_difal_retroativa,
    build_controle_row,
    build_header_info,
    consolidar_linhas_controle,
    crossing_keys,
    enrich_sped_with_xml,
    excluir_item_industria_serialized,
    ignored_note,
    is_cfop_uso_consumo_ativo,
    is_emissao_propria,
    is_imposto_pago_entrada,
    nfe_sort_key,
    no_output_message,
    resolve_inscricao_estadual,
    serialize_excluded_item,
)

GrupoKey = Tuple[str, Decimal, Decimal, Decimal, Optional[Decimal], Optional[Decimal]]


@dataclass(frozen=True)
class ResolucaoAliquotasItem:
    a_ori: Decimal
    a_dst: Decimal
    a_dst_base: Decimal
    resolucao: ResolucaoAliquota
    resolucao_fcp: Optional[ResolucaoAliquota]
    fcp_separado: Optional[Decimal]
    a_ori_original: Decimal
    a_ori_destacada: bool
    a_ori_inferida_simples: bool
    a_ori_inf_compl: bool
    a_ori_limitada: bool
    reducao_item: Optional[Decimal]


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
        self.parcial_exclusion = ParcialExclusionService(db)
        self.output_service = PipelineOutputService(db)
        self.source_loader = PipelineSourceLoader(self.extractor, self.sped_extractor)
        self.lifecycle = PipelineLifecycle(db)

    @staticmethod
    def _chaves_cruzamento(nf: Any) -> List[str]:
        return crossing_keys(nf)

    @staticmethod
    def _enrich_sped_with_xml(nf_sped: Any, nf_xml: Any) -> None:
        enrich_sped_with_xml(nf_sped, nf_xml)

    def regenerate_outputs(self, solicitacao: Solicitacao) -> None:
        self.output_service.regenerate(solicitacao)

    def pre_analisar(
        self,
        solicitacao_id: str,
        xml_files_bytes: Optional[List[Tuple[str, bytes]]] = None,
        sped_file_bytes: Optional[bytes] = None,
        sped_filename: Optional[str] = "sped_fiscal.txt",
        sped_files_bytes: Optional[List[Tuple[str, bytes]]] = None,
        planilha_entradas_bytes: Optional[bytes] = None,
        planilha_entradas_filename: Optional[str] = "planilha_entradas.xlsx",
    ) -> Dict[str, Any]:
        solicitacao = self.lifecycle.get_solicitacao(solicitacao_id)
        empresa = self.lifecycle.get_empresa(solicitacao.empresa_id)

        sources = self.source_loader.load(
            solicitacao=solicitacao,
            empresa=empresa,
            xml_files=xml_files_bytes,
            sped_content=sped_file_bytes,
            sped_filename=sped_filename,
            sped_files=sped_files_bytes,
            entry_sheet_content=planilha_entradas_bytes,
            entry_sheet_filename=planilha_entradas_filename,
        )

        return PipelinePreAnalyzer.analyze(
            sources.notes, empresa, solicitacao, ctes=getattr(sources, "ctes", None) or []
        )

    def process_solicitacao(
        self,
        solicitacao_id: str,
        xml_files_bytes: Optional[List[Tuple[str, bytes]]] = None, # [(filename, bytes), ...]
        sped_file_bytes: Optional[bytes] = None,
        sped_filename: Optional[str] = "sped_fiscal.txt",
        sped_files_bytes: Optional[List[Tuple[str, bytes]]] = None,
        planilha_entradas_bytes: Optional[bytes] = None,
        planilha_entradas_filename: Optional[str] = "planilha_entradas.xlsx",
        decisoes_bonificacao: Optional[Dict[str, bool]] = None,
    ) -> Solicitacao:
        solicitacao = self.lifecycle.get_solicitacao(solicitacao_id)
        self.lifecycle.claim(solicitacao)
        empresa = self.lifecycle.get_empresa(solicitacao.empresa_id)

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
                template_legado = TemplateManager.get_active_template(
                    self.db,
                    solicitacao.tipo_planilha,
                    empresa_id=empresa.id,
                )
                solicitacao.template_id = template_legado.id

        has_sped = bool(sped_files_bytes) or (sped_file_bytes is not None)
        if not xml_files_bytes and not has_sped:
            raise ValidationException("Nenhum arquivo XML de NF-e ou SPED Fiscal foi enviado para processamento.")

        sources = self.source_loader.load(
            solicitacao=solicitacao,
            empresa=empresa,
            xml_files=xml_files_bytes,
            sped_content=sped_file_bytes,
            sped_filename=sped_filename,
            sped_files=sped_files_bytes,
            entry_sheet_content=planilha_entradas_bytes,
            entry_sheet_filename=planilha_entradas_filename,
        )
        raw_nfs = sources.notes
        raw_ctes = getattr(sources, "ctes", None) or []
        sped_cte_records = getattr(sources, "sped_cte_records", None) or {}
        planilha_records = sources.entry_records
        sped_empresa_info = sources.sped_company_info

        generated_artifacts = GeneratedArtifacts()
        try:
            rows_por_destino: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
            fcp_rows_por_destino: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
            notas_criadas: List[NotaFiscalProcessada] = []
            notas_ignoradas: List[Dict[str, Any]] = list(sources.ignored_notes)
            itens_excluidos: List[Dict[str, Any]] = []
            avisos_avaliacao: List[Dict[str, Any]] = []
            cfops_sem_regra: Dict[str, int] = defaultdict(int)
            erros_validacao: List[str] = []
            # Carrega as regras dos três níveis uma vez: o resolver é chamado
            # item a item e sem isto faria consultas repetidas por nota.
            self.resolver.preload(empresa.perfil_regras_id, empresa.id)
            self.cfop_resolver.preload_reclassificacoes(empresa.perfil_regras_id)
            self.parcial_exclusion.preload(empresa.perfil_regras_id, empresa.uf)
            configuracoes_perfil = (
                empresa.perfil_regras.configuracoes_extras
                if empresa.perfil_regras and empresa.perfil_regras.configuracoes_extras
                else {}
            )
            revenda_tributaria_config = RevendaAntecipacaoTributariaPolicy.config_for_empresa(
                configuracoes_perfil,
                empresa.cnpj,
            )
            is_industria = empresa.atividade == ATIVIDADE_INDUSTRIA
            referenced_nfe_chaves = get_eligible_cte_nfe_keys(
                raw_ctes, empresa, solicitacao
            )
            nfe_context_by_chave: Dict[str, Dict[str, Any]] = {}

            for filename, nf_data in raw_nfs:
                clean_chave = re.sub(r"\D", "", nf_data.chave_acesso or "")
                is_referenced_by_cte = bool(
                    clean_chave and clean_chave in referenced_nfe_chaves
                )
                if is_referenced_by_cte and _nfe_disponivel_para_cte(nf_data):
                    nfe_context_by_chave[clean_chave] = avaliar_nfe_para_cte(
                        pipeline=self,
                        nf_data=nf_data,
                        filename=filename,
                        empresa=empresa,
                        planilha_records=planilha_records,
                        has_sped=has_sped,
                        modo_legado=modo_legado,
                        configuracoes_perfil=configuracoes_perfil,
                        revenda_tributaria_config=revenda_tributaria_config,
                        is_industria=is_industria,
                        decisoes_bonificacao=decisoes_bonificacao,
                    )

                eligibilidade = self._validar_elegibilidade_nota(
                    nf_data=nf_data,
                    filename=filename,
                    empresa=empresa,
                    solicitacao=solicitacao,
                    notas_ignoradas=notas_ignoradas,
                    is_referenced_by_cte=is_referenced_by_cte,
                )
                if eligibilidade is None:
                    continue
                retroativa, motivo_fora_periodo = eligibilidade

                (
                    data_entrada_resolvida,
                    origem_data,
                    pago_antecipadamente,
                    cfop_auxiliar,
                ) = self._resolver_contexto_entrada_nota(
                    nf_data=nf_data,
                    planilha_records=planilha_records,
                    has_sped=has_sped,
                    modo_legado=modo_legado,
                )

                uf_fornecedor = (nf_data.uf_emitente or "").strip().upper()
                uf_empresa_dest = (empresa.uf or "").strip().upper()
                is_operacao_interestadual = bool(
                    uf_fornecedor and uf_empresa_dest and uf_fornecedor != uf_empresa_dest
                )
                crt_fornecedor = (nf_data.raw_metadata.get("crt") or "").strip()
                evidencia_csosn = (
                    bool(nf_data.raw_metadata.get("fornecedor_simples_nacional"))
                    or any(bool(it.csosn) for it in nf_data.itens)
                )
                is_fornecedor_simples = crt_fornecedor in ("1", "2", "4") or evidencia_csosn
                # Coluna da MVA do Anexo 1 (fluxo geral da Tributária). Decidida pelo CRT,
                # e não por is_fornecedor_simples: o CRT 2 conta como Simples para a A.ORI
                # e o DIFAL, mas usa a MVA ajustada. Sem CRT (nota só do SPED), a
                # evidência é o CSOSN, exclusivo de CRT 1 e 4.
                coluna_mva_nota = MvaResolver.coluna_por_regime(
                    crt_fornecedor,
                    evidencia_csosn=evidencia_csosn,
                )

                grupos: Dict[GrupoKey, List[Any]] = {}
                resolucoes: Dict[GrupoKey, List[ResolucaoAliquota]] = {}
                resolucoes_fcp: Dict[GrupoKey, List[Optional[ResolucaoAliquota]]] = {}
                a_dst_bases: Dict[GrupoKey, List[Decimal]] = {}
                resolucoes_cfop: Dict[GrupoKey, List[ResolucaoCfop]] = {}
                info_a_ori: Dict[GrupoKey, Dict[str, Any]] = {}
                info_mva_policy: Dict[GrupoKey, Dict[str, Any]] = {}
                itens_retroativos_pulados: List[int] = []
                itens_aguardando_entrada: List[int] = []
                exclude_st_tributaria_note = should_exclude_st_from_tributaria(
                    empresa.razao_social, nf_data
                )

                for item in nf_data.itens:
                    bonificacao_uso_consumo = False
                    mva_policy_group = ""
                    mva_policy_source = ""
                    if cfop_auxiliar and is_cfop_uso_consumo_ativo(cfop_auxiliar):
                        item.cfop = cfop_auxiliar

                    resolucao_cfop = self.cfop_resolver.reclassificar_cfop(
                        perfil_regras_id=empresa.perfil_regras_id,
                        ncm=item.ncm,
                        descricao=item.descricao if item.descricao_confiavel else None,
                        cfop_original=item.cfop,
                    )
                    destino_item = resolucao_cfop.destino

                    if is_cfop_uso_consumo_ativo(item.cfop):
                        destino_item = DIFAL

                    sufixo_item = re.sub(r"\D", "", item.cfop or "")[-3:]
                    if sufixo_item in CFOP_SUFFIXES_REQUIRING_DESTINATION and decisoes_bonificacao is not None:
                        is_revenda = None
                        if nf_data.chave_acesso and nf_data.chave_acesso in decisoes_bonificacao:
                            is_revenda = decisoes_bonificacao[nf_data.chave_acesso]
                        elif nf_data.numero_nota and str(nf_data.numero_nota) in decisoes_bonificacao:
                            is_revenda = decisoes_bonificacao[str(nf_data.numero_nota)]

                        if is_revenda is True and is_industria:
                            itens_excluidos.append(
                                excluir_item_industria_serialized(
                                    nf_data,
                                    item,
                                    filename,
                                    ANTECIPACAO_PARCIAL,
                                    f"Bonificação/amostra/outras entradas (CFOP {item.cfop}) não confirmada "
                                    "como uso/consumo pelo usuário (empresa industrial).",
                                )
                            )
                            continue

                        if is_revenda is not None:
                            if is_revenda:
                                destino_item = ANTECIPACAO_PARCIAL
                            else:
                                destino_item = DIFAL
                                bonificacao_uso_consumo = True

                    if destino_item is None:
                        if retroativa:
                            itens_retroativos_pulados.append(item.item_numero)
                            continue
                        if sufixo_item not in CFOP_SUFFIXES_REQUIRING_DESTINATION or decisoes_bonificacao is None:
                            sufixo = sufixo_item if len(sufixo_item) >= 3 else (sufixo_item or "????")
                            cfops_sem_regra[sufixo] += 1
                        continue

                    if resolucao_cfop.reclassificado:
                        item.cfop = resolucao_cfop.cfop_efetivo

                    if revenda_tributaria_config and destino_item == ANTECIPACAO_PARCIAL:
                        destino_item = ANTECIPACAO_TRIBUTARIA

                    if revenda_tributaria_config and destino_item == ANTECIPACAO_TRIBUTARIA:
                        classificacao_mva = RevendaAntecipacaoTributariaPolicy.classify(
                            config=revenda_tributaria_config,
                            ncm=item.ncm,
                            descricao=item.descricao,
                            descricao_confiavel=item.descricao_confiavel,
                        )
                        mva_policy_group = classificacao_mva.grupo
                        mva_policy_source = classificacao_mva.fonte
                        if classificacao_mva.aviso:
                            avisos_avaliacao.append({
                                "numero_nota": nf_data.numero_nota,
                                "serie": nf_data.serie,
                                "item_numero": item.item_numero,
                                "arquivo": filename,
                                "aviso": classificacao_mva.aviso,
                            })

                    destino_item = self._rotear_destino_pagamento_e_regime(
                        destino_item=destino_item,
                        pago_antecipadamente=pago_antecipadamente,
                        optante_simples=empresa.optante_simples_nacional,
                    )

                    if destino_item == DIFAL and pago_antecipadamente and bonificacao_uso_consumo:
                        itens_aguardando_entrada.append(item.item_numero)
                        continue

                    if empresa.optante_simples_nacional:
                        if destino_item == ANTECIPACAO_PARCIAL:
                            destino_item = ANTECIPACAO_PARCIAL_SIMPLES
                        elif destino_item == ANTECIPACAO_PARCIAL_ANTECIPADO:
                            destino_item = ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES

                    if is_industria and destino_item not in DESTINOS_DIFAL and not retroativa:
                        itens_excluidos.append(
                            excluir_item_industria_serialized(
                                nf_data, item, filename, destino_item, MOTIVO_EXCLUSAO_INDUSTRIA
                            )
                        )
                        continue

                    if retroativa and destino_item != DIFAL:
                        itens_retroativos_pulados.append(item.item_numero)
                        continue

                    if exclude_st_tributaria_note and destino_item in DESTINOS_TRIBUTARIA:
                        itens_excluidos.append(
                            serialize_excluded_item(
                                nf_data,
                                item,
                                filename,
                                destino_item,
                                DecisaoExclusaoItem(
                                    excluido=True,
                                    tipo_exclusao="mercadoria",
                                    motivo=ST_TRIBUTARIA_EXCLUSION_REASON,
                                    v_total=item.v_total,
                                    base_calculo=item.base_calculo,
                                    ipi_despesas=item.ipi_despesas,
                                    a_ori=item.a_ori,
                                ),
                            )
                        )
                        continue

                    if modo_legado and not self._compativel_com_modo_legado(
                        destino_item, solicitacao.tipo_planilha
                    ):
                        continue

                    if destino_item in DESTINOS_PARCIAL and self._avaliar_exclusao_parcial_mercadoria(
                        nf_data=nf_data,
                        item=item,
                        filename=filename,
                        destino_item=destino_item,
                        empresa=empresa,
                        data_entrada_resolvida=data_entrada_resolvida,
                        avisos_avaliacao=avisos_avaliacao,
                        itens_excluidos=itens_excluidos,
                        rows_por_destino=rows_por_destino,
                    ):
                        continue

                    aliq = self._resolver_aliquotas_item(
                        nf_data=nf_data,
                        item=item,
                        filename=filename,
                        destino_item=destino_item,
                        empresa=empresa,
                        configuracoes_perfil=configuracoes_perfil,
                        uf_fornecedor=uf_fornecedor,
                        uf_empresa_dest=uf_empresa_dest,
                        is_fornecedor_simples=is_fornecedor_simples,
                        is_operacao_interestadual=is_operacao_interestadual,
                        avisos_avaliacao=avisos_avaliacao,
                    )

                    if destino_item in DESTINOS_PARCIAL:
                        decisao_numerica = self.parcial_exclusion.avaliar_aliquotas_iguais(
                            perfil_regras_id=empresa.perfil_regras_id,
                            uf_empresa=empresa.uf,
                            destino=destino_item,
                            v_total=item.v_total,
                            base_calculo=item.base_calculo,
                            ipi_despesas=item.ipi_despesas,
                            a_ori=aliq.a_ori,
                            a_dst=aliq.a_dst,
                            is_simples=empresa.optante_simples_nacional,
                        )
                        if decisao_numerica.excluido:
                            itens_excluidos.append(
                                serialize_excluded_item(
                                    nf_data,
                                    item,
                                    filename,
                                    destino_item,
                                    decisao_numerica,
                                )
                            )
                            continue

                    mva_item = self._resolver_mva_item(
                        nf_data=nf_data,
                        item=item,
                        filename=filename,
                        destino_item=destino_item,
                        a_ori=aliq.a_ori,
                        a_dst=aliq.a_dst,
                        a_ori_original=aliq.a_ori_original,
                        is_fornecedor_simples=is_fornecedor_simples,
                        coluna_mva_nota=coluna_mva_nota,
                        revenda_tributaria_config=revenda_tributaria_config,
                        mva_policy_group=mva_policy_group,
                        itens_excluidos=itens_excluidos,
                    )
                    if mva_item is None:
                        continue

                    key: GrupoKey = (
                        destino_item,
                        aliq.a_ori,
                        aliq.a_dst,
                        mva_item,
                        aliq.reducao_item,
                        aliq.fcp_separado,
                    )
                    if key not in grupos:
                        grupos[key] = []
                        resolucoes[key] = []
                        resolucoes_fcp[key] = []
                        a_dst_bases[key] = []
                        resolucoes_cfop[key] = []
                        info_a_ori[key] = {
                            "limitada": False,
                            "original": str(aliq.a_ori_original),
                            "inferida_simples": aliq.a_ori_inferida_simples,
                            "destacada": aliq.a_ori_destacada,
                            "inf_compl": aliq.a_ori_inf_compl,
                            "p_cred_sn": set(),
                        }
                        info_mva_policy[key] = {
                            "grupo": mva_policy_group,
                            "fonte": mva_policy_source,
                            "mva": mva_item,
                        }
                    grupos[key].append(item)
                    resolucoes[key].append(aliq.resolucao)
                    resolucoes_fcp[key].append(aliq.resolucao_fcp)
                    a_dst_bases[key].append(aliq.a_dst_base)
                    resolucoes_cfop[key].append(resolucao_cfop)
                    if not info_mva_policy[key]["grupo"] and mva_policy_group:
                        info_mva_policy[key]["grupo"] = mva_policy_group
                        info_mva_policy[key]["fonte"] = mva_policy_source
                    if aliq.a_ori_limitada:
                        info_a_ori[key]["limitada"] = True
                        info_a_ori[key]["original"] = str(aliq.a_ori_original)
                    if aliq.a_ori_inferida_simples:
                        info_a_ori[key]["inferida_simples"] = True
                    if item.p_cred_sn > 0:
                        info_a_ori[key]["p_cred_sn"].add(str(item.p_cred_sn))

                if not grupos:
                    if retroativa:
                        notas_ignoradas.append(ignored_note(nf_data, filename, motivo_fora_periodo))
                    elif itens_aguardando_entrada:
                        notas_ignoradas.append(
                            ignored_note(nf_data, filename, MOTIVO_DIFAL_AGUARDANDO_ENTRADA)
                        )
                    continue

                if itens_aguardando_entrada:
                    avisos_avaliacao.append({
                        "numero_nota": nf_data.numero_nota,
                        "serie": nf_data.serie,
                        "item_numero": itens_aguardando_entrada[0],
                        "arquivo": filename,
                        "aviso": MOTIVO_DIFAL_AGUARDANDO_ENTRADA,
                    })

                if retroativa and itens_retroativos_pulados:
                    avisos_avaliacao.append({
                        "numero_nota": nf_data.numero_nota,
                        "serie": nf_data.serie,
                        "item_numero": itens_retroativos_pulados[0],
                        "arquivo": filename,
                        "aviso": aviso_difal_retroativa(nf_data),
                    })

                self._consolidar_grupos_nota(
                    solicitacao=solicitacao,
                    empresa=empresa,
                    nf_data=nf_data,
                    filename=filename,
                    uf_fornecedor=uf_fornecedor,
                    is_fornecedor_simples=is_fornecedor_simples,
                    data_entrada_resolvida=data_entrada_resolvida,
                    origem_data=origem_data,
                    grupos=grupos,
                    resolucoes=resolucoes,
                    resolucoes_fcp=resolucoes_fcp,
                    a_dst_bases=a_dst_bases,
                    resolucoes_cfop=resolucoes_cfop,
                    info_a_ori=info_a_ori,
                    info_mva_policy=info_mva_policy,
                    notas_criadas=notas_criadas,
                    notas_ignoradas=notas_ignoradas,
                    erros_validacao=erros_validacao,
                    rows_por_destino=rows_por_destino,
                    fcp_rows_por_destino=fcp_rows_por_destino,
                )

            if raw_ctes:
                processar_ctes(
                    pipeline=self,
                    ctes=raw_ctes,
                    nfe_context_by_chave=nfe_context_by_chave,
                    solicitacao=solicitacao,
                    empresa=empresa,
                    planilha_records=planilha_records,
                    sped_cte_records=sped_cte_records,
                    has_sped=has_sped,
                    modo_legado=modo_legado,
                    notas_criadas=notas_criadas,
                    notas_ignoradas=notas_ignoradas,
                    avisos_avaliacao=avisos_avaliacao,
                    erros_validacao=erros_validacao,
                    rows_por_destino=rows_por_destino,
                    fcp_rows_por_destino=fcp_rows_por_destino,
                )

            if rows_por_destino.get(CONTROLE_IMPOSTO_PAGO_ENTRADA):
                rows_por_destino[CONTROLE_IMPOSTO_PAGO_ENTRADA] = consolidar_linhas_controle(
                    rows_por_destino[CONTROLE_IMPOSTO_PAGO_ENTRADA]
                )

            # A planilha de controle não é apuração: não conta como "há o que recolher".
            total_rows = sum(
                len(v)
                for destino, v in rows_por_destino.items()
                if destino != CONTROLE_IMPOSTO_PAGO_ENTRADA
            )
            if total_rows == 0:
                return self._tratar_sem_linhas_geradas(
                    solicitacao=solicitacao,
                    empresa=empresa,
                    modo_legado=modo_legado,
                    cfops_sem_regra=cfops_sem_regra,
                    erros_validacao=erros_validacao,
                    itens_excluidos=itens_excluidos,
                    notas_ignoradas=notas_ignoradas,
                    avisos_avaliacao=avisos_avaliacao,
                    rows_por_destino=rows_por_destino,
                    sped_empresa_info=sped_empresa_info,
                    generated_artifacts=generated_artifacts,
                )

            # Ordenação cronológica aplicada dentro de cada planilha/destino
            for destino_key in list(rows_por_destino.keys()):
                rows_por_destino[destino_key].sort(key=nfe_sort_key)
            for destino_key in list(fcp_rows_por_destino.keys()):
                fcp_rows_por_destino[destino_key].sort(key=nfe_sort_key)

            # Persistir todas as notas fiscais processadas (a ordem de exibição vem do order_by do relationship)
            for nf_proc in notas_criadas:
                self.db.add(nf_proc)

            ie_final = resolve_inscricao_estadual(empresa, sped_empresa_info)

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
                fcp_rows_by_destination=fcp_rows_por_destino,
            )

            # Atualizar status e resultado da solicitação
            return self.lifecycle.complete(
                solicitacao,
                processed_notes=notas_criadas,
                ignored_notes=notas_ignoradas,
                excluded_items=itens_excluidos,
                evaluation_warnings=avisos_avaliacao,
                missing_cfops=cfops_sem_regra,
            )

        except Exception as exc:
            self.lifecycle.fail(solicitacao, generated_artifacts, exc)
            raise

    @staticmethod
    def _validar_elegibilidade_nota(
        *,
        nf_data: Any,
        filename: str,
        empresa: Empresa,
        solicitacao: Solicitacao,
        notas_ignoradas: List[Dict[str, Any]],
        is_referenced_by_cte: bool = False,
    ) -> Optional[Tuple[bool, str]]:
        if is_emissao_propria(nf_data, empresa.cnpj):
            notas_ignoradas.append(
                ignored_note(
                    nf_data,
                    filename,
                    "Nota fiscal de emissão própria desconsiderada: emitente é a própria empresa.",
                )
            )
            return None

        dentro_do_periodo = SanityChecker.is_within_period(
            nf_data.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim
        )
        if not (is_referenced_by_cte and not dentro_do_periodo):
            SanityChecker.validate_nf_destinatario(nf_data, empresa.cnpj)

        uf_fornecedor = (nf_data.uf_emitente or "").strip().upper()
        uf_empresa_dest = (empresa.uf or "").strip().upper()
        if not SanityChecker.is_interestadual(uf_fornecedor, uf_empresa_dest):
            if not (is_referenced_by_cte and not dentro_do_periodo):
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
            return None

        retroativa = (not dentro_do_periodo) and aceita_difal_retroativa(
            nf_data, empresa.optante_simples_nacional, solicitacao.periodo_inicio
        )
        motivo_fora_periodo = (
            f"Data de emissão ({nf_data.data_emissao.strftime('%d/%m/%Y')}) fora do período informado "
            f"({solicitacao.periodo_inicio.strftime('%d/%m/%Y')} a "
            f"{solicitacao.periodo_fim.strftime('%d/%m/%Y')})."
        )
        if not dentro_do_periodo and not retroativa:
            if not is_referenced_by_cte:
                notas_ignoradas.append(ignored_note(nf_data, filename, motivo_fora_periodo))
            return None
        return retroativa, motivo_fora_periodo

    @staticmethod
    def _resolver_contexto_entrada_nota(
        *,
        nf_data: Any,
        planilha_records: List[Any],
        has_sped: bool,
        modo_legado: bool,
    ) -> Tuple[Optional[Any], Optional[str], bool, Optional[str]]:
        data_entrada_resolvida = None
        origem_data = None
        if planilha_records:
            data_entrada_resolvida, origem_data = DataEntradaMatcher.match_data_entrada(
                nf_chave=nf_data.chave_acesso,
                nf_cnpj_emitente=nf_data.cnpj_emitente,
                nf_serie=nf_data.serie,
                nf_numero=nf_data.numero_nota,
                planilha_records=planilha_records,
            )

        if data_entrada_resolvida is None and nf_data.data_entrada is not None and nf_data.origem_extracao == "sped":
            data_entrada_resolvida = nf_data.data_entrada
            origem_data = "sped_fiscal"

        tem_fonte_entradas = has_sped or bool(planilha_records)
        teve_entrada_comprovada = (nf_data.origem_extracao == "sped") or (data_entrada_resolvida is not None)
        pago_antecipadamente = tem_fonte_entradas and not modo_legado and not teve_entrada_comprovada

        cfop_auxiliar = None
        if planilha_records and (not has_sped or nf_data.origem_extracao != "sped"):
            cfop_auxiliar = DataEntradaMatcher.match_cfop(
                nf_chave=nf_data.chave_acesso,
                nf_cnpj_emitente=nf_data.cnpj_emitente,
                nf_serie=nf_data.serie,
                nf_numero=nf_data.numero_nota,
                planilha_records=planilha_records,
            )
        return data_entrada_resolvida, origem_data, pago_antecipadamente, cfop_auxiliar

    @staticmethod
    def _rotear_destino_pagamento_e_regime(
        *,
        destino_item: str,
        pago_antecipadamente: bool,
        optante_simples: bool,
    ) -> str:
        if destino_item == ANTECIPACAO_PARCIAL and pago_antecipadamente:
            return ANTECIPACAO_PARCIAL_ANTECIPADO
        if destino_item == ANTECIPACAO_TRIBUTARIA and pago_antecipadamente:
            return ANTECIPACAO_TRIBUTARIA_ANTECIPADO
        if destino_item == DIFAL and pago_antecipadamente and optante_simples:
            return DIFAL_ANTECIPADO
        return destino_item

    @staticmethod
    def _compativel_com_modo_legado(destino_item: str, tipo_solicitacao: Optional[str]) -> bool:
        if destino_item == tipo_solicitacao:
            return True
        return (
            (tipo_solicitacao == ANTECIPACAO_PARCIAL and destino_item == ANTECIPACAO_PARCIAL_SIMPLES)
            or (tipo_solicitacao == ANTECIPACAO_PARCIAL_ANTECIPADO and destino_item == ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES)
        )

    def _avaliar_exclusao_parcial_mercadoria(
        self,
        *,
        nf_data: Any,
        item: Any,
        filename: str,
        destino_item: str,
        empresa: Empresa,
        data_entrada_resolvida: Any,
        avisos_avaliacao: List[Dict[str, Any]],
        itens_excluidos: List[Dict[str, Any]],
        rows_por_destino: Dict[str, List[Dict[str, Any]]],
    ) -> bool:
        if not item.descricao_confiavel:
            avisos_avaliacao.append({
                "numero_nota": nf_data.numero_nota,
                "serie": nf_data.serie,
                "item_numero": item.item_numero,
                "arquivo": filename,
                "aviso": "Descrição sintética/não confiável (SPED sem C170): regra de exclusão por mercadoria não avaliada.",
            })
        elif not item.descricao or not normalizar(item.descricao).strip():
            avisos_avaliacao.append({
                "numero_nota": nf_data.numero_nota,
                "serie": nf_data.serie,
                "item_numero": item.item_numero,
                "arquivo": filename,
                "aviso": "Descrição do produto ausente ou vazia: regra de exclusão por mercadoria não avaliada.",
            })
        elif not item.ncm or item.ncm.strip() == NCM_SENTINELA or len(item.ncm.strip()) < 8:
            avisos_avaliacao.append({
                "numero_nota": nf_data.numero_nota,
                "serie": nf_data.serie,
                "item_numero": item.item_numero,
                "arquivo": filename,
                "aviso": f"NCM ausente ou genérico ('{item.ncm}'): regra de exclusão por mercadoria não avaliada.",
            })

        decisao_mercadoria = self.parcial_exclusion.avaliar_mercadoria(
            perfil_regras_id=empresa.perfil_regras_id,
            uf_empresa=empresa.uf,
            destino=destino_item,
            ncm=item.ncm,
            descricao=item.descricao if item.descricao_confiavel else "",
            descricao_confiavel=item.descricao_confiavel,
            v_total=item.v_total,
            base_calculo=item.base_calculo,
            ipi_despesas=item.ipi_despesas,
            a_ori=item.a_ori,
        )
        if not decisao_mercadoria.excluido:
            return False

        itens_excluidos.append(
            serialize_excluded_item(nf_data, item, filename, destino_item, decisao_mercadoria)
        )
        if is_imposto_pago_entrada(decisao_mercadoria):
            try:
                a_dst_controle = self.resolver.resolve_a_dst(
                    perfil_regras_id=empresa.perfil_regras_id,
                    uf=empresa.uf,
                    ncm=item.ncm,
                    descricao=item.descricao if item.descricao_confiavel else None,
                    empresa_id=empresa.id,
                ).aliquota
            except RuleResolutionException:
                a_dst_controle = None
            rows_por_destino[CONTROLE_IMPOSTO_PAGO_ENTRADA].append(
                build_controle_row(
                    nf_data,
                    item,
                    decisao_mercadoria,
                    a_dst_controle,
                    None
                    if destino_item in (ANTECIPACAO_PARCIAL_ANTECIPADO, ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES)
                    else data_entrada_resolvida,
                )
            )
        return True

    def _resolver_aliquotas_item(
        self,
        *,
        nf_data: Any,
        item: Any,
        filename: str,
        destino_item: str,
        empresa: Empresa,
        configuracoes_perfil: Dict[str, Any],
        uf_fornecedor: str,
        uf_empresa_dest: str,
        is_fornecedor_simples: bool,
        is_operacao_interestadual: bool,
        avisos_avaliacao: List[Dict[str, Any]],
    ) -> ResolucaoAliquotasItem:
        is_tributaria = destino_item in DESTINOS_TRIBUTARIA
        empresa_tem_termo_acordo = (
            self.resolver._termo_acordo(empresa.id) is not None
            if getattr(empresa, "id", None) is not None
            else getattr(empresa, "termo_acordo", None) is not None
        )
        try:
            resolucao = self.resolver.resolve_a_dst(
                perfil_regras_id=empresa.perfil_regras_id,
                uf=empresa.uf,
                ncm=item.ncm,
                descricao=item.descricao if item.descricao_confiavel else None,
                empresa_id=empresa.id,
                apenas_padrao_uf=(destino_item in DESTINOS_DIFAL),
                ignorar_termo_acordo=is_tributaria,
                ignorar_reducao_produto=is_tributaria,
            )
            resolucao_red_trib = (
                self.resolver.resolve_reducao_tributaria(
                    perfil_regras_id=empresa.perfil_regras_id,
                    ncm=item.ncm,
                    descricao=item.descricao if item.descricao_confiavel else None,
                )
                if is_tributaria
                else None
            )
            resolucao_fcp = self.resolver.resolve_fcp(
                perfil_regras_id=empresa.perfil_regras_id,
                uf=empresa.uf,
                ncm=item.ncm,
                descricao=item.descricao if item.descricao_confiavel else None,
                empresa_tem_termo_acordo=empresa_tem_termo_acordo,
            )
        except RuleResolutionException as err:
            raise RuleResolutionException(
                f"NF-e {nf_data.numero_nota} (arquivo {filename}): {err.message}"
            ) from err

        # Regras de redução/FCP redundantes (mesmo valor) não param o processamento,
        # mas o cadastro precisa ser unificado: o aviso vai para o resultado.
        for resolucao_com_aviso in (resolucao, resolucao_red_trib, resolucao_fcp):
            if resolucao_com_aviso is not None and resolucao_com_aviso.aviso:
                aviso = resolucao_com_aviso.aviso
                avisos_avaliacao.append({
                    "numero_nota": nf_data.numero_nota,
                    "serie": nf_data.serie,
                    "item_numero": item.item_numero,
                    "arquivo": filename,
                    "aviso": f"Item {item.item_numero}: {aviso[:1].upper()}{aviso[1:]}",
                })

        a_dst_base = resolucao.aliquota
        fcp_aliquota = (
            resolucao_fcp.aliquota if resolucao_fcp is not None else Decimal("0.00")
        )
        is_tributaria_regime_normal = is_tributaria and (not empresa.optante_simples_nacional)
        if fcp_aliquota > Decimal("0.00") and is_tributaria_regime_normal:
            fcp_separado_item: Optional[Decimal] = fcp_aliquota
            a_dst = a_dst_base
        elif fcp_aliquota > Decimal("0.00"):
            fcp_separado_item = None
            a_dst = a_dst_base + fcp_aliquota
        else:
            fcp_separado_item = None
            a_dst = a_dst_base

        reducao_item: Optional[Decimal] = (
            resolucao_red_trib.aliquota if resolucao_red_trib is not None else None
        )
        a_ori = item.a_ori
        a_ori_destacada = bool(a_ori is not None and a_ori > Decimal("0.00"))
        a_ori_inferida_simples = False
        a_ori_original = item.a_ori

        if (
            destino_item not in DESTINOS_DIFAL
            and is_fornecedor_simples
            and is_operacao_interestadual
            and (a_ori is None or a_ori == Decimal("0.00"))
        ):
            a_ori_inferida = InterstateRateResolver.resolve_rate(
                uf_origem=uf_fornecedor,
                uf_destino=uf_empresa_dest,
                origem_mercadoria=item.origem_mercadoria,
            )
            a_ori = a_ori_inferida
            a_ori_inferida_simples = True
            pct_val = a_ori_inferida * Decimal("100.0")
            pct_str = f"{pct_val:.0f}%" if pct_val % 1 == 0 else f"{pct_val:.2f}%"
            avisos_avaliacao.append({
                "numero_nota": nf_data.numero_nota,
                "serie": nf_data.serie,
                "item_numero": item.item_numero,
                "arquivo": filename,
                "aviso": (
                    f"Item {item.item_numero}: Alíquota interestadual de {pct_str} aplicada automaticamente "
                    f"(fornecedor optante pelo Simples Nacional sem pICMS na origem {uf_fornecedor} -> {uf_empresa_dest}). "
                    "Alíquota de referência, não crédito destacado."
                ),
            })

        a_ori_inf_compl = False
        if (
            destino_item in DESTINOS_DIFAL
            and not a_ori_destacada
            and nf_data.aliq_credito_icms_inf_compl
        ):
            a_ori = nf_data.aliq_credito_icms_inf_compl
            a_ori_destacada = True
            a_ori_inf_compl = True
            pct_inf = a_ori * Decimal("100.0")
            avisos_avaliacao.append({
                "numero_nota": nf_data.numero_nota,
                "serie": nf_data.serie,
                "item_numero": item.item_numero,
                "arquivo": filename,
                "aviso": (
                    f"Item {item.item_numero}: A.ORI de {pct_inf:.2f}% obtida das Informações "
                    "Complementares da NF-e (crédito de ICMS autorizado pelo fornecedor), "
                    "sem pICMS destacado no item."
                ),
            })

        if destino_item in DESTINOS_DIFAL and not a_ori_destacada:
            a_ori = Decimal("0.00")

        limitar_a_ori_reducoes = bool(configuracoes_perfil.get("limitar_a_ori_reducoes"))
        origem_resolucao = resolucao.origem or ""
        teve_reducao_ou_acordo = (
            origem_resolucao.startswith("reducao_produto:")
            or origem_resolucao.startswith("excecao:")
            or origem_resolucao.startswith("termo_acordo:")
        )
        a_ori_limitada = False
        if (
            destino_item in DESTINOS_PARCIAL
            and limitar_a_ori_reducoes
            and teve_reducao_ou_acordo
            and a_ori > Decimal("0.10")
        ):
            a_ori = Decimal("0.10")
            a_ori_limitada = True

        return ResolucaoAliquotasItem(
            a_ori=a_ori,
            a_dst=a_dst,
            a_dst_base=a_dst_base,
            resolucao=resolucao,
            resolucao_fcp=resolucao_fcp,
            fcp_separado=fcp_separado_item,
            a_ori_original=a_ori_original,
            a_ori_destacada=a_ori_destacada,
            a_ori_inferida_simples=a_ori_inferida_simples,
            a_ori_inf_compl=a_ori_inf_compl,
            a_ori_limitada=a_ori_limitada,
            reducao_item=reducao_item,
        )

    @staticmethod
    def _resolver_mva_item(
        *,
        nf_data: Any,
        item: Any,
        filename: str,
        destino_item: str,
        a_ori: Decimal,
        a_dst: Decimal,
        a_ori_original: Decimal,
        is_fornecedor_simples: bool,
        coluna_mva_nota: Optional[str],
        revenda_tributaria_config: Any,
        mva_policy_group: str,
        itens_excluidos: List[Dict[str, Any]],
    ) -> Optional[Decimal]:
        if destino_item not in DESTINOS_TRIBUTARIA:
            return Decimal("0.00")
        if revenda_tributaria_config:
            return RevendaAntecipacaoTributariaPolicy.resolve_mva(
                config=revenda_tributaria_config,
                grupo=mva_policy_group or "demais",
                a_ori=a_ori,
                fornecedor_simples=is_fornecedor_simples,
            )
        resultado_mva = MvaResolver.resolver_para_item(
            ncm=item.ncm,
            cest=item.cest,
            a_ori=a_ori_original,
            coluna=coluna_mva_nota,
        )
        if resultado_mva.pendente:
            itens_excluidos.append(
                serialize_excluded_item(
                    nf_data,
                    item,
                    filename,
                    destino_item,
                    DecisaoExclusaoItem(
                        excluido=True,
                        tipo_exclusao=TIPO_EXCLUSAO_MVA_PENDENTE,
                        motivo=resultado_mva.motivo_pendencia,
                        v_total=item.v_total,
                        base_calculo=item.base_calculo,
                        ipi_despesas=item.ipi_despesas,
                        a_ori=a_ori_original,
                        a_dst=a_dst,
                    ),
                )
            )
            return None
        return resultado_mva.mva

    @staticmethod
    def _calcular_fcp_separado(
        *,
        destino: str,
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
        mva: Decimal,
        reducao: Optional[Decimal],
        fcp_aliquota: Decimal,
    ) -> CalculationResult:
        return CalculatorFactory.get_calculator(destino).calculate(
            v_total=v_total,
            base_calculo=base_calculo,
            ipi_despesas=ipi_despesas,
            a_ori=Decimal("0.00"),
            a_dst=fcp_aliquota,
            parametros_extras={
                "mva": mva,
                "reducao": reducao,
                "valor_pago": Decimal("0.00"),
                "is_simples": False,
            },
        )

    @staticmethod
    def _montar_linha_fcp(
        base_row: Dict[str, Any],
        *,
        fcp_aliquota: Decimal,
        fcp_calc: CalculationResult,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        row_fcp = dict(base_row)
        if overrides:
            row_fcp.update(overrides)
        row_fcp.update({
            "a_ori": Decimal("0.00"),
            "a_dst": fcp_aliquota,
            "debito": fcp_calc.debito,
            "credito": Decimal("0.00"),
            "valor_devido": fcp_calc.valor_devido,
            "valor_pago": Decimal("0.00"),
        })
        return row_fcp

    @staticmethod
    def _montar_metadados_fcp(
        *,
        a_dst_base: Decimal,
        fcp_aliquota: Optional[Decimal],
        fcp_origem: Optional[str],
        fcp_detalhe: Optional[str],
        fcp_separado: bool,
        fcp_calc: Optional[CalculationResult] = None,
    ) -> Dict[str, Any]:
        tem_fcp = fcp_aliquota is not None and fcp_aliquota > Decimal("0.00")
        meta: Dict[str, Any] = {
            "a_dst_base": str(a_dst_base),
            "fcp_aliquota": str(fcp_aliquota) if tem_fcp else None,
            "fcp_origem": fcp_origem if tem_fcp else None,
            "fcp_detalhe": fcp_detalhe if tem_fcp else None,
            "fcp_separado": bool(fcp_separado and tem_fcp),
        }
        if meta["fcp_separado"] and fcp_calc is not None:
            meta["fcp_base_st"] = fcp_calc.detalhes["base_st"]
            meta["fcp_valor_devido"] = str(fcp_calc.valor_devido)
        return meta

    def _consolidar_grupos_nota(
        self,
        *,
        solicitacao: Solicitacao,
        empresa: Empresa,
        nf_data: Any,
        filename: str,
        uf_fornecedor: str,
        is_fornecedor_simples: bool,
        data_entrada_resolvida: Any,
        origem_data: Optional[str],
        grupos: Dict[GrupoKey, List[Any]],
        resolucoes: Dict[GrupoKey, List[ResolucaoAliquota]],
        resolucoes_fcp: Dict[GrupoKey, List[Optional[ResolucaoAliquota]]],
        a_dst_bases: Dict[GrupoKey, List[Decimal]],
        resolucoes_cfop: Dict[GrupoKey, List[ResolucaoCfop]],
        info_a_ori: Dict[GrupoKey, Dict[str, Any]],
        info_mva_policy: Dict[GrupoKey, Dict[str, Any]],
        notas_criadas: List[NotaFiscalProcessada],
        notas_ignoradas: List[Dict[str, Any]],
        erros_validacao: List[str],
        rows_por_destino: Dict[str, List[Dict[str, Any]]],
        fcp_rows_por_destino: Dict[str, List[Dict[str, Any]]],
    ) -> None:
        qtd_itens_originais = len(nf_data.itens)
        qtd_itens_classificados = sum(len(v) for v in grupos.values())
        split_index_por_destino: Dict[str, int] = defaultdict(lambda: 1)

        for grupo_key, itens_objs in grupos.items():
            (
                destino_grupo,
                a_ori,
                a_dst,
                mva_grupo,
                reducao_grupo,
                fcp_separado_grupo,
            ) = grupo_key
            split_index = split_index_por_destino[destino_grupo]

            usar_total_nota = (
                len(grupos) == 1
                and qtd_itens_classificados == qtd_itens_originais
                and nf_data.v_total_nota > 0
            )
            if usar_total_nota:
                v_total_grupo = nf_data.v_total_nota
                ipi_despesas_grupo = sum(it.ipi_despesas for it in itens_objs)
                if nf_data.v_bc_nota > 0:
                    max_base_grupo = max(Decimal("0.00"), v_total_grupo - ipi_despesas_grupo)
                    if nf_data.v_desc_nota > 0 and nf_data.v_bc_nota > max_base_grupo:
                        v_bc_grupo = max(Decimal("0.00"), min(nf_data.v_bc_nota - nf_data.v_desc_nota, max_base_grupo))
                    else:
                        v_bc_grupo = nf_data.v_bc_nota
                else:
                    v_bc_grupo = sum(it.base_calculo for it in itens_objs)
            else:
                v_total_grupo = sum(it.v_total for it in itens_objs)
                v_bc_grupo = sum(it.base_calculo for it in itens_objs)
                ipi_despesas_grupo = sum(it.ipi_despesas for it in itens_objs)

            if v_bc_grupo <= Decimal("0.00"):
                v_bc_grupo = v_total_grupo - ipi_despesas_grupo

            ncm_grupo = itens_objs[0].ncm if itens_objs else ""
            cfop_grupo = itens_objs[0].cfop if itens_objs else ""
            descricao_grupo = (
                itens_objs[0].descricao
                if len(itens_objs) == 1
                else f"NF-e {nf_data.numero_nota} ({len(itens_objs)} itens)"
            )

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

            aliq_simples = "S" if (destino_grupo in DESTINOS_DIFAL and is_fornecedor_simples) else "N"

            try:
                calculator = CalculatorFactory.get_calculator(destino_grupo)
                calc_result = calculator.calculate(
                    v_total=v_total_grupo,
                    base_calculo=v_bc_grupo,
                    ipi_despesas=ipi_despesas_grupo,
                    a_ori=a_ori,
                    a_dst=a_dst,
                    parametros_extras={
                        "mva": mva_grupo,
                        "reducao": reducao_grupo,
                        "aliq_simples": aliq_simples,
                        "qtd_itens_grupo": len(itens_objs),
                        "is_simples": empresa.optante_simples_nacional,
                    },
                )
                SanityChecker.validate_numeric_values(
                    numero_nota=nf_data.numero_nota,
                    v_total=v_total_grupo,
                    base_calculo=v_bc_grupo,
                    a_ori=a_ori,
                    a_dst=a_dst,
                    fcp_separado=fcp_separado_grupo,
                )
            except ValidationException as val_err:
                erros_validacao.append(str(val_err))
                notas_ignoradas.append(ignored_note(nf_data, filename, str(val_err)))
                continue

            fcp_calc = (
                self._calcular_fcp_separado(
                    destino=destino_grupo,
                    v_total=v_total_grupo,
                    base_calculo=v_bc_grupo,
                    ipi_despesas=ipi_despesas_grupo,
                    mva=mva_grupo,
                    reducao=reducao_grupo,
                    fcp_aliquota=fcp_separado_grupo,
                )
                if fcp_separado_grupo is not None and fcp_separado_grupo > Decimal("0.00")
                else None
            )
            res_fcp_validas = [
                r for r in resolucoes_fcp.get(grupo_key, [])
                if r is not None and r.aliquota > Decimal("0.00")
            ]
            bases_grupo = a_dst_bases.get(grupo_key, [a_dst])
            if fcp_calc is not None:
                a_dst_base_grupo = bases_grupo[0]
                fcp_aliq_grupo: Optional[Decimal] = fcp_separado_grupo
            elif res_fcp_validas:
                bases_com_fcp = [
                    b for b, r in zip(bases_grupo, resolucoes_fcp.get(grupo_key, []))
                    if r is not None and r.aliquota > Decimal("0.00")
                ]
                a_dst_base_grupo = bases_com_fcp[0] if bases_com_fcp else bases_grupo[0]
                fcp_aliq_grupo = res_fcp_validas[0].aliquota
            else:
                a_dst_base_grupo = bases_grupo[0]
                fcp_aliq_grupo = None

            fcp_meta = self._montar_metadados_fcp(
                a_dst_base=a_dst_base_grupo,
                fcp_aliquota=fcp_aliq_grupo,
                fcp_origem="; ".join(sorted({r.origem for r in res_fcp_validas})) or None,
                fcp_detalhe="; ".join(sorted({r.detalhe for r in res_fcp_validas})) or None,
                fcp_separado=fcp_calc is not None,
                fcp_calc=fcp_calc,
            )

            is_antecipado = destino_grupo in DESTINOS_ANTECIPADOS
            data_entrada_efetiva = None if is_antecipado else data_entrada_resolvida
            origem_data_efetiva = None if is_antecipado else origem_data

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
                    "reducao": str(reducao_grupo) if reducao_grupo is not None else None,
                    "mva_grupo": info_mva_policy.get(grupo_key, {}).get("grupo") or None,
                    "mva_fonte": info_mva_policy.get(grupo_key, {}).get("fonte") or None,
                    "fornecedor_simples_nacional": is_fornecedor_simples,
                    "aliq_simples": aliq_simples,
                    "origem_a_dst": sorted({r.origem for r in resolucoes.get(grupo_key, [])}),
                    "detalhe_a_dst": "; ".join(sorted({r.detalhe for r in resolucoes.get(grupo_key, [])})),
                    "cfop_reclassificado": any(rc.reclassificado for rc in resolucoes_cfop.get(grupo_key, [])),
                    "detalhe_cfop": "; ".join(
                        sorted({rc.motivo for rc in resolucoes_cfop.get(grupo_key, []) if rc.motivo})
                    ),
                    "a_ori_limitada": info_a_ori.get(grupo_key, {}).get("limitada", False),
                    "a_ori_original": info_a_ori.get(grupo_key, {}).get("original", str(a_ori)),
                    "a_ori_inferida_simples": info_a_ori.get(grupo_key, {}).get("inferida_simples", False),
                    "a_ori_destacada": info_a_ori.get(grupo_key, {}).get("destacada", True),
                    "a_ori_inf_compl": info_a_ori.get(grupo_key, {}).get("inf_compl", False),
                    "p_cred_sn": sorted(info_a_ori.get(grupo_key, {}).get("p_cred_sn", set())) or None,
                    **calc_result.detalhes,
                    **fcp_meta,
                },
            )
            notas_criadas.append(nf_proc)

            numero_nota_planilha = f"{nf_data.numero_nota}*" if split_index > 1 else nf_data.numero_nota
            a_ori_planilha = (
                None
                if destino_grupo in DESTINOS_DIFAL and not info_a_ori.get(grupo_key, {}).get("destacada", True)
                else a_ori
            )
            row_principal = {
                "numero_nota": numero_nota_planilha,
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
                "reducao": reducao_grupo,
                "red": "",
                "aliq_simples": aliq_simples,
                "a_ori": a_ori_planilha,
                "a_dst": a_dst,
                "debito": calc_result.debito,
                "credito": calc_result.credito,
                "valor_devido": calc_result.valor_devido,
            }
            rows_por_destino[destino_grupo].append(row_principal)
            if fcp_calc is not None and fcp_separado_grupo is not None:
                fcp_rows_por_destino[destino_grupo].append(
                    self._montar_linha_fcp(
                        row_principal,
                        fcp_aliquota=fcp_separado_grupo,
                        fcp_calc=fcp_calc,
                    )
                )
            split_index_por_destino[destino_grupo] = split_index + 1

    def _tratar_sem_linhas_geradas(
        self,
        *,
        solicitacao: Solicitacao,
        empresa: Empresa,
        modo_legado: bool,
        cfops_sem_regra: Dict[str, int],
        erros_validacao: List[str],
        itens_excluidos: List[Dict[str, Any]],
        notas_ignoradas: List[Dict[str, Any]],
        avisos_avaliacao: List[Dict[str, Any]],
        rows_por_destino: Dict[str, List[Dict[str, Any]]],
        sped_empresa_info: Optional[Dict[str, Any]],
        generated_artifacts: GeneratedArtifacts,
    ) -> Solicitacao:
        if cfops_sem_regra:
            raise ValidationException(
                "Nenhum item das notas enviadas correspondeu a um CFOP com regra de roteamento cadastrada "
                f"({', '.join(sorted(cfops_sem_regra.keys()))}). Cadastre as regras de CFOP em "
                "'Perfis e Regras' antes de processar."
            )

        if erros_validacao:
            raise ValidationException(erros_validacao[0])

        if itens_excluidos:
            if not modo_legado and rows_por_destino.get(CONTROLE_IMPOSTO_PAGO_ENTRADA):
                controle_artifacts = self._gerar_somente_controle(
                    solicitacao=solicitacao,
                    empresa=empresa,
                    rows=rows_por_destino[CONTROLE_IMPOSTO_PAGO_ENTRADA],
                    sped_empresa_info=sped_empresa_info,
                )
                generated_artifacts.local_paths.extend(controle_artifacts.local_paths)
                generated_artifacts.cloud_names.extend(controle_artifacts.cloud_names)
            return self.lifecycle.complete_without_output(
                solicitacao,
                ignored_notes=notas_ignoradas,
                excluded_items=itens_excluidos,
                evaluation_warnings=avisos_avaliacao,
                message=no_output_message(itens_excluidos),
            )

        if any("não destinada para revenda pelo usuário" in str(n.get("motivo", "")) for n in notas_ignoradas):
            return self.lifecycle.complete_without_output(
                solicitacao,
                ignored_notes=notas_ignoradas,
                excluded_items=itens_excluidos,
                evaluation_warnings=avisos_avaliacao,
                message="Nenhum item a recolher na Parcial (mercadoria em bonificação/amostra grátis não destinada para revenda)",
            )

        total_ign = len(notas_ignoradas)
        p_ini_str = solicitacao.periodo_inicio.strftime('%d/%m/%Y')
        p_fim_str = solicitacao.periodo_fim.strftime('%d/%m/%Y')
        cte_faltante = next(
            (n for n in notas_ignoradas if "NF-e(s) originária(s) não localizada(s)" in str(n.get("motivo", ""))),
            None,
        )
        if cte_faltante is not None:
            raise ValidationException(
                f"Nenhum documento gerou apuração. {cte_faltante.get('motivo')}"
            )
        if total_ign > 0:
            raise ValidationException(
                f"Nenhuma NF-e válida para apuração interestadual encontrada dentro do período informado ({p_ini_str} a {p_fim_str}). "
                f"Todas as {total_ign} nota(s) enviadas foram desconsideradas (motivos registrados no relatório de conferência)."
            )
        raise ValidationException("Nenhuma nota fiscal pôde ser processada a partir dos arquivos fornecidos.")

    def _gerar_somente_controle(
        self,
        *,
        solicitacao: Solicitacao,
        empresa: Empresa,
        rows: List[Dict[str, Any]],
        sped_empresa_info: Optional[Dict[str, Any]],
    ) -> GeneratedArtifacts:
        """Nada a recolher, mas há itens de controle: gera só a planilha de controle.

        Sem template ativo do tipo, a solicitação continua concluída (o aviso fica
        no registro de saída): o controle é auxiliar e nunca deve virar erro.
        """
        rows = sorted(rows, key=nfe_sort_key)
        ie = resolve_inscricao_estadual(empresa, sped_empresa_info)
        try:
            return self.output_service.generate(
                solicitacao=solicitacao,
                empresa=empresa,
                rows_by_destination={CONTROLE_IMPOSTO_PAGO_ENTRADA: rows},
                legacy_mode=False,
                legacy_template=None,
                header_info=build_header_info(empresa, solicitacao.periodo_inicio, ie),
            )
        except ValidationException:
            return GeneratedArtifacts()
