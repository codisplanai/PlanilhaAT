# Antecipação Parcial — Pago Antecipadamente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Gerar uma quarta planilha, "Antecipação Parcial — Pago Antecipadamente", contendo as NF-e emitidas na competência cuja mercadoria ainda não entrou no estabelecimento do cliente.

**Architecture:** A competência é a da **emissão**. A rodada passa a aceitar **XMLs e SPED juntos**: os XMLs definem o universo de notas emitidas no período e o SPED da mesma competência funciona como oráculo de presença — quem está no SPED entrou no mês, quem não está ainda não entrou. As duas fontes são unidas por chave de acesso (com CNPJ+série+número como reserva), o SPED prevalecendo na interseção. Itens de CFOP de antecipação parcial pertencentes a notas ausentes do SPED são roteados para o novo tipo `antecipacao_parcial_antecipado`, que reutiliza o cálculo da parcial e sai em arquivo próprio.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.0, Alembic, openpyxl, Pytest, React + TypeScript + Vite.

## Global Constraints

- **Não há repositório git neste projeto** (`git rev-parse` retorna "not a git repository"). Os passos de checkpoint rodam a suíte completa em vez de commitar. Se quiser versionamento, rode `git init` antes de começar e substitua cada checkpoint por um commit.
- Banco de produção é SQLite (`planilha_at.db`); README prevê PostgreSQL. **Toda alteração de coluna existente usa `op.batch_alter_table`** — é o único caminho que funciona no SQLite.
- Comando de teste: `python -m pytest tests/ -q` a partir da raiz do projeto.
- Diagnósticos avulsos precisam de `PYTHONPATH` na raiz do projeto (ex.: `PYTHONPATH="C:/Users/Rodrigo/.antigravity-ide/Planilha AT" python script.py`).
- O identificador interno do novo tipo é exatamente `antecipacao_parcial_antecipado` (30 caracteres). O nome de exibição é `Antecipação Parcial — Pago Antecipadamente`.
- **`VALID_DESTINOS` em `app/schemas/regra_cfop.py` NÃO muda.** CFOP não sabe nada sobre data de entrada; o novo tipo não é um destino de regra de CFOP e não deve aparecer no dropdown de regras.
- O desdobramento **nunca** se aplica em `modo_legado` (solicitação criada com `tipo_planilha` explícito) nem quando nenhum SPED é enviado.
- Apenas a Antecipação Parcial se desdobra. Antecipação Tributária e DIFAL continuam com uma planilha cada.

---

### Task 1: Registrar o tipo `antecipacao_parcial_antecipado`

Infraestrutura pura: cria o tipo, alarga a coluna que vai guardá-lo e semeia o template. Nenhuma mudança de comportamento ainda — nada roteia para o tipo novo ao fim desta task.

**Files:**
- Create: `alembic/versions/006_parcial_antecipado.py`
- Modify: `app/models/nota_fiscal.py:26`
- Modify: `app/services/calculation/factory.py:10-14`
- Modify: `app/services/templates_admin/template_manager.py:33`
- Modify: `app/core/seeds.py` (acrescentar constantes e bloco de seed)
- Test: `tests/test_tipo_parcial_antecipado.py`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: a string de tipo `"antecipacao_parcial_antecipado"`, aceita por `CalculatorFactory.get_calculator(tipo: str) -> BaseCalculator` e por `TemplateManager.upload_new_template_version(..., tipo: str, ...)`. A constante `DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING: dict` fica exportada em `app/core/seeds.py`.

- [x] **Step 1: Escrever os testes que falham**

Criar `tests/test_tipo_parcial_antecipado.py`:

```python
from app.services.calculation.factory import CalculatorFactory
from app.services.calculation.antecipacao_parcial import AntecipacaoParcialCalculator
from app.models.template_xlsx import TemplateXlsx
from app.core.seeds import seed_default_templates


def test_factory_reaproveita_o_calculador_da_parcial():
    """O cálculo é idêntico ao da Antecipação Parcial: mesma instância, não uma cópia."""
    parcial = CalculatorFactory.get_calculator("antecipacao_parcial")
    antecipado = CalculatorFactory.get_calculator("antecipacao_parcial_antecipado")

    assert isinstance(antecipado, AntecipacaoParcialCalculator)
    assert antecipado is parcial


def test_template_manager_aceita_o_tipo_novo(db_session, create_sample_excel_template):
    from app.services.templates_admin.template_manager import TemplateManager

    template_path = create_sample_excel_template(tipo="antecipacao_parcial_antecipado")
    with open(template_path, "rb") as f:
        file_bytes = f.read()

    template = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial_antecipado",
        filename="t.xlsx",
        file_bytes=file_bytes,
        mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
        promover_ativo=True,
    )
    assert template.tipo == "antecipacao_parcial_antecipado"
    assert template.ativo is True


def test_seed_registra_template_ativo_para_o_tipo_novo(db_session):
    """O tipo novo reaproveita o arquivo-modelo da Parcial, então já nasce utilizável."""
    seed_default_templates(db_session)

    ativo = (
        db_session.query(TemplateXlsx)
        .filter(
            TemplateXlsx.tipo == "antecipacao_parcial_antecipado",
            TemplateXlsx.ativo == True,
        )
        .first()
    )
    assert ativo is not None


def test_regras_de_cfop_nao_oferecem_o_tipo_novo():
    """CFOP não sabe nada sobre data de entrada — o tipo novo não é destino de regra de CFOP."""
    from app.schemas.regra_cfop import VALID_DESTINOS

    assert "antecipacao_parcial_antecipado" not in VALID_DESTINOS
```

