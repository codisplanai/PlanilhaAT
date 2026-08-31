import os
import datetime
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.database import SessionLocal
from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.solicitacao_saida import SolicitacaoSaida
from app.core.config import settings

client = TestClient(app)

def test_excluir_solicitacao_com_sucesso():
    db: Session = SessionLocal()
    try:
        # Garante empresa existente
        empresa = db.query(Empresa).first()
        if not empresa:
            empresa = Empresa(
                cnpj="12345678000199",
                razao_social="Empresa Teste Exclusao",
                uf="BA"
            )
            db.add(empresa)
            db.commit()
            db.refresh(empresa)

        # Cria arquivos temporários de teste
        os.makedirs(settings.OUTPUTS_DIR, exist_ok=True)
        temp_file_1 = os.path.join(settings.OUTPUTS_DIR, "test_saida_del_1.xlsx")
        temp_file_2 = os.path.join(settings.OUTPUTS_DIR, "test_saida_del_2.xlsx")
        with open(temp_file_1, "w") as f:
            f.write("mock content 1")
        with open(temp_file_2, "w") as f:
            f.write("mock content 2")

        # Cria solicitação com saídas e notas
        sol = Solicitacao(
            empresa_id=empresa.id,
            periodo_inicio=datetime.date(2026, 7, 1),
            periodo_fim=datetime.date(2026, 7, 31),
            tipo_planilha="multi",
            status="concluido",
            arquivo_saida_path=temp_file_1,
            total_notas_processadas=1
        )
        db.add(sol)
        db.commit()
        db.refresh(sol)

        saida = SolicitacaoSaida(
            solicitacao_id=sol.id,
            tipo="antecipacao_parcial",
            arquivo_path=temp_file_2,
            total_notas=1,
            total_valor_devido=Decimal("100.00")
        )
        db.add(saida)

        nota = NotaFiscalProcessada(
            solicitacao_id=sol.id,
            numero_nota="999",
            cnpj_destinatario=empresa.cnpj,
            data_emissao=datetime.datetime(2026, 7, 10, 12, 0),
            ncm="72142000",
            cfop="2102",
            v_total=Decimal("1000.00"),
            base_calculo=Decimal("1000.00"),
            a_ori=Decimal("12.00"),
            a_dst_resolvida=Decimal("20.50"),
            debito=Decimal("205.00"),
            credito=Decimal("120.00"),
            valor_devido=Decimal("85.00"),
            destino_planilha="antecipacao_parcial"
        )
        db.add(nota)
        db.commit()

        sol_id = sol.id
        assert os.path.exists(temp_file_1)
        assert os.path.exists(temp_file_2)

        # Dispara endpoint DELETE
        res = client.delete(f"/api/v1/solicitacoes/{sol_id}")
        assert res.status_code == 204

        # Verifica remoção no banco
        db.expire_all()
        sol_db = db.query(Solicitacao).filter(Solicitacao.id == sol_id).first()
        assert sol_db is None

        # Verifica cascata em saidas e notas
        saidas_db = db.query(SolicitacaoSaida).filter(SolicitacaoSaida.solicitacao_id == sol_id).all()
        assert len(saidas_db) == 0

        notas_db = db.query(NotaFiscalProcessada).filter(NotaFiscalProcessada.solicitacao_id == sol_id).all()
        assert len(notas_db) == 0

        # Verifica exclusão dos arquivos físicos
        assert not os.path.exists(temp_file_1)
        assert not os.path.exists(temp_file_2)

    finally:
        db.close()


def test_excluir_solicitacao_inexistente():
    res = client.delete("/api/v1/solicitacoes/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
