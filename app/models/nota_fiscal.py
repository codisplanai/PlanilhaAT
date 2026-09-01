import uuid
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive

class NotaFiscalProcessada(Base):
    __tablename__ = "notas_fiscais_processadas"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    solicitacao_id = Column(String(36), ForeignKey("solicitacoes.id", ondelete="CASCADE"), nullable=False, index=True)
    chave_acesso = Column(String(44), nullable=True, index=True)
    numero_nota = Column(String(20), nullable=False)
    serie = Column(String(10), nullable=True)
    cnpj_emitente = Column(String(14), nullable=True)
    uf_emitente = Column(String(2), nullable=True)
    cnpj_destinatario = Column(String(14), nullable=False)
    uf_destinatario = Column(String(2), nullable=True)
    data_emissao = Column(DateTime, nullable=False)
    data_entrada = Column(Date, nullable=True)                          # Data de entrada física no estabelecimento
    origem_data_entrada = Column(String(50), nullable=True)             # 'planilha_sistema_contabil' | 'manual' | None
    item_numero = Column(Integer, default=1, nullable=False)
    ncm = Column(String(8), nullable=False, index=True)
    cfop = Column(String(4), nullable=True)
    destino_planilha = Column(String(50), nullable=True, index=True)  # antecipacao_parcial, antecipacao_parcial_antecipado, antecipacao_tributaria, difal
    
    # Valores extraídos e calculados
    v_total = Column(Numeric(15, 2), nullable=False)
    base_calculo = Column(Numeric(15, 2), nullable=False)
    ipi_despesas = Column(Numeric(15, 2), default=0.00, nullable=False)
    a_ori = Column(Numeric(6, 4), nullable=False)           # Extraído diretamente do XML (pICMS)
    a_dst_resolvida = Column(Numeric(6, 4), nullable=False) # Resolvido via motor de regras
    debito = Column(Numeric(15, 2), nullable=False)
    credito = Column(Numeric(15, 2), nullable=False)
    valor_devido = Column(Numeric(15, 2), nullable=False)
    
    metadados_extras = Column(JSON, default=dict, nullable=False)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)

    solicitacao = relationship("Solicitacao", back_populates="notas_processadas")