- [x] **Step 2: Rodar e confirmar que falham**

Run: `python -m pytest tests/test_tipo_parcial_antecipado.py -q`
Expected: FAIL — `ValidationException: Tipo de planilha/cálculo não suportado: 'antecipacao_parcial_antecipado'` nos dois primeiros; o terceiro falha com `assert None is not None`. O quarto (`test_regras_de_cfop_nao_oferecem_o_tipo_novo`) já passa e deve continuar passando.

- [x] **Step 3: Alargar `destino_planilha` para String(50)**

A string `antecipacao_parcial_antecipado` tem exatamente 30 caracteres e a coluna é `String(30)` — cabe com zero folga e quebra no PostgreSQL. Em `app/models/nota_fiscal.py`, trocar a linha 26:

```python
    destino_planilha = Column(String(50), nullable=True, index=True)  # antecipacao_parcial, antecipacao_parcial_antecipado, antecipacao_tributaria, difal
```

- [x] **Step 4: Criar a migração 006**

Criar `alembic/versions/006_parcial_antecipado.py`:

```python
"""Alarga destino_planilha para comportar o tipo antecipacao_parcial_antecipado

A string 'antecipacao_parcial_antecipado' tem exatamente 30 caracteres, o mesmo
limite da coluna original — cabe sem folga no SQLite (que não impõe o limite) e
quebra no PostgreSQL. Alarga para 50, igualando solicitacoes_saidas.tipo.

Revision ID: 006_parcial_antecipado
Revises: 005_cfop_routing
Create Date: 2026-08-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '006_parcial_antecipado'
down_revision: Union[str, None] = '005_cfop_routing'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table é obrigatório: o SQLite não suporta ALTER COLUMN nativo
    with op.batch_alter_table('notas_fiscais_processadas') as batch_op:
        batch_op.alter_column(
            'destino_planilha',
            existing_type=sa.String(length=30),
            type_=sa.String(length=50),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table('notas_fiscais_processadas') as batch_op:
        batch_op.alter_column(
            'destino_planilha',
            existing_type=sa.String(length=50),
            type_=sa.String(length=30),
            existing_nullable=True,
        )
```

- [x] **Step 5: Aplicar a migração no banco real**

Run: `python -m alembic upgrade head`
Expected: `Running upgrade 005_cfop_routing -> 006_parcial_antecipado`

Confirmar: `python -m alembic current` → `006_parcial_antecipado (head)`

- [x] **Step 6: Registrar o tipo na CalculatorFactory**

Substituir o corpo da classe em `app/services/calculation/factory.py`:

```python
class CalculatorFactory:
    """Factory para instanciar a estratégia de cálculo correta conforme o tipo de planilha"""

    # 'antecipacao_parcial_antecipado' é a mesma apuração da parcial (Débito = V.Total × A.DST,
    # Crédito = Base × A.ORI); só o arquivo de saída é separado, para segregar as notas cuja
    # mercadoria ainda não entrou no estabelecimento. Por isso compartilha a MESMA instância.
    _parcial = AntecipacaoParcialCalculator()

    _calculators = {
        "antecipacao_parcial": _parcial,
        "antecipacao_parcial_antecipado": _parcial,
        "antecipacao_tributaria": AntecipacaoTributariaCalculator(),
        "difal": DifalCalculator(),
    }

    @classmethod
    def get_calculator(cls, tipo_planilha: str) -> BaseCalculator:
        clean_tipo = tipo_planilha.strip().lower()
        if clean_tipo not in cls._calculators:
            raise ValidationException(f"Tipo de planilha/cálculo não suportado: '{tipo_planilha}'. Opções: {list(cls._calculators.keys())}")
        return cls._calculators[clean_tipo]
```

- [x] **Step 7: Aceitar o tipo no TemplateManager**

Em `app/services/templates_admin/template_manager.py`, linha 33:

```python
        valid_tipos = ["antecipacao_parcial", "antecipacao_parcial_antecipado", "antecipacao_tributaria", "difal"]
```

- [x] **Step 8: Semear o template do tipo novo**

Em `app/core/seeds.py`, logo após o bloco `DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING`, acrescentar:

```python
# O layout e o cálculo de "Pago Antecipadamente" são idênticos aos da Antecipação Parcial
# (RP-153) — só o arquivo de saída é separado. Reaproveita o mesmo modelo e mapeamento,
# de modo que o tipo já nasce utilizável; um template customizado (com o título impresso
# diferente, por exemplo) pode ser enviado depois em Admin > Templates.
DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH = DEFAULT_ANTECIPACAO_PARCIAL_TEMPLATE_PATH
DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING = DEFAULT_ANTECIPACAO_PARCIAL_MAPPING
```

E, dentro de `seed_default_templates`, ao final da função, acrescentar:

