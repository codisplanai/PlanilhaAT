import re
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Tuple

from app.core.exceptions import ValidationException
from app.services.extraction.base import ExtractedNFData

def validate_cnpj_digits(cnpj: str) -> bool:
    """Valida o dígito verificador do CNPJ através do algoritmo módulo 11"""
    clean = re.sub(r"\D", "", cnpj)
    if len(clean) != 14:
        return False
    # Bloquear sequências com todos os dígitos iguais (ex: 11111111111111)
    if len(set(clean)) == 1:
        return False

    # Primeiro dígito verificador
    weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    soma1 = sum(int(clean[i]) * weights1[i] for i in range(12))
    resto1 = soma1 % 11
    digito1 = 0 if resto1 < 2 else 11 - resto1
    if int(clean[12]) != digito1:
        return False

    # Segundo dígito verificador
    weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    soma2 = sum(int(clean[i]) * weights2[i] for i in range(13))
    resto2 = soma2 % 11
    digito2 = 0 if resto2 < 2 else 11 - resto2
    if int(clean[13]) != digito2:
        return False

    return True

class SanityChecker:
    """
    Camada 7: Checagens de sanidade e integridade dos dados extraídos e processados
    antes de autorizar a geração de saída.
    """

    @classmethod
    def validate_cnpj(cls, cnpj: str, descricao: str = "CNPJ") -> None:
        clean = re.sub(r"\D", "", cnpj)
        if not validate_cnpj_digits(clean):
            raise ValidationException(f"{descricao} '{cnpj}' é inválido pelo algoritmo de dígitos verificadores da Receita Federal.")

    @classmethod
    def validate_nf_destinatario(cls, nf_data: ExtractedNFData, expected_cnpj: str) -> None:
        clean_dest = re.sub(r"\D", "", nf_data.cnpj_destinatario)
        clean_expected = re.sub(r"\D", "", expected_cnpj)

        if clean_dest != clean_expected:
            raise ValidationException(
                f"NF-e nº {nf_data.numero_nota} possui CNPJ destinatário '{clean_dest}', "
                f"que não corresponde ao CNPJ da empresa selecionada '{clean_expected}'."
            )

    @classmethod
    def is_interestadual(cls, uf_emitente: Optional[str], uf_empresa: Optional[str]) -> bool:
        """
        Verifica se a operação é interestadual:
        Retorna True se a UF do fornecedor/emitente for diferente da UF da empresa cliente destinatária.
        Retorna False se ambas as UFs forem iguais (operação interna estadual).
        """
        if not uf_emitente or not uf_empresa:
            return True  # Se não foi possível determinar, não bloqueia apressadamente por este critério
        return uf_emitente.strip().upper() != uf_empresa.strip().upper()

    @classmethod
    def is_within_period(cls, data_emissao: datetime, periodo_inicio: date, periodo_fim: date) -> bool:
        dt = data_emissao.date() if isinstance(data_emissao, datetime) else data_emissao
        return periodo_inicio <= dt <= periodo_fim

    @classmethod
    def validate_period(cls, data_emissao: datetime, periodo_inicio: date, periodo_fim: date, numero_nota: str) -> None:
        dt = data_emissao.date() if isinstance(data_emissao, datetime) else data_emissao
        if not (periodo_inicio <= dt <= periodo_fim):
            raise ValidationException(
                f"NF-e nº {numero_nota} possui data de emissão {dt.strftime('%d/%m/%Y')}, "
                f"que está fora do período informado ({periodo_inicio.strftime('%d/%m/%Y')} a {periodo_fim.strftime('%d/%m/%Y')})."
            )

    @classmethod
    def validate_numeric_values(
        cls,
        numero_nota: str,
        v_total: Decimal,
        base_calculo: Decimal,
        a_ori: Decimal,
        a_dst: Decimal
    ) -> None:
        if v_total <= Decimal("0.00"):
            raise ValidationException(f"NF-e nº {numero_nota}: Valor total deve ser estritamente positivo (recebido: {v_total}).")

        if base_calculo < Decimal("0.00"):
            raise ValidationException(f"NF-e nº {numero_nota}: Base de cálculo não pode ser negativa (recebido: {base_calculo}).")

        if not (Decimal("0.00") <= a_ori <= Decimal("1.00")):
            raise ValidationException(f"NF-e nº {numero_nota}: Alíquota de origem A.ORI fora da faixa válida [0, 1] (recebido: {a_ori}).")

        if not (Decimal("0.00") <= a_dst <= Decimal("1.00")):
            raise ValidationException(f"NF-e nº {numero_nota}: Alíquota de destino A.DST fora da faixa válida [0, 1] (recebido: {a_dst}).")
