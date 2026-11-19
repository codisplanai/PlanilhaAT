"""Avaliação de NF-es originárias e apuração/rateio de CT-e para Tributária e DIFAL."""

from collections import defaultdict
import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set, Tuple

from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
    ANTECIPACAO_PARCIAL_SIMPLES,
    ANTECIPACAO_TRIBUTARIA,
    DESTINOS_ANTECIPADOS,
    DESTINOS_DIFAL,
    DESTINOS_TRIBUTARIA,
    DIFAL,
)
from app.core.exceptions import ValidationException
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.solicitacao import Solicitacao
from app.services.calculation.base import round_currency
from app.services.calculation.factory import CalculatorFactory
from app.services.extraction.base import (
    ExtractedCTeData,
    ExtractedNFData,
    extrair_numero_serie_chave_nfe,
)
from app.services.extraction.data_entrada_matcher import (
    DataEntradaMatcher,
    PlanilhaEntradaRecord,
)
from app.services.pipeline_analysis import (
    CFOP_SUFFIXES_REQUIRING_DESTINATION,
    _nfe_disponivel_para_cte,
)
from app.services.pipeline_helpers import is_cfop_uso_consumo_ativo
from app.services.rules_engine.mva_resolver import MvaResolver
from app.services.rules_engine.parcial_decision import DESTINOS_PARCIAL
from app.services.rules_engine.st_tributaria_exclusion import should_exclude_st_item_from_tributaria
from app.services.rules_engine.revenda_antecipacao_policy import RevendaAntecipacaoTributariaPolicy
from app.services.validation.sanity_checker import SanityChecker


def _clean_digits(value: Optional[str]) -> str:
    return re.sub(r"\D", "", value or "")


def get_eligible_cte_nfe_keys(
    ctes: List[Tuple[str, ExtractedCTeData]],
    empresa: Empresa,
    solicitacao: Solicitacao,
) -> Set[str]:
    empresa_cnpj = _clean_digits(empresa.cnpj)
    if not empresa_cnpj:
        return set()
    keys: Set[str] = set()
    for _filename, cte in ctes:
        if _clean_digits(cte.cnpj_tomador) != empresa_cnpj or not cte.data_emissao:
            continue
        if not SanityChecker.is_interestadual(cte.uf_emitente, empresa.uf):
            continue
        if SanityChecker.is_within_period(
            cte.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim
        ):
            keys.update(cte.chaves_nfe)
    return keys