```python
    # 3. Antecipação Parcial — Pago Antecipadamente (mesmo modelo da Parcial)
    template_antecipado_ativo = (
        db.query(TemplateXlsx)
        .filter(TemplateXlsx.tipo == "antecipacao_parcial_antecipado", TemplateXlsx.ativo == True)
        .first()
    )

    if template_antecipado_ativo is None and os.path.exists(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH):
        with open(DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_TEMPLATE_PATH, "rb") as f:
            file_bytes = f.read()

        TemplateManager.upload_new_template_version(
            db=db,
            tipo="antecipacao_parcial_antecipado",
            file_bytes=file_bytes,
            filename="modelo_padrao_antecipacao_parcial_antecipado.xlsx",
            mapeamento=DEFAULT_ANTECIPACAO_PARCIAL_ANTECIPADO_MAPPING,
            observacoes="Modelo de Antecipação Parcial — Pago Antecipadamente (mesmo layout da RP-153)",
            promover_ativo=True
        )
```

- [x] **Step 9: Rodar os testes da task**

Run: `python -m pytest tests/test_tipo_parcial_antecipado.py -q`
Expected: 4 passed

- [x] **Step 10: Checkpoint — suíte completa**

Run: `python -m pytest tests/ -q`
Expected: todos passando (54 anteriores + 4 novos = 58). Nenhum teste existente pode quebrar: nada roteia para o tipo novo ainda.

---

### Task 2: Bloquear SPED de competência divergente

Guarda de segurança independente. Sem ela, subir o SPED do mês errado faria **todas** as notas parecerem ausentes na Task 4, jogando a apuração inteira na planilha errada sem qualquer aviso.

**Files:**
- Modify: `app/services/extraction/sped_fiscal_extractor.py` (novo método estático)
- Modify: `app/services/pipeline_service.py` (validação antes da extração)
- Test: `tests/test_sped_periodo.py`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: `SpedFiscalExtractor.extract_periodo(sped_content: bytes) -> Tuple[Optional[date], Optional[date]]`, devolvendo `(DT_INI, DT_FIN)` do registro `0000` ou `(None, None)` se o registro não existir. A assinatura de `extract_from_sped` **não muda**.

- [x] **Step 1: Escrever os testes que falham**

Criar `tests/test_sped_periodo.py`:

```python
import pytest
from datetime import date

from app.core.exceptions import ValidationException
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor

SPED_JANEIRO = """|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|
|0200|P1|PRODUTO|||UN|01|21069090|||18,00||
|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO|1,000|UN|2000,00|0,00|0|000|6102||2000,00|12,00|240,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
"""


def test_extrai_periodo_do_registro_0000():
    ini, fim = SpedFiscalExtractor.extract_periodo(SPED_JANEIRO.encode("utf-8"))
    assert ini == date(2026, 1, 1)
    assert fim == date(2026, 1, 31)


def test_periodo_none_quando_nao_ha_registro_0000():
    sped_sem_0000 = "|C100|0|1|F1|55|00|1|901|||10012026|20012026|2000,00|\n"
    ini, fim = SpedFiscalExtractor.extract_periodo(sped_sem_0000.encode("utf-8"))
    assert ini is None
    assert fim is None


def test_pipeline_bloqueia_sped_de_competencia_divergente(db_session, create_sample_excel_template):
    """Subir o SPED de fevereiro na apuração de janeiro deve falhar alto, não silenciosamente."""
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.empresa import Empresa
    from app.models.regra_aliquota import RegraAliquotaDestino
    from app.models.solicitacao import Solicitacao
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.templates_admin.template_manager import TemplateManager

    template_path = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(template_path, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session, tipo="antecipacao_parcial", filename="t.xlsx", file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    perfil = PerfilRegras(nome="Perfil Periodo SPED")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195", uf="BA",
                      perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    # Solicitação de FEVEREIRO, arquivo de JANEIRO
    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 2, 1),
                      periodo_fim=date(2026, 2, 28), tipo_planilha=None, status="pendente")
    db_session.add(sol)
    db_session.commit()

    pipeline = ProcessingPipelineService(db_session)
    with pytest.raises(ValidationException) as exc:
        pipeline.process_solicitacao(sol.id, sped_file_bytes=SPED_JANEIRO.encode("utf-8"))

    assert "01/2026" in str(exc.value) or "01/01/2026" in str(exc.value)


def test_pipeline_aceita_sped_da_competencia_correta(db_session, create_sample_excel_template):
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.empresa import Empresa
    from app.models.regra_aliquota import RegraAliquotaDestino
    from app.models.solicitacao import Solicitacao
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.templates_admin.template_manager import TemplateManager

    template_path = create_sample_excel_template(tipo="antecipacao_parcial")
    with open(template_path, "rb") as f:
        TemplateManager.upload_new_template_version(
            db=db_session, tipo="antecipacao_parcial", filename="t.xlsx", file_bytes=f.read(),
            mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
            promover_ativo=True,
        )

    perfil = PerfilRegras(nome="Perfil Periodo SPED OK")
    db_session.add(perfil)
    db_session.commit()
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195", uf="BA",
                      perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                      periodo_fim=date(2026, 1, 31), tipo_planilha=None, status="pendente")
    db_session.add(sol)
    db_session.commit()

    pipeline = ProcessingPipelineService(db_session)
    res = pipeline.process_solicitacao(sol.id, sped_file_bytes=SPED_JANEIRO.encode("utf-8"))
    assert res.status == "concluido"
```

- [x] **Step 2: Rodar e confirmar que falham**

Run: `python -m pytest tests/test_sped_periodo.py -q`
Expected: FAIL — `AttributeError: type object 'SpedFiscalExtractor' has no attribute 'extract_periodo'` nos dois primeiros; `test_pipeline_bloqueia_sped_de_competencia_divergente` falha por não levantar exceção (`DID NOT RAISE`).

