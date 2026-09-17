from decimal import Decimal
from app.services.calculation.antecipacao_parcial import AntecipacaoParcialCalculator
from app.services.calculation.antecipacao_tributaria import AntecipacaoTributariaCalculator
from app.services.calculation.difal import DifalCalculator
from app.services.calculation.factory import CalculatorFactory

def test_calculo_antecipacao_parcial():
    calc = AntecipacaoParcialCalculator()
    # V.Total = 5400.00, Base = 5150.00, A.ORI = 12% (0.12), A.DST = 20.5% (0.205)
    # Débito = 5400 * 0.205 = 1107.00
    # Crédito = 5150 * 0.12 = 618.00
    # Valor Devido = 1107.00 - 618.00 = 489.00
    result = calc.calculate(
        v_total=Decimal("5400.00"),
        base_calculo=Decimal("5150.00"),
        ipi_despesas=Decimal("400.00"),
        a_ori=Decimal("0.1200"),
        a_dst=Decimal("0.2050")
    )

    assert result.debito == Decimal("1107.00")
    assert result.credito == Decimal("618.00")
    assert result.valor_devido == Decimal("489.00")

def test_calculo_antecipacao_tributaria_com_mva():
    calc = AntecipacaoTributariaCalculator()
    # V.Total = 1000.00, MVA = 30%, A.DST = 18%, A.ORI = 12%, Base = 1000.00
    # Base ST = 1000 * 1.30 = 1300.00
    # Débito = 1300 * 0.18 = 234.00
    # Crédito = 1000 * 0.12 = 120.00
    # Devido = 114.00
    result = calc.calculate(
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.1200"),
        a_dst=Decimal("0.1800"),
        parametros_extras={"mva": "30.0"}
    )

    assert result.debito == Decimal("234.00")
    assert result.credito == Decimal("120.00")
    assert result.valor_devido == Decimal("114.00")

def test_calculo_difal():
    calc = DifalCalculator()
    # V.Total = 2000.00, A.DST = 18% (0.18), A.ORI = 12% (0.12), Regime Normal ('N')
    # Base ST = (2000 - (2000 * 0.12)) / (1 - 0.18) = 1760 / 0.82 = 2146.34
    # Débito = 2146.34 * 0.18 = 386.34
    # Crédito = 2000 * 0.12 = 240.00
    # Devido = 386.34 - 240.00 = 146.34
    result = calc.calculate(
        v_total=Decimal("2000.00"),
        base_calculo=Decimal("2000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.1200"),
        a_dst=Decimal("0.1800"),
        parametros_extras={"aliq_simples": "N"}
    )

    assert result.debito == Decimal("386.34")
    assert result.credito == Decimal("240.00")
    assert result.valor_devido == Decimal("146.34")

def test_calculator_factory():
    calc_parcial = CalculatorFactory.get_calculator("antecipacao_parcial")
    assert isinstance(calc_parcial, AntecipacaoParcialCalculator)

    calc_trib = CalculatorFactory.get_calculator("antecipacao_tributaria")
    assert isinstance(calc_trib, AntecipacaoTributariaCalculator)

    calc_difal = CalculatorFactory.get_calculator("difal")
    assert isinstance(calc_difal, DifalCalculator)