def avaliar_nfe_para_cte(
    *,
    pipeline: Any,
    nf_data: ExtractedNFData,
    filename: str,
    empresa: Empresa,
    planilha_records: List[PlanilhaEntradaRecord],
    has_sped: bool,
    modo_legado: bool,
    configuracoes_perfil: Dict[str, Any],
    revenda_tributaria_config: Any,
    is_industria: bool,
    decisoes_bonificacao: Optional[Dict[str, bool]],
) -> Dict[str, Any]:
    """Classifica os itens de uma NF-e originária em modo consulta para rateio de CT-e."""
    data_entrada_resolvida, origem_data, pago_antecipadamente, cfop_auxiliar = (
        pipeline._resolver_contexto_entrada_nota(
            nf_data=nf_data,
            planilha_records=planilha_records,
            has_sped=has_sped,
            modo_legado=modo_legado,
        )
    )
    confirmed_entry = (nf_data.origem_extracao == "sped") or (data_entrada_resolvida is not None)
    v_total_nota = (
        nf_data.v_total_nota
        if nf_data.v_total_nota > Decimal("0.00")
        else sum((it.v_total for it in nf_data.itens), Decimal("0.00"))
    )

    uf_fornecedor = (nf_data.uf_emitente or "").strip().upper()
    uf_empresa_dest = (empresa.uf or "").strip().upper()
    is_operacao_interestadual = bool(
        uf_fornecedor and uf_empresa_dest and uf_fornecedor != uf_empresa_dest
    )
    if not SanityChecker.is_interestadual(uf_fornecedor, uf_empresa_dest):
        return {
            "chave_acesso": _clean_digits(nf_data.chave_acesso),
            "numero_nota": nf_data.numero_nota,
            "v_total_nota": v_total_nota,
            "data_entrada": data_entrada_resolvida,
            "origem_data": origem_data,
            "confirmed_entry": confirmed_entry,
            "pago_antecipadamente": pago_antecipadamente,
            "soma_trib": Decimal("0.00"),
            "soma_difal": Decimal("0.00"),
            "trib_candidates": [],
            "todos_itens_tributaria": False,
            "todos_itens_difal": False,
        }

    crt_fornecedor = (nf_data.raw_metadata.get("crt") or "").strip()
    evidencia_csosn = (
        bool(nf_data.raw_metadata.get("fornecedor_simples_nacional"))
        or any(bool(it.csosn) for it in nf_data.itens)
    )
    is_fornecedor_simples = crt_fornecedor in ("1", "2", "4") or evidencia_csosn
    coluna_mva_nota = MvaResolver.coluna_por_regime(
        crt_fornecedor,
        evidencia_csosn=evidencia_csosn,
    )

    soma_trib = Decimal("0.00")
    soma_difal = Decimal("0.00")
    trib_candidates: List[Dict[str, Any]] = []
    count_trib = 0
    count_difal = 0
    has_other_or_excluded = False

    for orig_item in nf_data.itens:
        item = orig_item.copy(deep=True)
        bonificacao_uso_consumo = False
        mva_policy_group = ""
        mva_policy_source = ""
        if cfop_auxiliar and is_cfop_uso_consumo_ativo(cfop_auxiliar):
            item.cfop = cfop_auxiliar

        resolucao_cfop = pipeline.cfop_resolver.reclassificar_cfop(
            perfil_regras_id=empresa.perfil_regras_id,
            ncm=item.ncm,
            descricao=item.descricao if item.descricao_confiavel else None,
            cfop_original=item.cfop,
        )
        destino_item = resolucao_cfop.destino
        if is_cfop_uso_consumo_ativo(item.cfop):
            destino_item = DIFAL

        sufixo_item = _clean_digits(item.cfop)[-3:]
        if sufixo_item in CFOP_SUFFIXES_REQUIRING_DESTINATION and decisoes_bonificacao is not None:
            is_revenda = None
            if nf_data.chave_acesso and nf_data.chave_acesso in decisoes_bonificacao:
                is_revenda = decisoes_bonificacao[nf_data.chave_acesso]
            elif nf_data.numero_nota and str(nf_data.numero_nota) in decisoes_bonificacao:
                is_revenda = decisoes_bonificacao[str(nf_data.numero_nota)]

            if is_revenda is True and is_industria:
                has_other_or_excluded = True
                continue
            if is_revenda is not None:
                if is_revenda:
                    destino_item = ANTECIPACAO_PARCIAL
                else:
                    destino_item = DIFAL
                    bonificacao_uso_consumo = True

        if destino_item is None:
            has_other_or_excluded = True
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

        destino_item = pipeline._rotear_destino_pagamento_e_regime(
            destino_item=destino_item,
            pago_antecipadamente=pago_antecipadamente,
            optante_simples=empresa.optante_simples_nacional,
        )
        if destino_item == DIFAL and pago_antecipadamente and bonificacao_uso_consumo:
            has_other_or_excluded = True
            continue

        if empresa.optante_simples_nacional:
            if destino_item == ANTECIPACAO_PARCIAL:
                destino_item = ANTECIPACAO_PARCIAL_SIMPLES
            elif destino_item == ANTECIPACAO_PARCIAL_ANTECIPADO:
                destino_item = ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES

        if is_industria and destino_item not in DESTINOS_DIFAL:
            has_other_or_excluded = True
            continue

        if destino_item in DESTINOS_PARCIAL:
            has_other_or_excluded = True
            continue

        # Excluir do rateio da Tributária a parcela de CT-e vinculada a
        # mercadorias já tributadas na origem; o denominador é a NF-e inteira.
        if destino_item in DESTINOS_TRIBUTARIA and should_exclude_st_item_from_tributaria(
            empresa.razao_social, nf_data, orig_item
        ):
            has_other_or_excluded = True
            continue

        if destino_item in DESTINOS_TRIBUTARIA:
            aliq = pipeline._resolver_aliquotas_item(
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
                avisos_avaliacao=[],
            )
            mva_item = pipeline._resolver_mva_item(
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
                itens_excluidos=[],
            )
            if mva_item is None:
                has_other_or_excluded = True
                continue
            fcp_aliquota = (
                aliq.resolucao_fcp.aliquota
                if aliq.resolucao_fcp is not None
                else Decimal("0.00")
            )
            tem_fcp = fcp_aliquota > Decimal("0.00")
            soma_trib += item.v_total
            count_trib += 1
            trib_candidates.append(
                {
                    "mva": mva_item,
                    "reducao": aliq.reducao_item,
                    "a_dst": aliq.a_dst,
                    "v_total": item.v_total,
                    "fcp": fcp_aliquota,
                    "fcp_origem": (
                        aliq.resolucao_fcp.origem
                        if tem_fcp and aliq.resolucao_fcp is not None
                        else None
                    ),
                    "fcp_detalhe": (
                        aliq.resolucao_fcp.detalhe
                        if tem_fcp and aliq.resolucao_fcp is not None
                        else None
                    ),
                    "mva_grupo": mva_policy_group,
                    "mva_fonte": mva_policy_source,
                }
            )
        elif destino_item in DESTINOS_DIFAL:
            soma_difal += item.v_total
            count_difal += 1
        else:
            has_other_or_excluded = True

    total_itens = len(nf_data.itens)
    return {
        "chave_acesso": _clean_digits(nf_data.chave_acesso),
        "numero_nota": nf_data.numero_nota,
        "v_total_nota": v_total_nota,
        "data_entrada": data_entrada_resolvida,
        "origem_data": origem_data,
        "confirmed_entry": confirmed_entry,
        "pago_antecipadamente": pago_antecipadamente,
        "soma_trib": soma_trib,
        "soma_difal": soma_difal,
        "trib_candidates": trib_candidates,
        "todos_itens_tributaria": (
            total_itens > 0 and count_trib == total_itens and not has_other_or_excluded and count_difal == 0
        ),
        "todos_itens_difal": (
            total_itens > 0 and count_difal == total_itens and not has_other_or_excluded and count_trib == 0
        ),
    }