- [x] **Step 3: Implementar `extract_periodo`**

Em `app/services/extraction/sped_fiscal_extractor.py`, acrescentar o método logo após `_parse_sped_decimal` (antes de `extract_from_sped`):

```python
    @staticmethod
    def extract_periodo(sped_content: bytes) -> tuple:
        """
        Lê o período de escrituração declarado no registro 0000 (campo 4 = DT_INI,
        campo 5 = DT_FIN) sem processar o arquivo inteiro.

        Devolve (date, date) ou (None, None) se o registro 0000 não existir ou as
        datas forem inválidas.
        """
        text = SpedFiscalExtractor._decode_content(sped_content)
        for line in text.splitlines():
            line_str = line.strip()
            if not line_str.startswith("|"):
                continue
            fields = line_str.split("|")
            if len(fields) > 5 and fields[1].strip().upper() == "0000":
                dt_ini = SpedFiscalExtractor._parse_sped_date(fields[4])
                dt_fim = SpedFiscalExtractor._parse_sped_date(fields[5])
                return dt_ini, dt_fim
        return None, None
```

Ajustar o import de tipagem no topo do arquivo (linha 4) para incluir `Tuple`:

```python
from typing import List, Dict, Any, Optional, Tuple
```

E trocar a anotação de retorno para ficar explícita:

```python
    def extract_periodo(sped_content: bytes) -> Tuple[Optional[date], Optional[date]]:
```

- [x] **Step 4: Validar no pipeline**

Em `app/services/pipeline_service.py`, logo após o bloco que levanta `"Nenhum arquivo XML de NF-e ou SPED Fiscal foi enviado"` e **antes** do parse da planilha de entradas, inserir:

```python
        # Guarda de competência: a partir do momento em que a ausência de uma nota no SPED
        # passa a significar "mercadoria ainda não entrou", subir o arquivo do mês errado
        # deixaria de ser inofensivo e passaria a jogar a apuração inteira na planilha
        # errada, sem sintoma visível. Por isso o período declarado no registro 0000
        # precisa ter interseção com o período da solicitação.
        if sped_file_bytes:
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
```

- [x] **Step 5: Rodar os testes da task**

Run: `python -m pytest tests/test_sped_periodo.py -q`
Expected: 4 passed

- [x] **Step 6: Checkpoint — suíte completa**

Run: `python -m pytest tests/ -q`
Expected: 62 passed. Atenção especial a `tests/test_end_to_end_sped.py` e `tests/test_regra_interestadual.py`, cujos SPEDs de exemplo declaram `|0000|...|01012026|31012026|` e cujas solicitações são de janeiro/2026 — devem continuar passando. Se algum falhar por período, é porque o SPED de teste e a solicitação divergem e o teste precisa ser corrigido, não a validação.

---

### Task 3: Unir as fontes XML + SPED na mesma rodada

Hoje o pipeline usa `if/elif`: quando os dois são enviados, o SPED vence e **os XMLs são descartados em silêncio**. Esta task troca isso pela união das duas fontes. Ainda sem reclassificação — ao fim, notas só-XML entram na apuração normal.

**Files:**
- Modify: `tests/conftest.py` (fixtures compartilhadas do cenário XML × SPED)
- Modify: `app/services/pipeline_service.py:93-102` (bloco de extração) e imports
- Test: `tests/test_uniao_fontes.py`
- **Não mexer:** `app/api/endpoints/solicitacoes.py` já lê `files` e `sped_file` de forma independente e repassa **os dois** para `process_solicitacao`. A exclusividade entre fontes existe apenas no `if/elif` do pipeline e no seletor do front — o endpoint não precisa de alteração alguma.

**Interfaces:**
- Consumes: o tipo `"antecipacao_parcial_antecipado"` da Task 1 (só para montar templates no cenário de teste).
- Produces:
  - método estático `ProcessingPipelineService._chaves_cruzamento(nf) -> List[str]`, devolvendo as chaves candidatas (`"chave:<44 dígitos>"` e/ou `"tupla:<cnpj>|<serie>|<numero>"`) de uma `ExtractedNFData`.
  - fixtures de `tests/conftest.py` reutilizadas pela Task 4: `build_xml_nfe(numero, chave, valor, dia, cfop="6102") -> bytes`, `sped_janeiro_com_nf901`, `xml_nf901`, `xml_nf902`, e a factory `cenario_janeiro(tipos=(...)) -> Solicitacao`.
  - **Invariante da qual a Task 4 depende:** após a união, `nf_data.origem_extracao == "sped"` significa que a nota consta do SPED da competência, e `"xml"` significa que **não** consta.

- [x] **Step 1: Adicionar as fixtures compartilhadas ao conftest**

As fixtures vivem em `tests/conftest.py` — é onde o repositório já mantém `sample_xml_nfe` e `create_sample_excel_template`, e evita que a Task 4 tenha que importar de um módulo de teste. Acrescentar ao final de `tests/conftest.py`:

```python
def build_xml_nfe(numero: str, chave: str, valor: str, dia: str, cfop: str = "6102") -> bytes:
    """XML de NF-e mínimo e válido, emitido por fornecedor de SP para cliente da BA em janeiro/2026."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{chave}">
      <ide><nNF>{numero}</nNF><serie>1</serie><dhEmi>2026-01-{dia}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>{valor}</vNF><vBC>{valor}</vBC></ICMSTot></total>
      <det nItem="1">
        <prod><NCM>21069090</NCM><CFOP>{cfop}</CFOP><vProd>{valor}</vProd>
          <vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><vBC>{valor}</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


CHAVE_NF901 = "35260198765432000180550010000009011000000901"
CHAVE_NF902 = "35260198765432000180550010000009021000000902"
CHAVE_NF903 = "35260198765432000180550010000009031000000903"

# SPED de janeiro/2026 contendo APENAS a NF 901: é a única cuja mercadoria entrou no mês.
_SPED_JANEIRO_COM_NF901 = """|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|
|0200|P1|PRODUTO|||UN|01|21069090|||18,00||
|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO|1,000|UN|2000,00|0,00|0|000|6102||2000,00|12,00|240,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
"""


@pytest.fixture
def sped_janeiro_com_nf901() -> bytes:
    return _SPED_JANEIRO_COM_NF901.encode("utf-8")


@pytest.fixture
def xml_nf901() -> bytes:
    return build_xml_nfe("901", CHAVE_NF901, "2000.00", "10")


@pytest.fixture
def xml_nf902() -> bytes:
    return build_xml_nfe("902", CHAVE_NF902, "3000.00", "28")


@pytest.fixture
def xml_nf903_difal() -> bytes:
    return build_xml_nfe("903", CHAVE_NF903, "500.00", "29", cfop="6556")


@pytest.fixture
def cenario_janeiro(db_session, create_sample_excel_template):
    """
    Monta perfil de regras, empresa da BA, alíquota padrão 18% e uma solicitação de
    janeiro/2026 em modo automático (tipo_planilha=None), com templates ativos para
    os tipos pedidos. Devolve a Solicitacao pronta para processar.
    """
    from decimal import Decimal
    from datetime import date
    from app.models.perfil_regras import PerfilRegras
    from app.models.empresa import Empresa
    from app.models.regra_aliquota import RegraAliquotaDestino
    from app.models.solicitacao import Solicitacao
    from app.services.templates_admin.template_manager import TemplateManager

    def _montar(tipos=("antecipacao_parcial", "antecipacao_parcial_antecipado")):
        for tipo in tipos:
            path = create_sample_excel_template(tipo=tipo)
            with open(path, "rb") as f:
                TemplateManager.upload_new_template_version(
                    db=db_session, tipo=tipo, filename=f"t_{tipo}.xlsx", file_bytes=f.read(),
                    mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
                    promover_ativo=True,
                )

        perfil = PerfilRegras(nome="Perfil Cenario Janeiro")
        db_session.add(perfil)
        db_session.commit()
        db_session.add(RegraAliquotaDestino(
            perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
        db_session.commit()

        empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195", uf="BA",
                          perfil_regras_id=perfil.id)
        db_session.add(empresa)
        db_session.commit()

        sol = Solicitacao(empresa_id=empresa.id, periodo_inicio=date(2026, 1, 1),
                          periodo_fim=date(2026, 1, 31), tipo_planilha=None, status="pendente")
        db_session.add(sol)
        db_session.commit()
        return sol

    return _montar
```

- [x] **Step 2: Escrever os testes que falham**

Criar `tests/test_uniao_fontes.py`:

```python
from app.services.pipeline_service import ProcessingPipelineService


def test_nota_presente_nas_duas_fontes_nao_duplica(
        db_session, cenario_janeiro, xml_nf901, sped_janeiro_com_nf901):
    """A NF 901 está no XML e no SPED. Deve ser apurada UMA vez, não duas."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    numeros = [n.numero_nota for n in res.notas_processadas]
    assert numeros.count("901") == 1


def test_nota_so_no_xml_entra_na_apuracao(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """Antes desta task os XMLs eram descartados quando havia SPED. Agora a 902 tem que aparecer."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_nota_so_no_sped_entra_na_apuracao(
        db_session, cenario_janeiro, xml_nf902, sped_janeiro_com_nf901):
    """A 901 está só no SPED (XML não baixado da SEFAZ). Ela foi emitida e entrou em
    janeiro, então não pode sumir da apuração só porque faltou o XML."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_cruzamento_por_cnpj_serie_numero_quando_falta_a_chave(
        db_session, cenario_janeiro, xml_nf901, sped_janeiro_com_nf901):
    """Se a chave de acesso faltar no XML, o cruzamento cai para CNPJ+série+número.
    Sem essa reserva a mesma NF-e seria contada duas vezes e o imposto sairia em dobro."""
    from tests.conftest import CHAVE_NF901

    sol = cenario_janeiro()
    xml_sem_chave = xml_nf901.replace(f'Id="NFe{CHAVE_NF901}"'.encode(), b'Id=""')

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_sem_chave)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    numeros = [n.numero_nota for n in res.notas_processadas]
    assert numeros.count("901") == 1


def test_apenas_xmls_continua_funcionando(
        db_session, cenario_janeiro, xml_nf901, xml_nf902):
    """Quem só envia XML não deve notar diferença nenhuma."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)])
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]
```

- [x] **Step 3: Rodar e confirmar que falham**

