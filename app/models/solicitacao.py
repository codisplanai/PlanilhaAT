import datetime
import uuid
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base

class Solicitacao(Base):
    __tablename__ = "solicitacoes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    empresa_id = Column(Integer, ForeignKey("empresas.id", ondelete="RESTRICT"), nullable=False, index=True)
    usuario_id = Column(String(36), ForeignKey("profiles.id", ondelete="SET NULL"), nullable=True, index=True)
    periodo_inicio = Column(Date, nullable=False)
    periodo_fim = Column(Date, nullable=False)
    tipo_planilha = Column(String(50), nullable=False, default="multi")  # legado: antecipacao_parcial, antecipacao_tributaria, difal, ou 'multi' (roteamento automático por CFOP)
    template_id = Column(Integer, ForeignKey("templates_xlsx.id", ondelete="RESTRICT"), nullable=True)  # legado: usado apenas pelo fluxo de tipo único anterior
    status = Column(String(20), default="pendente", nullable=False)  # pendente, processando, concluido, erro
    mensagem_erro = Column(Text, nullable=True)
    arquivo_saida_path = Column(String(500), nullable=True)
    total_notas_processadas = Column(Integer, default=0, nullable=False)
    notas_ignoradas = Column(JSON, default=list, nullable=False)  # Lista com registros de notas ignoradas e seus motivos
    cfops_sem_regra = Column(JSON, default=dict, nullable=False)  # Resumo agregado {sufixo_cfop: qtd_itens} de itens descartados por CFOP sem regra cadastrada
    criado_em = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    atualizado_em = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow, nullable=False)

    empresa = relationship("Empresa", back_populates="solicitacoes")
    usuario = relationship("Profile", back_populates="solicitacoes")
    template = relationship("TemplateXlsx", back_populates="solicitacoes")
    saidas = relationship(
        "SolicitacaoSaida",
        back_populates="solicitacao",
        cascade="all, delete-orphan"
    )
    notas_processadas = relationship(
        "NotaFiscalProcessada",
        back_populates="solicitacao",
        cascade="all, delete-orphan",
        order_by="func.coalesce(NotaFiscalProcessada.data_entrada, NotaFiscalProcessada.data_emissao), NotaFiscalProcessada.data_emissao, NotaFiscalProcessada.numero_nota, NotaFiscalProcessada.item_numero"
    )