def _cte_ignored_record(cte: ExtractedCTeData, filename: str, motivo: str) -> Dict[str, Any]:
    return {
        "numero_nota": cte.numero_cte or "Não identificado",
        "serie": cte.serie or None,
        "chave_acesso": cte.chave_acesso or None,
        "data_emissao": cte.data_emissao.strftime("%d/%m/%Y") if cte.data_emissao else None,
        "motivo": motivo,
        "arquivo": filename,
    }


def _ratear_base_calculo_cte(
    cte: ExtractedCTeData,
    v_total_rateado: Decimal,
    ratio: Decimal,
    *,
    full_scope: bool,
) -> Decimal:
    if cte.v_bc_cte > Decimal("0.00") and cte.v_bc_cte < cte.v_total_cte:
        return cte.v_bc_cte if full_scope else round_currency(cte.v_bc_cte * ratio)
    return v_total_rateado


def _max_mva_e_reducao(
    candidates: List[Dict[str, Any]],
) -> Tuple[Decimal, List[Dict[str, Any]], Optional[Decimal]]:
    max_mva = max(cand["mva"] for cand in candidates)
    max_candidates = [cand for cand in candidates if cand["mva"] == max_mva]
    return max_mva, max_candidates, max_candidates[0]["reducao"]


def _juntar_campo_fcp(candidates: List[Dict[str, Any]], field: str) -> Optional[str]:
    valores = sorted({cand[field] for cand in candidates if cand.get(field)})
    return "; ".join(valores) or None