Run: `python -m pytest tests/test_uniao_fontes.py -q`
Expected: FAIL em `test_nota_so_no_xml_entra_na_apuracao` (`assert ['901'] == ['901', '902']`) e em `test_nota_so_no_sped_entra_na_apuracao` (`assert ['901'] == ['901', '902']`) — é o `if/elif` descartando os XMLs quando há SPED. Os outros três já passam.

- [x] **Step 4: Importar o normalizador no pipeline**

Em `app/services/pipeline_service.py`, na linha de import do matcher (linha 18), acrescentar `DataEntradaNormalizer`:

```python
from app.services.extraction.data_entrada_matcher import PlanilhaEntradaParser, DataEntradaMatcher, PlanilhaEntradaRecord, DataEntradaNormalizer
```

- [x] **Step 5: Adicionar o helper de chaves de cruzamento**

Em `app/services/pipeline_service.py`, dentro da classe `ProcessingPipelineService`, logo após `__init__`:

```python
    @staticmethod
    def _chaves_cruzamento(nf: Any) -> List[str]:
        """
        Chaves candidatas para reconhecer a MESMA NF-e vinda do XML e do SPED.

        Duas chaves, não uma: se o cruzamento falhar, a nota entra pela via do SPED e
        de novo pela via do XML, sai nas duas planilhas e o imposto é cobrado em dobro.
        A chave de acesso é a identificação inequívoca; CNPJ+série+número é a reserva
        para quando ela vier ausente ou malformada em uma das fontes.
        """
        chaves: List[str] = []

        chave_acesso = DataEntradaNormalizer.normalize_chave(nf.chave_acesso)
        if chave_acesso:
            chaves.append("chave:" + chave_acesso)

        cnpj = DataEntradaNormalizer.normalize_cnpj(nf.cnpj_emitente)
        numero = DataEntradaNormalizer.normalize_numero(nf.numero_nota)
        serie = DataEntradaNormalizer.normalize_serie(nf.serie).lstrip("0")
        if cnpj and numero:
            chaves.append(f"tupla:{cnpj}|{serie}|{numero}")

        return chaves
```

- [x] **Step 6: Trocar o `if/elif` pela união**

Em `app/services/pipeline_service.py`, substituir o bloco de extração (linhas 93-102) por:

```python
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
            chaves_sped = set()
            for nf_item in notas_sped:
                chaves_sped.update(self._chaves_cruzamento(nf_item))

            for filename, xml_bytes in xml_files_bytes:
                nf_item = self.extractor.extract_from_xml(xml_bytes)
                if any(k in chaves_sped for k in self._chaves_cruzamento(nf_item)):
                    # Já entrou pela via do SPED; incluir de novo duplicaria a apuração.
                    continue
                raw_nfs.append((filename, nf_item))
```

- [x] **Step 7: Rodar os testes da task**

Run: `python -m pytest tests/test_uniao_fontes.py -q`
Expected: 5 passed

- [x] **Step 8: Checkpoint — suíte completa**

Run: `python -m pytest tests/ -q`
Expected: 67 passed.

---

### Task 4: Rotear as notas ausentes do SPED para "Pago Antecipadamente"

A funcionalidade em si. Notas emitidas na competência que **não** constam do SPED da mesma competência têm seus itens de antecipação parcial roteados para o tipo novo.

**Files:**
- Modify: `app/services/pipeline_service.py` (cálculo do flag e reclassificação no roteamento)
- Test: `tests/test_pago_antecipadamente.py`

**Interfaces:**
- Consumes: o tipo `"antecipacao_parcial_antecipado"` registrado na Task 1; as fixtures `cenario_janeiro`, `xml_nf901`, `xml_nf902`, `xml_nf903_difal` e `sped_janeiro_com_nf901` adicionadas ao `conftest.py` na Task 3; a invariante de `origem_extracao` estabelecida na Task 3.
- Produces: comportamento final; nenhuma nova assinatura.

- [x] **Step 1: Escrever os testes que falham**

Criar `tests/test_pago_antecipadamente.py`:

```python
from app.services.pipeline_service import ProcessingPipelineService

TIPOS = ("antecipacao_parcial", "antecipacao_parcial_antecipado", "difal")


def test_nota_ausente_do_sped_vai_para_planilha_separada(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """901 está no SPED (entrou em janeiro) -> planilha normal.
    902 não está (mercadoria ainda não entrou) -> Pago Antecipadamente."""
    sol = cenario_janeiro(tipos=TIPOS)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    destino_por_nota = {n.numero_nota: n.destino_planilha for n in res.notas_processadas}
    assert destino_por_nota["901"] == "antecipacao_parcial"
    assert destino_por_nota["902"] == "antecipacao_parcial_antecipado"

    saidas = {s.tipo: s for s in res.saidas}
    assert saidas["antecipacao_parcial"].arquivo_path is not None
    assert saidas["antecipacao_parcial"].total_notas == 1
    assert saidas["antecipacao_parcial_antecipado"].arquivo_path is not None
    assert saidas["antecipacao_parcial_antecipado"].total_notas == 1


def test_sem_sped_tudo_vai_para_a_planilha_normal(
        db_session, cenario_janeiro, xml_nf901, xml_nf902):
    """Sem SPED não há como saber o que entrou — 'ausente do SPED' não informa nada."""
    sol = cenario_janeiro(tipos=TIPOS)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)])
    db_session.refresh(res)

    assert {n.destino_planilha for n in res.notas_processadas} == {"antecipacao_parcial"}
    assert "antecipacao_parcial_antecipado" not in {s.tipo for s in res.saidas}


def test_difal_nao_se_desdobra_mesmo_ausente_do_sped(
        db_session, cenario_janeiro, xml_nf903_difal, sped_janeiro_com_nf901):
    """Só a Antecipação Parcial se desdobra; DIFAL vai para a planilha normal dele."""
    sol = cenario_janeiro(tipos=TIPOS)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("903.xml", xml_nf903_difal)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    destino_por_nota = {n.numero_nota: n.destino_planilha for n in res.notas_processadas}
    assert destino_por_nota["903"] == "difal"


def test_modo_legado_nao_se_desdobra(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """Solicitação criada com tipo explícito mantém o comportamento antigo: uma planilha só."""
    sol = cenario_janeiro(tipos=TIPOS)
    sol.tipo_planilha = "antecipacao_parcial"
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert {n.destino_planilha for n in res.notas_processadas} == {"antecipacao_parcial"}
```

- [x] **Step 2: Rodar e confirmar que falham**

Run: `python -m pytest tests/test_pago_antecipadamente.py -q`
Expected: `test_nota_ausente_do_sped_vai_para_planilha_separada` FAIL com `assert 'antecipacao_parcial' == 'antecipacao_parcial_antecipado'`. Os outros três já passam (ainda não há desdobramento algum).

- [x] **Step 3: Calcular o flag por nota**

Em `app/services/pipeline_service.py`, dentro do laço `for filename, nf_data in raw_nfs:`, logo após o bloco que resolve `data_entrada_resolvida`/`origem_data` (antes do comentário "6. Roteamento por CFOP"), inserir:

```python
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
```

- [x] **Step 4: Reclassificar no roteamento**

No laço `for item in nf_data.itens:`, logo após a linha que descarta CFOPs sem regra e antes do bloco `if modo_legado and destino_item != solicitacao.tipo_planilha:`, inserir:

```python
                    if destino_item == "antecipacao_parcial" and pago_antecipadamente:
                        destino_item = "antecipacao_parcial_antecipado"
```

- [x] **Step 5: Rodar os testes da task**

Run: `python -m pytest tests/test_pago_antecipadamente.py -q`
Expected: 4 passed

- [x] **Step 6: Checkpoint — suíte completa**

Run: `python -m pytest tests/ -q`
Expected: 71 passed.

- [x] **Step 7: Conferir a planilha gerada de verdade**

Rodar `tests/test_pago_antecipadamente.py::test_nota_ausente_do_sped_vai_para_planilha_separada` e abrir no Excel o arquivo cujo nome contém `antecipacao_parcial_antecipado` em `storage/outputs/`. Confirmar que ele traz **apenas** a NF 902 e que as fórmulas de total continuam nativas (o `FormulaGuard` já falharia o processamento se alguma tivesse sido sobrescrita, então o teste real é o arquivo abrir com os somatórios calculando).

---

### Task 5: Frontend — duas fontes na mesma rodada e a quarta planilha

**Files:**
- Modify: `frontend/src/types/solicitacao.ts:38` (união `TipoPlanilha`)
- Modify: `frontend/src/pages/NovaSolicitacao/index.tsx` (seletor de fonte, rótulos, validações)
- Test: `npx tsc --noEmit -p tsconfig.app.json` e `npm run build`

**Interfaces:**
- Consumes: o valor `"antecipacao_parcial_antecipado"` que a API passa a devolver em `saidas[].tipo` e `notas_processadas[].destino_planilha`.
- Produces: nenhuma nova interface consumida por outras tasks.

- [x] **Step 1: Ampliar a união de tipos**

Em `frontend/src/types/solicitacao.ts`, linha 38:

```typescript
export type TipoPlanilha = 'antecipacao_parcial' | 'antecipacao_parcial_antecipado' | 'antecipacao_tributaria' | 'difal';
```

- [x] **Step 2: Registrar nome e cor da quarta planilha**

Em `frontend/src/pages/NovaSolicitacao/index.tsx`, nos dois mapas do topo do arquivo:

```typescript
const NOMES_PLANILHA: Record<TipoPlanilha, string> = {
  antecipacao_parcial: 'Antecipação Parcial',
  antecipacao_parcial_antecipado: 'Antecipação Parcial — Pago Antecipadamente',
  antecipacao_tributaria: 'Antecipação Tributária',
  difal: 'DIFAL (Diferencial de Alíquota)',
};

const BADGE_PLANILHA: Record<TipoPlanilha, 'info' | 'purple' | 'success' | 'warning'> = {
  antecipacao_parcial: 'info',
  antecipacao_parcial_antecipado: 'warning',
  antecipacao_tributaria: 'purple',
  difal: 'success',
};
```

- [x] **Step 3: Verificar a tipagem antes de mexer no seletor**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
Expected: sem saída (os `Record<TipoPlanilha, ...>` agora cobrem os quatro casos).

- [x] **Step 4: Trocar o seletor exclusivo por duas áreas independentes**

Hoje o passo 3 do wizard força uma escolha entre XML e SPED (`fonteDados`), o que impede exatamente o envio conjunto de que a funcionalidade depende. O estado `fonteDados` aparece em 13 pontos do arquivo; localize-os com `grep -n "fonteDados" frontend/src/pages/NovaSolicitacao/index.tsx` e aplique as substituições abaixo, na ordem.