def _emitir_linha_cte(
    *,
    pipeline: Any,
    solicitacao: Solicitacao,
    empresa: Empresa,
    cte: ExtractedCTeData,
    filename: str,
    destino_final: str,
    v_total: Decimal,
    base_calculo: Decimal,
    mva: Decimal,
    reducao: Optional[Decimal],
    a_dst: Decimal,
    aliq_simples: str,
    data_entrada: Any,
    origem_data: Optional[str],
    percentual_rateio: Decimal,
    numeros_nfe_origem: List[str],
    mva_grupo: Optional[str],
    mva_fonte: Optional[str],
    notas_criadas: List[NotaFiscalProcessada],
    notas_ignoradas: List[Dict[str, Any]],
    erros_validacao: List[str],
    rows_por_destino: Dict[str, List[Dict[str, Any]]],
    item_numero: int = 1,
    desdobramento: bool = False,
    fcp_metadados: Optional[Dict[str, Any]] = None,
    fcp_rows_data: Optional[List[Dict[str, Any]]] = None,
    fcp_rows_por_destino: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> None:
    a_ori_calc = cte.a_ori if cte.a_ori_destacada else Decimal("0.00")
    try:
        calculator = CalculatorFactory.get_calculator(destino_final)
        calc_result = calculator.calculate(
            v_total=v_total,
            base_calculo=base_calculo,
            ipi_despesas=Decimal("0.00"),
            a_ori=a_ori_calc,
            a_dst=a_dst,
            parametros_extras={
                "mva": mva,
                "reducao": reducao,
                "aliq_simples": aliq_simples,
                "is_simples": empresa.optante_simples_nacional,
            },
        )
        SanityChecker.validate_numeric_values(
            numero_nota=cte.numero_cte,
            v_total=v_total,
            base_calculo=base_calculo,
            a_ori=a_ori_calc,
            a_dst=a_dst,
        )
        for fcp_item in (fcp_rows_data or []):
            SanityChecker.validate_numeric_values(
                numero_nota=cte.numero_cte,
                v_total=fcp_item["v_total"],
                base_calculo=fcp_item["base_calculo"],
                a_ori=Decimal("0.00"),
                a_dst=a_dst,
                fcp_separado=fcp_item["fcp_aliquota"],
            )
    except ValidationException as val_err:
        erros_validacao.append(str(val_err))
        notas_ignoradas.append(_cte_ignored_record(cte, filename, str(val_err)))
        return

    is_antecipado = destino_final in DESTINOS_ANTECIPADOS
    data_entrada_efetiva = None if is_antecipado else data_entrada
    origem_data_efetiva = None if is_antecipado else origem_data
    cnpj_tomador = _clean_digits(cte.cnpj_tomador) or _clean_digits(empresa.cnpj)
    numero_nota_planilha = f"{cte.numero_cte}*" if item_numero > 1 else cte.numero_cte

    notas_criadas.append(
        NotaFiscalProcessada(
            solicitacao_id=solicitacao.id,
            chave_acesso=cte.chave_acesso,
            numero_nota=cte.numero_cte,
            serie=cte.serie,
            cnpj_emitente=cte.cnpj_emitente,
            uf_emitente=cte.uf_emitente,
            cnpj_destinatario=cnpj_tomador,
            uf_destinatario=empresa.uf,
            data_emissao=cte.data_emissao,
            data_entrada=data_entrada_efetiva,
            origem_data_entrada=origem_data_efetiva,
            item_numero=item_numero,
            ncm="",
            cfop=(cte.cfop or "")[:4] or None,
            destino_planilha=destino_final,
            v_total=v_total,
            base_calculo=base_calculo,
            ipi_despesas=Decimal("0.00"),
            a_ori=a_ori_calc,
            a_dst_resolvida=a_dst,
            debito=calc_result.debito,
            credito=calc_result.credito,
            valor_devido=calc_result.valor_devido,
            metadados_extras={
                "tipo_documento": "cte",
                "desdobramento": desdobramento,
                "subitem_index": item_numero,
                "chaves_nfe_origem": list(cte.chaves_nfe),
                "numeros_nfe_origem": numeros_nfe_origem,
                "percentual_rateio": str(percentual_rateio),
                "mva": str(mva),
                "reducao": str(reducao) if reducao is not None else None,
                "mva_grupo": mva_grupo,
                "mva_fonte": mva_fonte,
                "fornecedor_simples_nacional": cte.fornecedor_simples_nacional,
                "aliq_simples": aliq_simples,
                "a_ori_destacada": cte.a_ori_destacada,
                **calc_result.detalhes,
                **(fcp_metadados or {}),
            },
        )
    )

    row_principal = {
        "numero_nota": numero_nota_planilha,
        "serie": cte.serie,
        "chave_acesso": cte.chave_acesso,
        "cnpj_emitente": cte.cnpj_emitente,
        "uf_emitente": cte.uf_emitente,
        "cnpj_destinatario": cnpj_tomador,
        "uf_destinatario": empresa.uf,
        "data_emissao": cte.data_emissao,
        "data_entrada": data_entrada_efetiva,
        "item_numero": item_numero,
        "descricao": f"CT-e {cte.numero_cte} ({cte.nome_emitente or 'Frete'})",
        "ncm": "",
        "cfop": cte.cfop,
        "v_total": v_total,
        "base_calculo": base_calculo,
        "ipi_despesas": Decimal("0.00"),
        "mva": mva,
        "reducao": reducao,
        "red": "",
        "aliq_simples": aliq_simples,
        "a_ori": cte.a_ori if cte.a_ori_destacada else None,
        "a_dst": a_dst,
        "debito": calc_result.debito,
        "credito": calc_result.credito,
        "valor_devido": calc_result.valor_devido,
    }
    rows_por_destino[destino_final].append(row_principal)

    if fcp_rows_data and fcp_rows_por_destino is not None:
        total_parcelas = len(fcp_rows_data)
        for idx, fcp_item in enumerate(fcp_rows_data, start=1):
            fcp_rows_por_destino[destino_final].append(
                pipeline._montar_linha_fcp(
                    row_principal,
                    fcp_aliquota=fcp_item["fcp_aliquota"],
                    fcp_calc=fcp_item["fcp_calc"],
                    overrides={
                        "numero_nota": cte.numero_cte,
                        "item_numero": idx if total_parcelas > 1 else 1,
                        "v_total": fcp_item["v_total"],
                        "base_calculo": fcp_item["base_calculo"],
                        "mva": fcp_item["mva"],
                        "reducao": fcp_item["reducao"],
                    },
                )
            )


def _processar_cte_tributaria(
    *,
    pipeline: Any,
    solicitacao: Solicitacao,
    empresa: Empresa,
    cte: ExtractedCTeData,
    filename: str,
    nfes_ctx: List[Dict[str, Any]],
    contributing_trib: List[Dict[str, Any]],
    destino_trib: str,
    v_total_nfes: Decimal,
    soma_trib: Decimal,
    data_ent_trib: Any,
    orig_ent_trib: Optional[str],
    numeros_origem: List[str],
    notas_criadas: List[NotaFiscalProcessada],
    notas_ignoradas: List[Dict[str, Any]],
    erros_validacao: List[str],
    rows_por_destino: Dict[str, List[Dict[str, Any]]],
    fcp_rows_por_destino: Dict[str, List[Dict[str, Any]]],
) -> None:
    all_trib = all(ctx["todos_itens_tributaria"] for ctx in nfes_ctx)
    if all_trib:
        ratio_trib = Decimal("1")
        v_total_cte_trib = cte.v_total_cte
    else:
        ratio_trib = min(Decimal("1"), soma_trib / v_total_nfes)
        v_total_cte_trib = round_currency(cte.v_total_cte * ratio_trib)

    if v_total_cte_trib <= Decimal("0.00"):
        return

    v_bc_cte_trib = _ratear_base_calculo_cte(
        cte, v_total_cte_trib, ratio_trib, full_scope=all_trib
    )
    all_candidates = [
        cand
        for ctx in contributing_trib
        for cand in ctx["trib_candidates"]
    ]
    res_a_dst_trib = pipeline.resolver.resolve_a_dst(
        perfil_regras_id=empresa.perfil_regras_id,
        uf=empresa.uf,
        ncm=None,
        empresa_id=empresa.id,
        ignorar_termo_acordo=True,
        ignorar_reducao_produto=True,
    )
    a_dst_padrao = res_a_dst_trib.aliquota
    percentual_trib = (ratio_trib * Decimal("100.00")).quantize(Decimal("0.0001"))

    if empresa.optante_simples_nacional:
        sn_groups: Dict[Decimal, List[Dict[str, Any]]] = {}
        for cand in all_candidates:
            fcp_val = cand.get("fcp") or Decimal("0.00")
            sn_groups.setdefault(fcp_val, []).append(cand)

        is_split = len(sn_groups) > 1
        emitted_idx = 0
        for fcp_grupo, cands_grupo in sn_groups.items():
            if not is_split:
                v_total_grupo = v_total_cte_trib
                v_bc_grupo = v_bc_cte_trib
                percentual_grupo = percentual_trib
            else:
                soma_grupo = sum((c["v_total"] for c in cands_grupo), Decimal("0.00"))
                ratio_grupo = min(Decimal("1"), soma_grupo / v_total_nfes)
                v_total_grupo = round_currency(cte.v_total_cte * ratio_grupo)
                if v_total_grupo <= Decimal("0.00"):
                    continue
                v_bc_grupo = _ratear_base_calculo_cte(
                    cte, v_total_grupo, ratio_grupo, full_scope=False
                )
                percentual_grupo = (ratio_grupo * Decimal("100.00")).quantize(Decimal("0.0001"))

            max_mva_g, max_cands_g, reducao_g = _max_mva_e_reducao(cands_grupo)
            tem_fcp = fcp_grupo > Decimal("0.00")
            a_dst_total = a_dst_padrao + fcp_grupo if tem_fcp else a_dst_padrao
            emitted_idx += 1
            fcp_meta = pipeline._montar_metadados_fcp(
                a_dst_base=a_dst_padrao,
                fcp_aliquota=fcp_grupo if tem_fcp else None,
                fcp_origem=_juntar_campo_fcp(cands_grupo, "fcp_origem") if tem_fcp else None,
                fcp_detalhe=_juntar_campo_fcp(cands_grupo, "fcp_detalhe") if tem_fcp else None,
                fcp_separado=False,
            )
            _emitir_linha_cte(
                pipeline=pipeline,
                solicitacao=solicitacao,
                empresa=empresa,
                cte=cte,
                filename=filename,
                destino_final=destino_trib,
                v_total=v_total_grupo,
                base_calculo=v_bc_grupo,
                mva=max_mva_g,
                reducao=reducao_g,
                a_dst=a_dst_total,
                aliq_simples="N",
                data_entrada=data_ent_trib,
                origem_data=orig_ent_trib,
                percentual_rateio=percentual_grupo,
                numeros_nfe_origem=numeros_origem,
                mva_grupo=max_cands_g[0].get("mva_grupo") or None,
                mva_fonte=max_cands_g[0].get("mva_fonte") or None,
                notas_criadas=notas_criadas,
                notas_ignoradas=notas_ignoradas,
                erros_validacao=erros_validacao,
                rows_por_destino=rows_por_destino,
                item_numero=emitted_idx,
                desdobramento=is_split,
                fcp_metadados=fcp_meta,
            )
        return

    max_mva, max_candidates, reducao_trib = _max_mva_e_reducao(all_candidates)
    fcp_groups: Dict[Decimal, List[Dict[str, Any]]] = {}
    for cand in all_candidates:
        fcp_val = cand.get("fcp") or Decimal("0.00")
        if fcp_val > Decimal("0.00"):
            fcp_groups.setdefault(fcp_val, []).append(cand)

    fcp_rows_data: List[Dict[str, Any]] = []
    for fcp_aliq, cands_fcp in fcp_groups.items():
        soma_fcp = sum((c["v_total"] for c in cands_fcp), Decimal("0.00"))
        all_same_fcp = all_trib and len(cands_fcp) == len(all_candidates)
        if all_same_fcp:
            ratio_fcp = Decimal("1")
            v_total_cte_fcp = cte.v_total_cte
        else:
            ratio_fcp = min(Decimal("1"), soma_fcp / v_total_nfes)
            v_total_cte_fcp = round_currency(cte.v_total_cte * ratio_fcp)

        if v_total_cte_fcp <= Decimal("0.00"):
            continue

        v_bc_cte_fcp = _ratear_base_calculo_cte(
            cte, v_total_cte_fcp, ratio_fcp, full_scope=all_same_fcp
        )
        max_mva_fcp, _max_cands_fcp, reducao_fcp = _max_mva_e_reducao(cands_fcp)
        fcp_calc = pipeline._calcular_fcp_separado(
            destino=destino_trib,
            v_total=v_total_cte_fcp,
            base_calculo=v_bc_cte_fcp,
            ipi_despesas=Decimal("0.00"),
            mva=max_mva_fcp,
            reducao=reducao_fcp,
            fcp_aliquota=fcp_aliq,
        )
        fcp_rows_data.append({
            "v_total": v_total_cte_fcp,
            "base_calculo": v_bc_cte_fcp,
            "mva": max_mva_fcp,
            "reducao": reducao_fcp,
            "fcp_aliquota": fcp_aliq,
            "fcp_calc": fcp_calc,
            "percentual_rateio": (ratio_fcp * Decimal("100.00")).quantize(Decimal("0.0001")),
            "fcp_origem": _juntar_campo_fcp(cands_fcp, "fcp_origem"),
            "fcp_detalhe": _juntar_campo_fcp(cands_fcp, "fcp_detalhe"),
        })

    if not fcp_rows_data:
        fcp_meta = pipeline._montar_metadados_fcp(
            a_dst_base=a_dst_padrao,
            fcp_aliquota=None,
            fcp_origem=None,
            fcp_detalhe=None,
            fcp_separado=False,
        )
    elif len(fcp_rows_data) == 1:
        it0 = fcp_rows_data[0]
        fcp_meta = pipeline._montar_metadados_fcp(
            a_dst_base=a_dst_padrao,
            fcp_aliquota=it0["fcp_aliquota"],
            fcp_origem=it0["fcp_origem"],
            fcp_detalhe=it0["fcp_detalhe"],
            fcp_separado=True,
            fcp_calc=it0["fcp_calc"],
        )
        fcp_meta.update({
            "fcp_cte_v_total": str(it0["v_total"]),
            "fcp_cte_mva": str(it0["mva"]),
            "fcp_cte_reducao": str(it0["reducao"]) if it0["reducao"] is not None else None,
            "fcp_percentual_rateio": str(it0["percentual_rateio"]),
        })
    else:
        fcp_meta = {
            "a_dst_base": str(a_dst_padrao),
            "fcp_separado": True,
            "fcp_parcelas": [
                {
                    "v_total": str(it["v_total"]),
                    "base_calculo": str(it["base_calculo"]),
                    "mva": str(it["mva"]),
                    "reducao": str(it["reducao"]) if it["reducao"] is not None else None,
                    "fcp_aliquota": str(it["fcp_aliquota"]),
                    "fcp_base_st": it["fcp_calc"].detalhes["base_st"],
                    "debito": str(it["fcp_calc"].debito),
                    "fcp_valor_devido": str(it["fcp_calc"].valor_devido),
                    "percentual_rateio": str(it["percentual_rateio"]),
                    "fcp_origem": it["fcp_origem"],
                    "fcp_detalhe": it["fcp_detalhe"],
                }
                for it in fcp_rows_data
            ],
        }

    _emitir_linha_cte(
        pipeline=pipeline,
        solicitacao=solicitacao,
        empresa=empresa,
        cte=cte,
        filename=filename,
        destino_final=destino_trib,
        v_total=v_total_cte_trib,
        base_calculo=v_bc_cte_trib,
        mva=max_mva,
        reducao=reducao_trib,
        a_dst=a_dst_padrao,
        aliq_simples="N",
        data_entrada=data_ent_trib,
        origem_data=orig_ent_trib,
        percentual_rateio=percentual_trib,
        numeros_nfe_origem=numeros_origem,
        mva_grupo=max_candidates[0].get("mva_grupo") or None,
        mva_fonte=max_candidates[0].get("mva_fonte") or None,
        notas_criadas=notas_criadas,
        notas_ignoradas=notas_ignoradas,
        erros_validacao=erros_validacao,
        rows_por_destino=rows_por_destino,
        fcp_metadados=fcp_meta,
        fcp_rows_data=fcp_rows_data,
        fcp_rows_por_destino=fcp_rows_por_destino,
    )


def processar_ctes(
    *,
    pipeline: Any,
    ctes: List[Tuple[str, ExtractedCTeData]],
    nfe_context_by_chave: Dict[str, Dict[str, Any]],
    solicitacao: Solicitacao,
    empresa: Empresa,
    planilha_records: List[PlanilhaEntradaRecord],
    sped_cte_records: List[PlanilhaEntradaRecord],
    has_sped: bool,
    modo_legado: bool,
    notas_criadas: List[NotaFiscalProcessada],
    notas_ignoradas: List[Dict[str, Any]],
    avisos_avaliacao: List[Dict[str, Any]],
    erros_validacao: List[str],
    rows_por_destino: Dict[str, List[Dict[str, Any]]],
    fcp_rows_por_destino: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> None:
    """Processa todos os CT-es carregados, aplicando regra do tomador, rateio e cálculo."""
    if fcp_rows_por_destino is None:
        fcp_rows_por_destino = defaultdict(list)
    empresa_cnpj = _clean_digits(empresa.cnpj)
    uf_empresa_dest = (empresa.uf or "").strip().upper()
    tem_fonte_entradas = has_sped or bool(planilha_records)

    for filename, cte in ctes:
        tomador = _clean_digits(cte.cnpj_tomador)
        if not empresa_cnpj or tomador != empresa_cnpj:
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    f"CT-e desconsiderado: o tomador do serviço ({tomador or 'não identificado'}) "
                    f"não é a empresa em processamento ({empresa_cnpj}).",
                )
            )
            continue

        uf_emitente = (cte.uf_emitente or "").strip().upper()
        if not SanityChecker.is_interestadual(uf_emitente, uf_empresa_dest):
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    f"Operação interna estadual desconsiderada: UF do "
                    f"emitente do CT-e ({uf_emitente}) é igual à UF do "
                    f"tomador ({uf_empresa_dest}). Antecipação e DIFAL aplicam-se "
                    f"exclusivamente a aquisições interestaduais.",
                )
            )
            continue

        if not cte.data_emissao or not SanityChecker.is_within_period(
            cte.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim
        ):
            dt_str = cte.data_emissao.strftime("%d/%m/%Y") if cte.data_emissao else "desconhecida"
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    f"CT-e com data de emissão ({dt_str}) fora do período informado "
                    f"({solicitacao.periodo_inicio.strftime('%d/%m/%Y')} a "
                    f"{solicitacao.periodo_fim.strftime('%d/%m/%Y')}).",
                )
            )
            continue

        if cte.v_total_cte <= Decimal("0.00"):
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    f"CT-e com valor total zerado (R$ {cte.v_total_cte:.2f}).",
                )
            )
            continue

        if not cte.chaves_nfe:
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    "CT-e desconsiderado: nenhuma NF-e originária (<infNFe><chave>) foi vinculada no XML.",
                )
            )
            continue

        missing = [chv for chv in cte.chaves_nfe if chv not in nfe_context_by_chave]
        if missing:
            faltantes_desc = ", ".join(
                f"NF-e {extrair_numero_serie_chave_nfe(chv)[0]} (Chave: {chv})"
                for chv in missing
            )
            avisos_avaliacao.append(
                {
                    "numero_nota": cte.numero_cte,
                    "serie": cte.serie,
                    "item_numero": 1,
                    "arquivo": filename,
                    "aviso": (
                        f"CT-e nº {cte.numero_cte} não processado: forneça o XML da(s) NF-e(s) "
                        f"originária(s) ({faltantes_desc})."
                    ),
                }
            )
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    f"NF-e(s) originária(s) não localizada(s): {faltantes_desc}. "
                    "Forneça o XML (ou ZIP com as notas) para processar este CT-e.",
                )
            )
            continue

        nfes_ctx = [nfe_context_by_chave[chv] for chv in cte.chaves_nfe]
        v_total_nfes = sum((ctx["v_total_nota"] for ctx in nfes_ctx), Decimal("0.00"))
        soma_trib = sum((ctx["soma_trib"] for ctx in nfes_ctx), Decimal("0.00"))
        soma_difal = sum((ctx["soma_difal"] for ctx in nfes_ctx), Decimal("0.00"))

        if v_total_nfes <= Decimal("0.00") or (
            soma_trib <= Decimal("0.00") and soma_difal <= Decimal("0.00")
        ):
            notas_ignoradas.append(
                _cte_ignored_record(
                    cte,
                    filename,
                    "CT-e desconsiderado: a(s) NF-e(s) originária(s) não possuem mercadorias "
                    "destinadas à Antecipação Tributária ou DIFAL.",
                )
            )
            continue

        cte_entry_date = None
        cte_entry_origin = None
        if planilha_records:
            cte_entry_date, cte_entry_origin = DataEntradaMatcher.match_data_entrada(
                nf_chave=cte.chave_acesso,
                nf_cnpj_emitente=cte.cnpj_emitente,
                nf_serie=cte.serie,
                nf_numero=cte.numero_cte,
                planilha_records=planilha_records,
            )
        if cte_entry_date is None and sped_cte_records:
            d100_date, _ = DataEntradaMatcher.match_data_entrada(
                nf_chave=cte.chave_acesso,
                nf_cnpj_emitente=cte.cnpj_emitente,
                nf_serie=cte.serie,
                nf_numero=cte.numero_cte,
                planilha_records=sped_cte_records,
            )
            if d100_date is not None:
                cte_entry_date = d100_date
                cte_entry_origin = "sped_fiscal"

        def _resolve_entry_for(contributing: List[Dict[str, Any]]) -> Tuple[Any, Optional[str], bool]:
            if cte_entry_date is not None:
                return cte_entry_date, cte_entry_origin, False
            confirmed = next((c for c in contributing if c["confirmed_entry"]), None)
            if confirmed is not None:
                return confirmed["data_entrada"], confirmed["origem_data"], False
            return None, None, tem_fonte_entradas and not modo_legado

        numeros_origem = [ctx["numero_nota"] for ctx in nfes_ctx]

        if soma_trib > Decimal("0.00"):
            contributing_trib = [ctx for ctx in nfes_ctx if ctx["soma_trib"] > Decimal("0.00")]
            data_ent_trib, orig_ent_trib, pago_ant_trib = _resolve_entry_for(contributing_trib)
            destino_trib = pipeline._rotear_destino_pagamento_e_regime(
                destino_item=ANTECIPACAO_TRIBUTARIA,
                pago_antecipadamente=pago_ant_trib,
                optante_simples=empresa.optante_simples_nacional,
            )
            if not modo_legado or pipeline._compativel_com_modo_legado(
                destino_trib, solicitacao.tipo_planilha
            ):
                _processar_cte_tributaria(
                    pipeline=pipeline,
                    solicitacao=solicitacao,
                    empresa=empresa,
                    cte=cte,
                    filename=filename,
                    nfes_ctx=nfes_ctx,
                    contributing_trib=contributing_trib,
                    destino_trib=destino_trib,
                    v_total_nfes=v_total_nfes,
                    soma_trib=soma_trib,
                    data_ent_trib=data_ent_trib,
                    orig_ent_trib=orig_ent_trib,
                    numeros_origem=numeros_origem,
                    notas_criadas=notas_criadas,
                    notas_ignoradas=notas_ignoradas,
                    erros_validacao=erros_validacao,
                    rows_por_destino=rows_por_destino,
                    fcp_rows_por_destino=fcp_rows_por_destino,
                )

        if soma_difal > Decimal("0.00"):
            contributing_difal = [ctx for ctx in nfes_ctx if ctx["soma_difal"] > Decimal("0.00")]
            data_ent_difal, orig_ent_difal, pago_ant_difal = _resolve_entry_for(contributing_difal)
            destino_difal = pipeline._rotear_destino_pagamento_e_regime(
                destino_item=DIFAL,
                pago_antecipadamente=pago_ant_difal,
                optante_simples=empresa.optante_simples_nacional,
            )
            if not modo_legado or pipeline._compativel_com_modo_legado(
                destino_difal, solicitacao.tipo_planilha
            ):
                all_difal = all(ctx["todos_itens_difal"] for ctx in nfes_ctx)
                if all_difal:
                    ratio_difal = Decimal("1")
                    v_total_cte_difal = cte.v_total_cte
                else:
                    ratio_difal = min(Decimal("1"), soma_difal / v_total_nfes)
                    v_total_cte_difal = round_currency(cte.v_total_cte * ratio_difal)

                if v_total_cte_difal > Decimal("0.00"):
                    res_a_dst_difal = pipeline.resolver.resolve_a_dst(
                        perfil_regras_id=empresa.perfil_regras_id,
                        uf=empresa.uf,
                        empresa_id=empresa.id,
                        apenas_padrao_uf=True,
                    )
                    aliq_simples = "S" if cte.fornecedor_simples_nacional else "N"
                    percentual_difal = (ratio_difal * Decimal("100.00")).quantize(Decimal("0.0001"))
                    _emitir_linha_cte(
                        pipeline=pipeline,
                        solicitacao=solicitacao,
                        empresa=empresa,
                        cte=cte,
                        filename=filename,
                        destino_final=destino_difal,
                        v_total=v_total_cte_difal,
                        base_calculo=v_total_cte_difal,
                        mva=Decimal("0.00"),
                        reducao=None,
                        a_dst=res_a_dst_difal.aliquota,
                        aliq_simples=aliq_simples,
                        data_entrada=data_ent_difal,
                        origem_data=orig_ent_difal,
                        percentual_rateio=percentual_difal,
                        numeros_nfe_origem=numeros_origem,
                        mva_grupo=None,
                        mva_fonte=None,
                        notas_criadas=notas_criadas,
                        notas_ignoradas=notas_ignoradas,
                        erros_validacao=erros_validacao,
                        rows_por_destino=rows_por_destino,
                        fcp_metadados=pipeline._montar_metadados_fcp(
                            a_dst_base=res_a_dst_difal.aliquota,
                            fcp_aliquota=None,
                            fcp_origem=None,
                            fcp_detalhe=None,
                            fcp_separado=False,
                        ),
                    )