**4a.** Apagar a declaração do estado (linha 59):

```typescript
  const [fonteDados, setFonteDados] = useState<'xml' | 'sped'>('xml');
```

**4b.** Em `handleGerarPlanilha`, substituir as duas validações por uma só:

```typescript
    // antes: dois ifs separados testando fonteDados === 'xml' / 'sped'
    if (xmlFiles.length === 0 && !spedFile) {
      setErrorMessage('Envie os XMLs de NF-e, o arquivo SPED Fiscal, ou ambos.');
      return;
    }
```

**4c.** Na chamada de processamento, enviar sempre as duas fontes:

```typescript
      const solicitacaoProcessada = await solicitacoesApi.processar(
        solicitacaoCriada.id,
        xmlFiles.length > 0 ? xmlFiles : undefined,
        planilhaEntradaFile,
        spedFile ?? undefined
      );
```

**4d.** Apagar o bloco inteiro do seletor de fonte — a `<div className="flex p-1 bg-slate-100 rounded-lg border border-slate-200">` que contém os dois `<button>` com `onClick={() => setFonteDados('xml')}` e `onClick={() => setFonteDados('sped')}`.

**4e.** Tornar as duas áreas de upload incondicionais. Trocar a abertura `{fonteDados === 'xml' && (` por um cabeçalho de seção, e o fechamento `)}` correspondente por `</div>`:

```tsx
            {/* Fonte 1: XMLs de NF-e da competência */}
            <div className="space-y-2">
```

Fazer o mesmo com `{fonteDados === 'sped' && (`:

```tsx
            {/* Fonte 2: SPED Fiscal da MESMA competência */}
            <div className="space-y-2">
```

Nos rótulos dessas seções, trocar "(Obrigatório)" por "(opcional se enviar o SPED)" na área de XMLs, e acrescentar "(opcional)" na de SPED.

**4f.** No texto de ajuda da planilha auxiliar de datas de entrada, substituir o ternário sobre `fonteDados` pelo texto fixo da versão sem SPED (o ramo `fonteDados === 'sped'` deixa de existir):

```tsx
                {'Se você tiver a exportação do sistema contábil (Prosoft ou similar) com as datas de entrada das notas, anexe aqui para preencher automaticamente. Caso não possua, o sistema usará a data de emissão ou deixará para preenchimento manual.'}
```

**4g.** No `disabled` do botão que avança do passo 3 para o 4:

```typescript
                disabled={xmlFiles.length === 0 && !spedFile}
```

**4h.** No resumo do passo 4, substituir os dois blocos que liam `fonteDados` por uma listagem das fontes efetivamente anexadas:

```tsx
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">Fontes anexadas:</span>
                      <span className="font-bold text-blue-900 font-mono text-sm text-right">
                        {[
                          xmlFiles.length > 0 ? `${xmlFiles.length} XML(s)` : null,
                          spedFile ? `SPED (${spedFile.name})` : null,
                        ].filter(Boolean).join(' + ')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">Datas de entrada contábeis:</span>
                      {spedFile ? (
                        <span className="font-semibold text-indigo-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Extração nativa do SPED (Registro C100)
                        </span>
                      ) : planilhaEntradaFile ? (
                        <span className="font-semibold text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {planilhaEntradaFile.name}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Ordenação por data de emissão</span>
                      )}
                    </div>
```

- [x] **Step 5: Explicar o cruzamento na tela**

Acrescentar, acima das duas áreas de upload do passo 3, uma nota que torna a regra visível para o contador — sem ela, o usuário não tem como saber por que uma nota foi parar na planilha separada:

```tsx
<div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
  Envie os <strong>XMLs da competência</strong> e o <strong>SPED Fiscal do mesmo mês</strong> para
  separar automaticamente a planilha <strong>Antecipação Parcial — Pago Antecipadamente</strong>:
  as notas emitidas no período que não constarem do SPED ainda não deram entrada no estabelecimento
  e são apuradas em arquivo próprio. Enviando apenas os XMLs, todas entram na planilha normal.
</div>
```

- [x] **Step 6: Verificar tipagem e build**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`
Expected: sem saída. Se sobrar erro de `fonteDados` não usado, é referência remanescente ao estado removido — apagar.

Run: `cd frontend && npm run build`
Expected: `✓ built in ...`

- [x] **Step 7: Checkpoint final**

Run: `python -m pytest tests/ -q`
Expected: 71 passed.

Subir a aplicação (`uvicorn app.main:app --reload --port 8000` e `npm run dev` no `frontend/`) e rodar o wizard uma vez com XMLs + SPED reais da mesma competência, conferindo que aparecem os cards das planilhas geradas, incluindo a "Pago Antecipadamente", e que o download individual e o `.zip` funcionam.

---

## Verificação final

1. **Migração:** `python -m alembic current` → `006_parcial_antecipado (head)`.
2. **Suíte:** `python -m pytest tests/ -q` → 71 passed.
3. **Frontend:** `npm run build` sem erros.
4. **Conferência fiscal (o que de fato valida a funcionalidade):** pegar uma competência já apurada manualmente pela contabilidade em que existam notas com entrada no mês seguinte, rodar com os XMLs e o SPED daquele mês, e comparar linha a linha a planilha "Pago Antecipadamente" gerada com a preenchida à mão — conferindo em especial que nenhuma NF-e aparece simultaneamente nela e na planilha de Antecipação Parcial normal.
