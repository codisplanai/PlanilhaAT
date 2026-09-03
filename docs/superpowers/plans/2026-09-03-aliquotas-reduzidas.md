# Alíquotas Reduzidas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Permitir que a alíquota de destino (A.DST) seja reduzida por termo de acordo da empresa e por enquadramento de produto (NCM + descrição), sem alterar o comportamento de quem não cadastrar nada.

**Architecture:** Três níveis de precedência resolvidos por `AliquotaResolver` — redução por produto (perfil + NCM + descrição), termo de acordo (empresa), e o padrão atual por UF/NCM, que fica intocado. Cada nível tem sua própria tabela. O casamento por descrição é isolado em um módulo de funções puras. A camada de cálculo não é tocada: a redução é representada como uma A.DST efetiva menor sobre o valor cheio.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 1.4 (estilo `Column`/`relationship`), Pydantic v1 (`validator`, `orm_mode`), Alembic, pytest, SQLite em memória nos testes. Frontend React 19 + TypeScript, TanStack Query, react-hook-form + zod, Tailwind, Vite.

**Spec:** `docs/superpowers/specs/2026-09-03-aliquotas-reduzidas-design.md`

## Global Constraints

- **Precedência fixa:** redução por produto > termo de acordo > padrão da UF.
- **`regras_aliquotas_destino` é intocada** — nenhuma coluna, índice ou migração de dados. Quem não cadastrar nada tem o comportamento atual bit a bit.
- **A camada de cálculo não muda.** `Débito = V.Total × A.DST` permanece.
- **A estrutura de linhas da planilha gerada não muda.** A chave de agrupamento em `pipeline_service.py` continua `(destino, a_ori, a_dst, ncm, cest)`.
- **Determinístico:** nada é perguntado ao usuário durante o processamento. Produto não cadastrado usa a alíquota normal.
- **Conflito de regras falha o processamento**, com mensagem contendo o item, as regras que colidiram e a instrução de cadastrar exceção.
- **Colunas `vigencia_inicio` / `vigencia_fim`** existem no banco mas **não são expostas** em schema Pydantic, endpoint ou tela.
- **Sem endpoint de simulação** — cortado do escopo.
- Mensagens de erro e rótulos de UI em **português**.
- Frontend **não tem framework de testes**. A verificação é `npm run build` (roda `tsc -b`) e `npm run lint`.
- Commits em português, seguindo o padrão do repositório (`feat:`, `fix:`, `refactor:`, `test:`).

---

### Task 1: Matcher de descrição

Funções puras de normalização e casamento de termos. Sem banco, sem imports do app — é a parte mais frágil do motor e precisa ser testável isoladamente.

**Files:**
- Create: `app/services/rules_engine/descricao_matcher.py`
- Test: `tests/test_descricao_matcher.py`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizar(texto: Optional[str]) -> str`
  - `casa_termo(descricao_normalizada: str, termo: str) -> bool`
  - `casa_algum(descricao_normalizada: str, termos: Optional[List[str]]) -> bool`

- [x] **Step 1: Escrever os testes que falham**

Criar `tests/test_descricao_matcher.py`:

```python
from app.services.rules_engine.descricao_matcher import casa_algum, casa_termo, normalizar


def test_normalizar_remove_acento_pontuacao_e_caixa():
    assert normalizar("Vergalhão CA-50 10,0mm") == "VERGALHAO CA 50 10 0MM"


def test_normalizar_texto_ausente_vira_string_vazia():
    assert normalizar(None) == ""
    assert normalizar("   ") == ""
    assert normalizar("---") == ""


def test_pontuacao_diferente_converge_para_a_mesma_forma():
    assert normalizar("VERG. CA50") == normalizar("VERG CA50")


def test_termo_casa_token_completo():
    assert casa_termo(normalizar("Vergalhão CA-50"), "vergalhao") is True


def test_termo_nao_casa_pedaco_de_palavra():
    # "ferro" dentro de "FERROVIARIO" não é o produto "ferro"
    assert casa_termo(normalizar("Dormente ferroviario"), "ferro") is False
    assert casa_termo(normalizar("Tecido acolchoado"), "aco") is False


def test_termo_singular_nao_casa_plural_sem_wildcard():
    assert casa_termo(normalizar("Vergalhoes CA-50"), "vergalhao") is False


def test_wildcard_casa_prefixo():
    assert casa_termo(normalizar("Vergalhões CA-50"), "vergalh*") is True
    assert casa_termo(normalizar("Vergalhão CA-50"), "vergalh*") is True


def test_wildcard_nao_casa_prefixo_mais_curto():
    assert casa_termo(normalizar("Verga de madeira"), "vergalh*") is False


def test_termo_multi_token_exige_sequencia_contigua():
    assert casa_termo(normalizar("VERG CA 50 10MM"), "verg ca") is True
    assert casa_termo(normalizar("VERG 10MM CA"), "verg ca") is False


def test_termo_com_acento_cadastrado_casa_descricao_sem_acento():
    assert casa_termo(normalizar("VERGALHAO CA 50"), "vergalhão") is True


def test_casa_algum_com_lista_vazia_ou_nula_e_falso():
    assert casa_algum(normalizar("Vergalhao"), []) is False
    assert casa_algum(normalizar("Vergalhao"), None) is False


def test_casa_algum_encontra_o_segundo_termo():
    assert casa_algum(normalizar("VG CA50 10.0"), ["vergalhao", "vg ca50"]) is True
```

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_descricao_matcher.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.services.rules_engine.descricao_matcher'`

- [x] **Step 3: Implementar**

Criar `app/services/rules_engine/descricao_matcher.py`:

```python
"""Normalização e casamento de descrições de produto.

Funções puras, sem banco: decidir enquadramento a partir de texto livre escrito
pelo emitente é a parte mais frágil do motor de regras, e precisa ser testável
isoladamente.
"""

import re
import unicodedata
from typing import List, Optional

_NAO_ALFANUM = re.compile(r"[^A-Z0-9]+")


def normalizar(texto: Optional[str]) -> str:
    """Reduz uma descrição a tokens comparáveis.

    Sem acento, em maiúsculas, com pontuação virando espaço — é o que faz
    "VERG. CA50" e "VERG CA50" convergirem para a mesma forma.
    """
    if not texto:
        return ""
    decomposto = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in decomposto if not unicodedata.combining(c))
    return _NAO_ALFANUM.sub(" ", sem_acento.upper()).strip()


def _compilar(termo_normalizado: str, prefixo: bool) -> "re.Pattern[str]":
    tokens = termo_normalizado.split()
    corpo = r"\s+".join(re.escape(t) for t in tokens)
    fim = "" if prefixo else r"(?![A-Z0-9])"
    return re.compile(rf"(?<![A-Z0-9]){corpo}{fim}")


def casa_termo(descricao_normalizada: str, termo: str) -> bool:
    """True se o termo aparece como sequência de tokens completos na descrição.

    Casar por substring seria armadilha: "ferro" pegaria "FERROVIARIO" e "aco"
    pegaria "ACOLCHOADO". Um '*' no fim do termo libera o casamento por prefixo,
    então "vergalh*" casa VERGALHAO e VERGALHOES mas não casa VERGA.
    """
    bruto = (termo or "").strip()
    prefixo = bruto.endswith("*")
    if prefixo:
        bruto = bruto[:-1]
    alvo = normalizar(bruto)
    if not alvo or not descricao_normalizada:
        return False
    return _compilar(alvo, prefixo).search(descricao_normalizada) is not None


def casa_algum(descricao_normalizada: str, termos: Optional[List[str]]) -> bool:
    return any(casa_termo(descricao_normalizada, t) for t in (termos or []))
```

- [x] **Step 4: Rodar para confirmar que passa**

Run: `python -m pytest tests/test_descricao_matcher.py -v`
Expected: PASS — 13 testes.

- [x] **Step 5: Commit**

```bash
git add app/services/rules_engine/descricao_matcher.py tests/test_descricao_matcher.py
git commit -m "feat(rules): adiciona matcher de descricao por token com wildcard de prefixo"
```

---

### Task 2: Modelos e migração

As três tabelas novas. `regras_aliquotas_destino` não é tocada.

**Files:**
- Create: `app/models/regra_reducao_produto.py`
- Create: `app/models/regra_aliquota_empresa.py`
- Create: `alembic/versions/010_aliquotas_reduzidas.py`
- Modify: `app/models/__init__.py`
- Modify: `app/models/perfil_regras.py` (adicionar relacionamento)
- Modify: `app/models/empresa.py` (adicionar relacionamento)
- Test: `tests/test_camada1_config.py` (estender)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `RegraReducaoProduto` — campos `id, perfil_regras_id, ncm, termos_inclusao, termos_exclusao, aliquota, descricao, vigencia_inicio, vigencia_fim, criado_em, atualizado_em`; relacionamentos `perfil_regras`, `excecoes`.
  - `ExcecaoReducaoProduto` — campos `id, regra_reducao_id, descricao_exata, enquadrado, observacao, criado_em, atualizado_em`; relacionamento `regra`.
  - `RegraAliquotaEmpresa` — campos `id, empresa_id, aliquota, descricao, vigencia_inicio, vigencia_fim, criado_em, atualizado_em`; relacionamento `empresa`.
  - `PerfilRegras.regras_reducao_produto` (lista), `Empresa.regras_aliquotas_empresa` (lista).

- [x] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `tests/test_camada1_config.py`:

```python
def test_mesmo_ncm_aceita_mais_de_uma_regra_de_reducao(db_session):
    """O mesmo NCM comporta produtos que se enquadram e produtos que não:
    7214.20 tem vergalhão a 12% e barra chata a 18%."""
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Reducao")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"), descricao="Vergalhoes"))
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["barra chata"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas"))
    db_session.commit()

    regras = db_session.query(RegraReducaoProduto).filter(
        RegraReducaoProduto.ncm == "72142000").all()
    assert len(regras) == 2


def test_excecao_nao_aceita_descricao_duplicada_na_mesma_regra(db_session):
    from decimal import Decimal
    from sqlalchemy.exc import IntegrityError
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Excecao")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"))
    db_session.add(regra)
    db_session.commit()

    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.commit()

    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=True))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_empresa_tem_no_maximo_um_termo_de_acordo(db_session):
    from decimal import Decimal
    from sqlalchemy.exc import IntegrityError
    from app.models.empresa import Empresa
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa

    perfil = PerfilRegras(nome="Perfil Acordo")
    db_session.add(perfil)
    db_session.commit()
    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195",
                      uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()

    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()

    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1000")))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_excluir_regra_de_reducao_leva_as_excecoes_junto(db_session):
    from decimal import Decimal
    from app.models.perfil_regras import PerfilRegras
    from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto

    perfil = PerfilRegras(nome="Perfil Cascade")
    db_session.add(perfil)
    db_session.commit()

    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["vergalh*"], termos_exclusao=[],
        aliquota=Decimal("0.1200"))
    regra.excecoes.append(ExcecaoReducaoProduto(
        descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.add(regra)
    db_session.commit()

    db_session.delete(regra)
    db_session.commit()
    assert db_session.query(ExcecaoReducaoProduto).count() == 0
```

Conferir que `import pytest` já existe no topo de `tests/test_camada1_config.py`; se não existir, adicionar.

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_camada1_config.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.models.regra_reducao_produto'`

- [x] **Step 3: Criar os modelos**

Criar `app/models/regra_reducao_produto.py`:

```python
from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Index,
    Integer, JSON, Numeric, String, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraReducaoProduto(Base):
    """Redução de alíquota condicionada a NCM + descrição do produto (nível 1).

    A lista vem de documento oficial do estado, então o escopo é o perfil de
    regras — é a mesma para todos os contribuintes daquele perfil.
    """

    __tablename__ = "regras_reducao_produto"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    perfil_regras_id = Column(
        Integer, ForeignKey("perfis_regras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ncm = Column(String(8), nullable=False, index=True)
    termos_inclusao = Column(JSON, default=list, nullable=False)
    termos_exclusao = Column(JSON, default=list, nullable=False)
    aliquota = Column(Numeric(6, 4), nullable=False)
    descricao = Column(String(255), nullable=True)
    # Reservados: existem no schema para que ligar vigência depois não exija
    # migração de dados. Não expostos em schema Pydantic, endpoint nem tela.
    vigencia_inicio = Column(Date, nullable=True)
    vigencia_fim = Column(Date, nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    perfil_regras = relationship("PerfilRegras", back_populates="regras_reducao_produto")
    excecoes = relationship(
        "ExcecaoReducaoProduto", back_populates="regra", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Sem índice único em (perfil, ncm): o mesmo NCM comporta várias regras
        # com termos diferentes. Duplicata literal é validada na camada de API.
        Index("ix_reducao_perfil_ncm", "perfil_regras_id", "ncm"),
        CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_reducao_aliquota_intervalo"),
    )


class ExcecaoReducaoProduto(Base):
    """Carimbo manual sobre uma descrição exata, avaliado antes dos termos.

    Serve nos dois sentidos: ``enquadrado=False`` para o item que casa os termos
    mas não se enquadra ("VERGALHAO DE COBRE"), e ``enquadrado=True`` para o que
    se enquadra mas nenhum termo razoável pegaria ("VG CA50 10.0").
    """

    __tablename__ = "excecoes_reducao_produto"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    regra_reducao_id = Column(
        Integer, ForeignKey("regras_reducao_produto.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    descricao_exata = Column(String(255), nullable=False)
    enquadrado = Column(Boolean, nullable=False)
    observacao = Column(String(255), nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    regra = relationship("RegraReducaoProduto", back_populates="excecoes")

    __table_args__ = (
        UniqueConstraint("regra_reducao_id", "descricao_exata", name="uq_excecao_regra_descricao"),
    )
```

Criar `app/models/regra_aliquota_empresa.py`:

```python
from sqlalchemy import (
    CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, Numeric, String,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.time import utcnow_naive


class RegraAliquotaEmpresa(Base):
    """Termo de acordo / regime especial: A.DST própria da empresa (nível 2).

    Sem coluna ``uf``: o escopo já é uma empresa, que tem uma UF só em
    ``empresas.uf``. Repetir criaria fonte de divergência.
    """

    __tablename__ = "regras_aliquotas_empresa"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # Único: uma empresa tem no máximo um termo de acordo. Ligar vigência no
    # futuro troca esta restrição por (empresa_id, vigencia_inicio).
    empresa_id = Column(
        Integer, ForeignKey("empresas.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    aliquota = Column(Numeric(6, 4), nullable=False)
    descricao = Column(String(255), nullable=True)
    vigencia_inicio = Column(Date, nullable=True)
    vigencia_fim = Column(Date, nullable=True)
    criado_em = Column(DateTime, default=utcnow_naive, nullable=False)
    atualizado_em = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    empresa = relationship("Empresa", back_populates="regras_aliquotas_empresa")

    __table_args__ = (
        CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_aliquota_empresa_intervalo"),
    )
```

- [x] **Step 4: Ligar os relacionamentos e o registro dos modelos**

Em `app/models/perfil_regras.py`, acrescentar depois da linha `regras_cfop = relationship(...)`:

```python
    regras_reducao_produto = relationship(
        "RegraReducaoProduto", back_populates="perfil_regras", cascade="all, delete-orphan"
    )
```

Em `app/models/empresa.py`, acrescentar depois da linha `solicitacoes = relationship(...)`:

```python
    regras_aliquotas_empresa = relationship(
        "RegraAliquotaEmpresa", back_populates="empresa", cascade="all, delete-orphan"
    )
```

Em `app/models/__init__.py`, acrescentar os imports depois de `from app.models.regra_aliquota import RegraAliquotaDestino`:

```python
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto
```

e as entradas em `__all__`, depois de `"RegraAliquotaDestino",`:

```python
    "RegraAliquotaEmpresa",
    "RegraReducaoProduto",
    "ExcecaoReducaoProduto",
```

- [x] **Step 5: Rodar para confirmar que passa**

Run: `python -m pytest tests/test_camada1_config.py -v`
Expected: PASS — os 2 testes existentes e os 4 novos.

Se `test_excecao_nao_aceita_descricao_duplicada_na_mesma_regra` ou `test_empresa_tem_no_maximo_um_termo_de_acordo` não levantarem `IntegrityError`, o SQLite não está aplicando a restrição — confirme que `UniqueConstraint` / `unique=True` estão nos modelos exatamente como acima e que `Base.metadata.create_all` rodou depois da alteração (a fixture `db_session` recria o schema a cada teste).

- [x] **Step 6: Escrever a migração**

Criar `alembic/versions/010_aliquotas_reduzidas.py`:

```python
"""Alíquotas reduzidas: termo de acordo por empresa e redução por produto.

Revision ID: 010_aliquotas_reduzidas
Revises: 009_integrity_constraints
Create Date: 2026-09-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010_aliquotas_reduzidas"
down_revision: Union[str, None] = "009_integrity_constraints"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regras_reducao_produto",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("perfil_regras_id", sa.Integer(), nullable=False),
        sa.Column("ncm", sa.String(length=8), nullable=False),
        sa.Column("termos_inclusao", sa.JSON(), nullable=False),
        sa.Column("termos_exclusao", sa.JSON(), nullable=False),
        sa.Column("aliquota", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("vigencia_inicio", sa.Date(), nullable=True),
        sa.Column("vigencia_fim", sa.Date(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["perfil_regras_id"], ["perfis_regras.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_reducao_aliquota_intervalo"),
    )
    op.create_index("ix_regras_reducao_produto_id", "regras_reducao_produto", ["id"])
    op.create_index("ix_regras_reducao_produto_ncm", "regras_reducao_produto", ["ncm"])
    op.create_index(
        "ix_regras_reducao_produto_perfil_regras_id", "regras_reducao_produto", ["perfil_regras_id"]
    )
    op.create_index("ix_reducao_perfil_ncm", "regras_reducao_produto", ["perfil_regras_id", "ncm"])

    op.create_table(
        "excecoes_reducao_produto",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("regra_reducao_id", sa.Integer(), nullable=False),
        sa.Column("descricao_exata", sa.String(length=255), nullable=False),
        sa.Column("enquadrado", sa.Boolean(), nullable=False),
        sa.Column("observacao", sa.String(length=255), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["regra_reducao_id"], ["regras_reducao_produto.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("regra_reducao_id", "descricao_exata", name="uq_excecao_regra_descricao"),
    )
    op.create_index("ix_excecoes_reducao_produto_id", "excecoes_reducao_produto", ["id"])
    op.create_index(
        "ix_excecoes_reducao_produto_regra_reducao_id", "excecoes_reducao_produto", ["regra_reducao_id"]
    )

    op.create_table(
        "regras_aliquotas_empresa",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("empresa_id", sa.Integer(), nullable=False),
        sa.Column("aliquota", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("descricao", sa.String(length=255), nullable=True),
        sa.Column("vigencia_inicio", sa.Date(), nullable=True),
        sa.Column("vigencia_fim", sa.Date(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["empresa_id"], ["empresas.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("empresa_id", name="uq_termo_acordo_empresa"),
        sa.CheckConstraint("aliquota >= 0 AND aliquota <= 1", name="ck_aliquota_empresa_intervalo"),
    )
    op.create_index("ix_regras_aliquotas_empresa_id", "regras_aliquotas_empresa", ["id"])
    op.create_index(
        "ix_regras_aliquotas_empresa_empresa_id", "regras_aliquotas_empresa", ["empresa_id"]
    )


def downgrade() -> None:
    op.drop_table("regras_aliquotas_empresa")
    op.drop_table("excecoes_reducao_produto")
    op.drop_table("regras_reducao_produto")
```

- [x] **Step 7: Verificar a migração**

Run: `python -m alembic heads`
Expected: uma única head, `010_aliquotas_reduzidas`.

Run: `python -m pytest tests/test_schema_lifecycle.py -v`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add app/models/regra_reducao_produto.py app/models/regra_aliquota_empresa.py \
        app/models/__init__.py app/models/perfil_regras.py app/models/empresa.py \
        alembic/versions/010_aliquotas_reduzidas.py tests/test_camada1_config.py
git commit -m "feat(db): adiciona tabelas de reducao por produto e termo de acordo"
```

---

### Task 3: Schemas e validador compartilhado

Extrai os validadores duplicados de `regra_aliquota.py` e cria os schemas das entidades novas.

**Files:**
- Create: `app/schemas/validators.py`
- Create: `app/schemas/regra_reducao_produto.py`
- Create: `app/schemas/regra_aliquota_empresa.py`
- Modify: `app/schemas/regra_aliquota.py`
- Test: `tests/test_camada1_config.py` (estender)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `app.schemas.validators.clean_ncm(v: Optional[str]) -> Optional[str]`
  - `app.schemas.validators.normalizar_aliquota(v: Optional[Decimal]) -> Optional[Decimal]`
  - `app.schemas.validators.clean_ncm_obrigatorio(v: str) -> str`
  - `RegraReducaoCreate`, `RegraReducaoUpdate`, `RegraReducaoOut`, `ExcecaoReducaoCreate`, `ExcecaoReducaoOut`
  - `TermoAcordoUpsert`, `TermoAcordoOut`

- [x] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `tests/test_camada1_config.py`:

```python
def test_schema_converte_aliquota_percentual_para_decimal():
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    payload = RegraReducaoCreate(
        perfil_regras_id=1, ncm="72142000", termos_inclusao=["vergalh*"], aliquota=Decimal("12.00"))
    assert payload.aliquota == Decimal("0.12")


def test_schema_rejeita_ncm_sentinela_do_sped():
    import pytest as _pytest
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    with _pytest.raises(ValueError):
        RegraReducaoCreate(
            perfil_regras_id=1, ncm="00000000",
            termos_inclusao=["vergalh*"], aliquota=Decimal("0.12"))


def test_schema_rejeita_lista_de_termos_vazia():
    import pytest as _pytest
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    with _pytest.raises(ValueError):
        RegraReducaoCreate(
            perfil_regras_id=1, ncm="72142000", termos_inclusao=[], aliquota=Decimal("0.12"))


def test_schema_normaliza_termos_e_descarta_vazios():
    from decimal import Decimal
    from app.schemas.regra_reducao_produto import RegraReducaoCreate

    payload = RegraReducaoCreate(
        perfil_regras_id=1, ncm="72142000",
        termos_inclusao=["  Vergalhão*  ", "", "  "], aliquota=Decimal("0.12"))
    assert payload.termos_inclusao == ["VERGALHAO*"]


def test_schema_de_excecao_normaliza_a_descricao():
    from app.schemas.regra_reducao_produto import ExcecaoReducaoCreate

    payload = ExcecaoReducaoCreate(descricao_exata="Vergalhão de Cobre", enquadrado=False)
    assert payload.descricao_exata == "VERGALHAO DE COBRE"


def test_schema_de_termo_de_acordo_converte_percentual():
    from decimal import Decimal
    from app.schemas.regra_aliquota_empresa import TermoAcordoUpsert

    payload = TermoAcordoUpsert(aliquota=Decimal("12.06"), descricao="Termo 123/2025")
    assert payload.aliquota == Decimal("0.1206")
```

O wildcard `*` sobrevive à normalização de termos porque ele é retirado antes de
`normalizar()` dentro de `casa_termo`. Aqui a normalização do termo preserva o
sufixo: `"  Vergalhão*  "` vira `"VERGALHAO*"`.

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_camada1_config.py -v -k schema`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.schemas.regra_reducao_produto'`

- [x] **Step 3: Criar o módulo de validadores compartilhados**

Criar `app/schemas/validators.py`:

```python
"""Validadores reutilizados pelos schemas de regras de alíquota."""

import re
from decimal import Decimal
from typing import List, Optional

from app.services.rules_engine.descricao_matcher import normalizar

# NCM que o extrator do SPED usa quando o item não consta no registro 0200.
# É ausência de dado, não NCM: uma regra cadastrada nele capturaria tudo o que
# o SPED não conseguiu identificar.
NCM_SENTINELA = "00000000"


def clean_ncm(v: Optional[str]) -> Optional[str]:
    """NCM de 8 dígitos, ou None para 'regra padrão do estado'."""
    if v is None or v.strip() == "":
        return None
    cleaned = re.sub(r"\D", "", v)
    if len(cleaned) != 8:
        raise ValueError("NCM deve conter 8 dígitos ou ser vazio/nulo para regra padrão do estado")
    return cleaned


def clean_ncm_obrigatorio(v: str) -> str:
    """NCM de 8 dígitos, obrigatório e diferente do sentinela do SPED."""
    cleaned = clean_ncm(v)
    if cleaned is None:
        raise ValueError("NCM é obrigatório na regra de redução por produto")
    if cleaned == NCM_SENTINELA:
        raise ValueError(
            "NCM 00000000 é o marcador de item sem NCM no SPED e não pode ter regra de redução"
        )
    return cleaned


def normalizar_aliquota(v: Optional[Decimal]) -> Optional[Decimal]:
    """Aceita 0.1206 e 12.06, devolvendo sempre a forma decimal unitária."""
    if v is None:
        return None
    if v < 0 or v > 1:
        if 1 < v <= 100:
            return v / Decimal("100")
        raise ValueError("Alíquota deve estar entre 0 e 1 (ex: 0.1800)")
    return v


def normalizar_termos(termos: Optional[List[str]]) -> List[str]:
    """Normaliza cada termo preservando o wildcard de prefixo e descarta vazios."""
    limpos: List[str] = []
    for termo in termos or []:
        bruto = (termo or "").strip()
        prefixo = bruto.endswith("*")
        if prefixo:
            bruto = bruto[:-1]
        alvo = normalizar(bruto)
        if not alvo:
            continue
        limpos.append(f"{alvo}*" if prefixo else alvo)
    return limpos
```

- [x] **Step 4: Apontar `regra_aliquota.py` para os validadores compartilhados**

Em `app/schemas/regra_aliquota.py`, remover a definição local de `clean_ncm`
(linhas 8-15) e o corpo dos quatro validadores de alíquota, substituindo o topo
do arquivo por:

```python
from typing import Optional, Dict, Any
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field, validator
from app.schemas.empresa import VALID_UFS
from app.schemas.validators import clean_ncm, normalizar_aliquota

# Reexportado: integrações e testes existentes importam clean_ncm daqui.
__all__ = ["clean_ncm", "RegraAliquotaBase", "RegraAliquotaCreate",
           "RegraAliquotaUpdate", "RegraAliquotaOut"]
```

e trocar os corpos dos dois `validate_aliquota` (em `RegraAliquotaBase` e em
`RegraAliquotaUpdate`) por:

```python
    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)
```

O `import re` no topo pode sair se nada mais no arquivo o usar.

- [x] **Step 5: Criar os schemas novos**

Criar `app/schemas/regra_reducao_produto.py`:

```python
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, validator

from app.schemas.validators import clean_ncm_obrigatorio, normalizar_aliquota, normalizar_termos
from app.services.rules_engine.descricao_matcher import normalizar


class ExcecaoReducaoCreate(BaseModel):
    descricao_exata: str = Field(..., max_length=255, example="Vergalhão de Cobre")
    enquadrado: bool = Field(..., example=False)
    observacao: Optional[str] = Field(None, max_length=255)

    @validator("descricao_exata")
    def validate_descricao(cls, v):
        limpa = normalizar(v)
        if not limpa:
            raise ValueError("Descrição da exceção não pode ser vazia")
        return limpa

    class Config:
        extra = "forbid"


class ExcecaoReducaoOut(BaseModel):
    id: int
    regra_reducao_id: int
    descricao_exata: str
    enquadrado: bool
    observacao: Optional[str]
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class RegraReducaoBase(BaseModel):
    perfil_regras_id: int = Field(..., example=1)
    ncm: str = Field(..., example="72142000")
    termos_inclusao: List[str] = Field(..., example=["vergalh*"])
    termos_exclusao: List[str] = Field(default_factory=list, example=["cobre"])
    aliquota: Decimal = Field(..., example=0.1200)
    descricao: Optional[str] = Field(None, max_length=255, example="Vergalhões — Decreto 12.345")

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_obrigatorio(v)

    @validator("termos_inclusao")
    def validate_inclusao(cls, v):
        limpos = normalizar_termos(v)
        if not limpos:
            raise ValueError("Informe ao menos um termo de inclusão")
        return limpos

    @validator("termos_exclusao")
    def validate_exclusao(cls, v):
        return normalizar_termos(v)

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class RegraReducaoCreate(RegraReducaoBase):
    pass


class RegraReducaoUpdate(BaseModel):
    ncm: Optional[str] = None
    termos_inclusao: Optional[List[str]] = None
    termos_exclusao: Optional[List[str]] = None
    aliquota: Optional[Decimal] = None
    descricao: Optional[str] = None

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_obrigatorio(v) if v is not None else v

    @validator("termos_inclusao")
    def validate_inclusao(cls, v):
        if v is None:
            return v
        limpos = normalizar_termos(v)
        if not limpos:
            raise ValueError("Informe ao menos um termo de inclusão")
        return limpos

    @validator("termos_exclusao")
    def validate_exclusao(cls, v):
        return normalizar_termos(v) if v is not None else v

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class RegraReducaoOut(RegraReducaoBase):
    id: int
    excecoes: List[ExcecaoReducaoOut] = Field(default_factory=list)
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
```

Criar `app/schemas/regra_aliquota_empresa.py`:

```python
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, validator

from app.schemas.validators import normalizar_aliquota


class TermoAcordoUpsert(BaseModel):
    aliquota: Decimal = Field(..., example=0.1206)
    descricao: Optional[str] = Field(None, max_length=255, example="Termo de Acordo nº 123/2025")

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class TermoAcordoOut(BaseModel):
    id: int
    empresa_id: int
    aliquota: Decimal
    descricao: Optional[str]
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
```

- [x] **Step 6: Rodar para confirmar que passa**

Run: `python -m pytest tests/test_camada1_config.py tests/test_camada5_rules_engine.py -v`
Expected: PASS — inclusive os testes anteriores, que provam que a extração dos validadores não mudou comportamento.

- [x] **Step 7: Commit**

```bash
git add app/schemas/validators.py app/schemas/regra_reducao_produto.py \
        app/schemas/regra_aliquota_empresa.py app/schemas/regra_aliquota.py \
        tests/test_camada1_config.py
git commit -m "feat(schemas): adiciona schemas de reducao e termo de acordo com validadores compartilhados"
```

---

### Task 4: Resolver em três níveis

O núcleo. Muda o tipo de retorno de `resolve_a_dst` e atualiza o único call site em produção para manter a suíte verde.

**Files:**
- Modify: `app/services/rules_engine/aliquota_resolver.py` (reescrita completa)
- Modify: `app/services/pipeline_service.py:247` (ajuste mínimo)
- Test: `tests/test_camada5_rules_engine.py` (estender)

**Interfaces:**
- Consumes: `normalizar`, `casa_algum` (Task 1); `RegraReducaoProduto`, `ExcecaoReducaoProduto`, `RegraAliquotaEmpresa` (Task 2).
- Produces:
  - `ResolucaoAliquota` — dataclass congelada com `aliquota: Decimal`, `origem: str`, `detalhe: str`
  - `AliquotaResolver.resolve_a_dst(perfil_regras_id, uf, ncm=None, descricao=None, empresa_id=None) -> ResolucaoAliquota`
  - `AliquotaResolver.preload(perfil_regras_id, empresa_id=None) -> None`

- [x] **Step 1: Escrever os testes que falham**

Substituir o conteúdo de `tests/test_camada5_rules_engine.py` por:

```python
import pytest
from decimal import Decimal

from app.core.exceptions import RuleResolutionException
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto
from app.services.rules_engine.aliquota_resolver import AliquotaResolver


@pytest.fixture
def cenario(db_session):
    """Perfil BA com padrão 18%, exceção de NCM 20,5% e empresa vinculada."""
    perfil = PerfilRegras(nome="Perfil Teste BA")
    db_session.add(perfil)
    db_session.commit()

    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm=None, aliquota=Decimal("0.1800")))
    db_session.add(RegraAliquotaDestino(
        perfil_regras_id=perfil.id, uf="BA", ncm="84713012", aliquota=Decimal("0.2050")))
    db_session.commit()

    empresa = Empresa(razao_social="Cliente BA", cnpj="12345678000195",
                      uf="BA", perfil_regras_id=perfil.id)
    db_session.add(empresa)
    db_session.commit()
    return perfil, empresa


def _regra_vergalhao(db_session, perfil, aliquota="0.1200", exclusao=None):
    regra = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["VERGALH*"], termos_exclusao=exclusao or [],
        aliquota=Decimal(aliquota), descricao="Vergalhoes - Decreto 12.345")
    db_session.add(regra)
    db_session.commit()
    return regra


# --- Nível 3: comportamento atual, preservado -------------------------------

def test_rules_engine_precedencia_ncm(db_session, cenario):
    perfil, _ = cenario
    resolver = AliquotaResolver(db_session)

    assert resolver.resolve_a_dst(perfil.id, "BA", "84713012").aliquota == Decimal("0.2050")
    assert resolver.resolve_a_dst(perfil.id, "BA", "39269090").aliquota == Decimal("0.1800")

    with pytest.raises(RuleResolutionException) as exc_info:
        resolver.resolve_a_dst(perfil.id, "SP", "84713012")
    assert "Nenhuma regra de alíquota de destino" in str(exc_info.value)


def test_origem_identifica_o_nivel_que_resolveu(db_session, cenario):
    perfil, _ = cenario
    resolver = AliquotaResolver(db_session)

    assert resolver.resolve_a_dst(perfil.id, "BA", "39269090").origem.startswith("padrao_uf:")
    assert resolver.resolve_a_dst(perfil.id, "BA", "84713012").origem.startswith("regra_ncm:")


# --- Nível 2: termo de acordo ----------------------------------------------

def test_termo_de_acordo_vence_o_padrao_da_uf(db_session, cenario):
    perfil, empresa = cenario
    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "39269090", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1206")
    assert res.origem.startswith("termo_acordo:")


def test_sem_termo_de_acordo_cai_no_padrao(db_session, cenario):
    perfil, empresa = cenario
    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "39269090", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


# --- Nível 1: redução por produto ------------------------------------------

def test_reducao_por_produto_vence_o_termo_de_acordo(db_session, cenario):
    """O caso central: empresa com acordo de 12,06% comprando vergalhão a 12,00%."""
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil)
    db_session.add(RegraAliquotaEmpresa(empresa_id=empresa.id, aliquota=Decimal("0.1206")))
    db_session.commit()

    resolver = AliquotaResolver(db_session)

    vergalhao = resolver.resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VERGALHAO CA-50 10MM", empresa_id=empresa.id)
    assert vergalhao.aliquota == Decimal("0.1200")
    assert vergalhao.origem.startswith("reducao_produto:")

    outro = resolver.resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="BARRA CHATA 3/4", empresa_id=empresa.id)
    assert outro.aliquota == Decimal("0.1206")
    assert outro.origem.startswith("termo_acordo:")


def test_termo_de_exclusao_derruba_a_regra(db_session, cenario):
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil, exclusao=["COBRE"])

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VERGALHAO DE COBRE", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


def test_descricao_ausente_nunca_aplica_reducao(db_session, cenario):
    """SPED consolidado chega aqui: sem descrição real, nada é enquadrado."""
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil)

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao=None, empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


def test_excecao_negativa_derruba_para_o_nivel_seguinte(db_session, cenario):
    perfil, empresa = cenario
    regra = _regra_vergalhao(db_session, perfil)
    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VERGALHAO DE COBRE", enquadrado=False))
    db_session.commit()

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="Vergalhão de cobre", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1800")


def test_excecao_positiva_aplica_mesmo_sem_termo_casar(db_session, cenario):
    perfil, empresa = cenario
    regra = _regra_vergalhao(db_session, perfil)
    db_session.add(ExcecaoReducaoProduto(
        regra_reducao_id=regra.id, descricao_exata="VG CA50 10 0", enquadrado=True))
    db_session.commit()

    res = AliquotaResolver(db_session).resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VG CA50 10.0", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1200")
    assert res.origem.startswith("excecao:")


# --- Conflito ---------------------------------------------------------------

def test_conflito_de_regras_falha_com_mensagem_acionavel(db_session, cenario):
    perfil, empresa = cenario
    regra_a = _regra_vergalhao(db_session, perfil)
    regra_b = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["BARRA CHATA"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas")
    db_session.add(regra_b)
    db_session.commit()

    with pytest.raises(RuleResolutionException) as exc_info:
        AliquotaResolver(db_session).resolve_a_dst(
            perfil.id, "BA", "72142000",
            descricao="VERGALHAO BARRA CHATA 10MM", empresa_id=empresa.id)

    msg = str(exc_info.value)
    assert "VERGALHAO BARRA CHATA 10MM" in msg   # o item
    assert "72142000" in msg                      # o NCM
    assert f"#{regra_a.id}" in msg                # as regras que colidiram
    assert f"#{regra_b.id}" in msg
    assert "exceção" in msg.lower()               # a instrução


def test_duas_excecoes_para_a_mesma_descricao_tambem_conflitam(db_session, cenario):
    """O único é (regra, descrição), então duas regras do mesmo NCM podem carregar
    o mesmo texto. Nesse caso a alíquota da regra pai seria ambígua."""
    perfil, empresa = cenario
    regra_a = _regra_vergalhao(db_session, perfil)
    regra_b = RegraReducaoProduto(
        perfil_regras_id=perfil.id, ncm="72142000",
        termos_inclusao=["BARRA CHATA"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras chatas")
    db_session.add(regra_b)
    db_session.commit()

    for regra in (regra_a, regra_b):
        db_session.add(ExcecaoReducaoProduto(
            regra_reducao_id=regra.id, descricao_exata="PECA AMBIGUA", enquadrado=True))
    db_session.commit()

    with pytest.raises(RuleResolutionException) as exc_info:
        AliquotaResolver(db_session).resolve_a_dst(
            perfil.id, "BA", "72142000", descricao="Peça ambígua", empresa_id=empresa.id)
    assert "exceções" in str(exc_info.value)


def test_preload_resolve_sem_novas_consultas(db_session, cenario):
    perfil, empresa = cenario
    _regra_vergalhao(db_session, perfil)
    db_session.add(RegraAliquotaEmpresa(empresa_id=empresa.id, aliquota=Decimal("0.1206")))
    db_session.commit()

    resolver = AliquotaResolver(db_session)
    resolver.preload(perfil.id, empresa.id)

    res = resolver.resolve_a_dst(
        perfil.id, "BA", "72142000", descricao="VERGALHAO CA-50", empresa_id=empresa.id)
    assert res.aliquota == Decimal("0.1200")
```

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_camada5_rules_engine.py -v`
Expected: FAIL — `AttributeError: 'decimal.Decimal' object has no attribute 'aliquota'` nos primeiros testes, e `TypeError` de argumento inesperado nos demais.

- [x] **Step 3: Reescrever o resolver**

Substituir o conteúdo de `app/services/rules_engine/aliquota_resolver.py` por:

```python
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.exceptions import RuleResolutionException
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.services.rules_engine.descricao_matcher import casa_algum, normalizar


@dataclass(frozen=True)
class ResolucaoAliquota:
    """A alíquota de destino e a procedência dela.

    Com três níveis de precedência, saber qual alíquota saiu sem saber de onde
    inviabiliza a conferência fiscal. A origem é gravada em ``metadados_extras``
    da nota processada.
    """

    aliquota: Decimal
    origem: str
    detalhe: str


class AliquotaResolver:
    """Resolve a Alíquota de Destino (A.DST) em três níveis de precedência:

      1. Redução por produto — (perfil, NCM) + descrição do item
      2. Termo de acordo     — (empresa)
      3. Padrão do perfil    — (perfil, UF, NCM) e depois (perfil, UF)

    A.ORI nunca passa por este motor (vem direto do XML/SPED).

    Sem ``descricao`` e ``empresa_id`` os dois primeiros níveis são pulados e o
    comportamento é idêntico ao anterior à introdução das alíquotas reduzidas.
    """

    def __init__(self, db: Session):
        self.db = db
        self._perfil_preload: Optional[int] = None
        self._reducoes_por_ncm: Optional[Dict[str, List[RegraReducaoProduto]]] = None
        self._termos_acordo: Dict[int, Optional[RegraAliquotaEmpresa]] = {}

    # -- cache ---------------------------------------------------------------

    def preload(self, perfil_regras_id: int, empresa_id: Optional[int] = None) -> None:
        """Carrega em memória as regras usadas no processamento de uma solicitação.

        O resolver é chamado item a item dentro do loop de notas; sem isto, três
        níveis multiplicariam o número de consultas por item.
        """
        regras = (
            self.db.query(RegraReducaoProduto)
            .filter(RegraReducaoProduto.perfil_regras_id == perfil_regras_id)
            .all()
        )
        indexadas: Dict[str, List[RegraReducaoProduto]] = {}
        for regra in regras:
            indexadas.setdefault(regra.ncm, []).append(regra)
        self._reducoes_por_ncm = indexadas
        self._perfil_preload = perfil_regras_id

        if empresa_id is not None:
            self._termos_acordo[empresa_id] = (
                self.db.query(RegraAliquotaEmpresa)
                .filter(RegraAliquotaEmpresa.empresa_id == empresa_id)
                .first()
            )

    def _regras_reducao(self, perfil_regras_id: int, ncm: str) -> List[RegraReducaoProduto]:
        if self._reducoes_por_ncm is not None and perfil_regras_id == self._perfil_preload:
            return self._reducoes_por_ncm.get(ncm, [])
        return (
            self.db.query(RegraReducaoProduto)
            .filter(
                RegraReducaoProduto.perfil_regras_id == perfil_regras_id,
                RegraReducaoProduto.ncm == ncm,
            )
            .all()
        )

    def _termo_acordo(self, empresa_id: int) -> Optional[RegraAliquotaEmpresa]:
        if empresa_id not in self._termos_acordo:
            self._termos_acordo[empresa_id] = (
                self.db.query(RegraAliquotaEmpresa)
                .filter(RegraAliquotaEmpresa.empresa_id == empresa_id)
                .first()
            )
        return self._termos_acordo[empresa_id]

    # -- API pública ---------------------------------------------------------

    def resolve_a_dst(
        self,
        perfil_regras_id: int,
        uf: str,
        ncm: Optional[str] = None,
        descricao: Optional[str] = None,
        empresa_id: Optional[int] = None,
    ) -> ResolucaoAliquota:
        clean_uf = uf.strip().upper() if uf else ""
        clean_ncm = ncm.strip() if ncm else None

        reducao = self._nivel_reducao_produto(perfil_regras_id, clean_ncm, descricao)
        if reducao is not None:
            return reducao

        acordo = self._nivel_termo_acordo(empresa_id)
        if acordo is not None:
            return acordo

        return self._nivel_padrao(perfil_regras_id, clean_uf, clean_ncm)

    # -- níveis --------------------------------------------------------------

    def _nivel_reducao_produto(
        self, perfil_regras_id: int, ncm: Optional[str], descricao: Optional[str]
    ) -> Optional[ResolucaoAliquota]:
        if not ncm or not descricao:
            return None
        regras = self._regras_reducao(perfil_regras_id, ncm)
        if not regras:
            return None
        desc = normalizar(descricao)
        if not desc:
            return None

        casadas = [
            (regra, exc)
            for regra in regras
            for exc in regra.excecoes
            if exc.descricao_exata == desc
        ]
        if len(casadas) > 1:
            raise RuleResolutionException(
                self._msg_conflito(desc, ncm, [regra for regra, _ in casadas], "exceções")
            )
        if casadas:
            regra, excecao = casadas[0]
            if not excecao.enquadrado:
                return None
            return ResolucaoAliquota(
                aliquota=Decimal(str(regra.aliquota)),
                origem=f"excecao:{excecao.id}",
                detalhe=f"Exceção cadastrada na regra {self._rotulo(regra)}",
            )

        candidatas = [
            regra
            for regra in regras
            if casa_algum(desc, regra.termos_inclusao)
            and not casa_algum(desc, regra.termos_exclusao)
        ]
        if not candidatas:
            return None
        if len(candidatas) > 1:
            raise RuleResolutionException(self._msg_conflito(desc, ncm, candidatas, "regras"))

        regra = candidatas[0]
        return ResolucaoAliquota(
            aliquota=Decimal(str(regra.aliquota)),
            origem=f"reducao_produto:{regra.id}",
            detalhe=f"Redução por produto: {regra.descricao or f'regra #{regra.id}'}",
        )

    def _nivel_termo_acordo(self, empresa_id: Optional[int]) -> Optional[ResolucaoAliquota]:
        if empresa_id is None:
            return None
        regra = self._termo_acordo(empresa_id)
        if regra is None:
            return None
        return ResolucaoAliquota(
            aliquota=Decimal(str(regra.aliquota)),
            origem=f"termo_acordo:{regra.id}",
            detalhe=f"Termo de acordo da empresa: {regra.descricao or f'regra #{regra.id}'}",
        )

    def _nivel_padrao(
        self, perfil_regras_id: int, clean_uf: str, clean_ncm: Optional[str]
    ) -> ResolucaoAliquota:
        if clean_ncm:
            regra_ncm = (
                self.db.query(RegraAliquotaDestino)
                .filter(
                    RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                    RegraAliquotaDestino.uf == clean_uf,
                    RegraAliquotaDestino.ncm == clean_ncm,
                )
                .first()
            )
            if regra_ncm is not None:
                return ResolucaoAliquota(
                    aliquota=Decimal(str(regra_ncm.aliquota)),
                    origem=f"regra_ncm:{regra_ncm.id}",
                    detalhe=f"Exceção por NCM {clean_ncm} na UF {clean_uf}",
                )

        regra_padrao = (
            self.db.query(RegraAliquotaDestino)
            .filter(
                RegraAliquotaDestino.perfil_regras_id == perfil_regras_id,
                RegraAliquotaDestino.uf == clean_uf,
                or_(RegraAliquotaDestino.ncm == None, RegraAliquotaDestino.ncm == ""),  # noqa: E711
            )
            .first()
        )
        if regra_padrao is not None:
            return ResolucaoAliquota(
                aliquota=Decimal(str(regra_padrao.aliquota)),
                origem=f"padrao_uf:{regra_padrao.id}",
                detalhe=f"Alíquota padrão da UF {clean_uf}",
            )

        ncm_info = f" e NCM '{clean_ncm}'" if clean_ncm else ""
        raise RuleResolutionException(
            f"Nenhuma regra de alíquota de destino (A.DST) encontrada para UF '{clean_uf}'{ncm_info} no perfil de regras ID {perfil_regras_id}. "
            f"Cadastre a alíquota padrão ou a exceção para este estado."
        )

    # -- mensagens -----------------------------------------------------------

    @staticmethod
    def _rotulo(regra: RegraReducaoProduto) -> str:
        return f'#{regra.id} "{regra.descricao or "sem rótulo"}"'

    @classmethod
    def _msg_conflito(
        cls, desc: str, ncm: str, regras: List[RegraReducaoProduto], especie: str
    ) -> str:
        """Aponta o item, as regras que colidiram e o que fazer a respeito.

        Falhar em vez de escolher é deliberado: aplicar a alíquota errada em
        silêncio gera passivo que só aparece em fiscalização.
        """
        linhas = "\n".join(
            f"  {cls._rotulo(r)} ({Decimal(str(r.aliquota)) * 100:.2f}%) "
            f"— termos de inclusão: {', '.join(r.termos_inclusao)}"
            for r in regras
        )
        return (
            f'Conflito de regras de redução no item "{desc}" (NCM {ncm}).\n\n'
            f"Estas {especie} casaram o mesmo item:\n{linhas}\n\n"
            "Cadastre uma exceção com a descrição exata deste item na regra que "
            "deve prevalecer, para que o sistema saiba qual aplicar."
        )
```

- [x] **Step 4: Ajustar o call site do pipeline (mínimo, sem mudar comportamento)**

Em `app/services/pipeline_service.py`, na linha ~247, trocar:

```python
                    a_dst = self.resolver.resolve_a_dst(
                        perfil_regras_id=empresa.perfil_regras_id,
                        uf=empresa.uf,
                        ncm=item.ncm
                    )
```

por:

```python
                    resolucao = self.resolver.resolve_a_dst(
                        perfil_regras_id=empresa.perfil_regras_id,
                        uf=empresa.uf,
                        ncm=item.ncm
                    )
                    a_dst = resolucao.aliquota
```

A ligação com descrição, empresa e auditoria vem na Task 6.

- [x] **Step 5: Rodar a suíte inteira**

Run: `python -m pytest tests/test_camada5_rules_engine.py -v`
Expected: PASS — 13 testes.

Run: `python -m pytest -q`
Expected: PASS — nenhuma regressão. `test_rules_engine_precedencia_ncm` provar que os três asserts originais continuam válidos é o sinal de que nada mudou para quem não cadastra.

- [x] **Step 6: Commit**

```bash
git add app/services/rules_engine/aliquota_resolver.py app/services/pipeline_service.py \
        tests/test_camada5_rules_engine.py
git commit -m "feat(rules): resolve A.DST em tres niveis com origem auditavel"
```

---

### Task 5: Descrição confiável na extração

O SPED gera descrições sintéticas **não vazias** quando não há dados de item. Sem marcá-las, o matcher avaliaria `"Item Analítico C190 #1 (CFOP 2102)"` como se fosse descrição de produto.

**Files:**
- Modify: `app/services/extraction/base.py`
- Modify: `app/services/extraction/sped_fiscal_extractor.py:130` e `:144`
- Test: `tests/test_sped_fiscal_extractor.py` (estender)

**Interfaces:**
- Consumes: nada.
- Produces: `ExtractedItemNF.descricao_confiavel: bool` (default `True`).

- [x] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `tests/test_sped_fiscal_extractor.py`:

```python
def test_item_vindo_do_c170_tem_descricao_confiavel():
    from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
    from tests.conftest import _SPED_JANEIRO_COM_NF901

    notas = SpedFiscalExtractor().extract_from_bytes(
        _SPED_JANEIRO_COM_NF901.encode("utf-8"))
    itens = [i for nf in notas for i in nf.itens]
    assert itens
    assert all(i.descricao_confiavel for i in itens)


def test_item_sintetico_do_c190_nao_e_confiavel():
    """Sem C170 não há descrição real de produto — só o analítico por CFOP."""
    from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor

    sped_so_c190 = (
        "|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|\n"
        "|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|\n"
        "|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|"
        "10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|"
        "240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|\n"
        "|C190|000|6102|12,00|2000,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00||\n"
        "|9999|4|\n"
    ).encode("utf-8")

    notas = SpedFiscalExtractor().extract_from_bytes(sped_so_c190)
    itens = [i for nf in notas for i in nf.itens]
    assert itens
    assert all(not i.descricao_confiavel for i in itens)
```

Antes de rodar, confirmar o nome real do método de entrada do extrator (o teste
acima assume `extract_from_bytes`):

Run: `grep -n "def extract" app/services/extraction/sped_fiscal_extractor.py`

Se o nome for outro, ajustar as duas chamadas nos testes. Confirmar também que
`_SPED_JANEIRO_COM_NF901` é importável de `tests.conftest` — ele é um módulo de
nível superior no arquivo, então o import funciona.

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_sped_fiscal_extractor.py -v -k confiavel`
Expected: FAIL com `AttributeError: 'ExtractedItemNF' object has no attribute 'descricao_confiavel'`

- [x] **Step 3: Implementar**

Em `app/services/extraction/base.py`, dentro de `ExtractedItemNF`, logo depois da linha `descricao: str = ""`:

```python
    # False quando a descrição foi fabricada pelo extrator (SPED sem C170) em vez
    # de vir do documento. Regras de redução por produto ignoram esses itens: o
    # texto sintético não é descrição de mercadoria.
    descricao_confiavel: bool = True
```

Em `app/services/extraction/sped_fiscal_extractor.py`, no bloco que constrói itens a partir do C190 (linha ~130), acrescentar o campo:

```python
                        descricao=f"Item Analítico C190 #{idx} (CFOP {c190.get('cfop', '')})",
                        descricao_confiavel=False,
```

E no fallback da capa C100 (linha ~144):

```python
                    descricao=f"NF-e {current_c100['numero_nota']} (Consolidado SPED)",
                    descricao_confiavel=False,
```

O caminho do C170 (linha ~364) não muda — o default `True` já vale.

- [x] **Step 4: Rodar para confirmar que passa**

Run: `python -m pytest tests/test_sped_fiscal_extractor.py tests/test_end_to_end_sped.py -v`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/services/extraction/base.py app/services/extraction/sped_fiscal_extractor.py \
        tests/test_sped_fiscal_extractor.py
git commit -m "feat(extracao): marca descricoes sinteticas do SPED como nao confiaveis"
```

---

### Task 6: Pipeline — preload, descrição, auditoria e mensagem de erro

Liga tudo e corrige o handler que hoje engole a mensagem do resolver.

**Files:**
- Modify: `app/services/pipeline_service.py` (5 pontos)
- Test: `tests/test_reducao_produto_pipeline.py` (criar)

**Interfaces:**
- Consumes: `ResolucaoAliquota`, `AliquotaResolver.preload` (Task 4); `descricao_confiavel` (Task 5).
- Produces: `metadados_extras["origem_a_dst"]` (lista de strings) e `metadados_extras["detalhe_a_dst"]` (string) em cada `NotaFiscalProcessada`.

- [x] **Step 1: Escrever os testes que falham**

Criar `tests/test_reducao_produto_pipeline.py`:

```python
from decimal import Decimal

import pytest

from app.core.exceptions import RuleResolutionException
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.models.regra_reducao_produto import RegraReducaoProduto
from app.models.empresa import Empresa
from app.services.pipeline_service import ProcessingPipelineService

CHAVE = "35260198765432000180550010000009011000000901"


def _xml_dois_itens_mesmo_ncm() -> bytes:
    """NF-e com dois itens de NCM 72142000: um vergalhão, outro não."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe{CHAVE}">
      <ide><nNF>901</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>3000.00</vNF><vBC>3000.00</vBC></ICMSTot></total>
      <det nItem="1">
        <prod><NCM>72142000</NCM><CFOP>6102</CFOP><xProd>VERGALHAO CA-50 10MM</xProd>
          <vProd>1000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><vBC>1000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
      <det nItem="2">
        <prod><NCM>72142000</NCM><CFOP>6102</CFOP><xProd>BARRA CHATA 3/4</xProd>
          <vProd>2000.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro><vDesc>0.00</vDesc></prod>
        <imposto><ICMS><ICMS00><vBC>2000.00</vBC><pICMS>12.00</pICMS></ICMS00></ICMS></imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>""".encode("utf-8")


def _preparar(db_session, sol, aliquota_reducao="0.1200", termos=("VERGALH*",), exclusao=()):
    empresa = db_session.query(Empresa).filter(Empresa.id == sol.empresa_id).one()
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=empresa.perfil_regras_id, ncm="72142000",
        termos_inclusao=list(termos), termos_exclusao=list(exclusao),
        aliquota=Decimal(aliquota_reducao), descricao="Vergalhoes - Decreto 12.345"))
    db_session.add(RegraAliquotaEmpresa(
        empresa_id=empresa.id, aliquota=Decimal("0.1206"), descricao="Termo 123/2025"))
    db_session.commit()
    return empresa


def test_itens_do_mesmo_ncm_saem_com_aliquotas_diferentes(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    _preparar(db_session, sol)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])
    db_session.refresh(res)

    aliquotas = sorted(Decimal(str(n.a_dst_resolvida)) for n in res.notas_processadas)
    assert aliquotas == [Decimal("0.1200"), Decimal("0.1206")]


def test_metadados_registram_a_origem_da_aliquota(db_session, cenario_janeiro):
    sol = cenario_janeiro()
    _preparar(db_session, sol)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])
    db_session.refresh(res)

    por_aliquota = {
        Decimal(str(n.a_dst_resolvida)): n.metadados_extras for n in res.notas_processadas
    }
    assert any(o.startswith("reducao_produto:")
               for o in por_aliquota[Decimal("0.1200")]["origem_a_dst"])
    assert any(o.startswith("termo_acordo:")
               for o in por_aliquota[Decimal("0.1206")]["origem_a_dst"])
    assert "Vergalhoes" in por_aliquota[Decimal("0.1200")]["detalhe_a_dst"]


def test_sped_consolidado_nao_aplica_reducao(
        db_session, cenario_janeiro, sped_janeiro_com_nf901):
    """O SPED da fixture traz C170 com descrição 'PRODUTO', que não casa nenhum
    termo; a alíquota tem que cair no termo de acordo, nunca na redução."""
    sol = cenario_janeiro()
    _preparar(db_session, sol)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, sped_file_bytes=sped_janeiro_com_nf901)
    db_session.refresh(res)

    assert all(Decimal(str(n.a_dst_resolvida)) == Decimal("0.1206")
               for n in res.notas_processadas)


def test_conflito_interrompe_com_mensagem_que_chega_ao_usuario(db_session, cenario_janeiro):
    """Duas regras casando o mesmo item: falha, e a mensagem precisa sobreviver
    até solicitacao.mensagem_erro em vez de virar 'Falha interna'."""
    sol = cenario_janeiro()
    empresa = _preparar(db_session, sol)
    db_session.add(RegraReducaoProduto(
        perfil_regras_id=empresa.perfil_regras_id, ncm="72142000",
        termos_inclusao=["CA 50"], termos_exclusao=[],
        aliquota=Decimal("0.1800"), descricao="Barras CA 50"))
    db_session.commit()

    with pytest.raises(RuleResolutionException):
        ProcessingPipelineService(db_session).process_solicitacao(
            sol.id, xml_files_bytes=[("901.xml", _xml_dois_itens_mesmo_ncm())])

    db_session.refresh(sol)
    assert sol.status == "erro"
    assert "Conflito de regras" in (sol.mensagem_erro or "")
    assert "901" in (sol.mensagem_erro or "")
    assert "Falha interna" not in (sol.mensagem_erro or "")
```

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_reducao_produto_pipeline.py -v`
Expected: FAIL — as alíquotas saem todas iguais (a descrição ainda não é passada ao resolver) e `metadados_extras` não tem `origem_a_dst`.

- [x] **Step 3: Chamar o preload antes do loop de notas**

Em `app/services/pipeline_service.py`, imediatamente antes da linha `for filename, nf_data in raw_nfs:` (~151):

```python
            # Carrega as regras dos três níveis uma vez: o resolver é chamado
            # item a item e sem isto faria consultas repetidas por nota.
            self.resolver.preload(empresa.perfil_regras_id, empresa.id)
```

- [x] **Step 4: Passar descrição e empresa, e capturar as resoluções por grupo**

Ainda em `pipeline_service.py`, trocar a declaração de `grupos` (~229) por:

```python
                grupos: Dict[Tuple[str, Decimal, Decimal, str, str], List[Any]] = {}
                resolucoes: Dict[Tuple[str, Decimal, Decimal, str, str], List[ResolucaoAliquota]] = {}
```

e acrescentar `ResolucaoAliquota` ao import já existente do resolver (linha 18):

```python
from app.services.rules_engine.aliquota_resolver import AliquotaResolver, ResolucaoAliquota
```

e substituir o bloco de resolução (~246) por:

```python
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
```

Logo abaixo, onde os grupos são preenchidos, acrescentar o registro da resolução:

```python
                    if key not in grupos:
                        grupos[key] = []
                        resolucoes[key] = []
                    grupos[key].append(item)
                    resolucoes[key].append(resolucao)
```

Acrescentar `RuleResolutionException` ao import da linha 12:

```python
from app.core.exceptions import ValidationException, NotFoundException, RuleResolutionException
```

- [x] **Step 5: Gravar a origem nos metadados**

Trocar o cabeçalho do loop de grupos (~272) para preservar a chave:

```python
                for grupo_key, itens_objs in grupos.items():
                    destino_grupo, a_ori, a_dst, _group_ncm, _group_cest = grupo_key
```

E dentro do bloco que monta `NotaFiscalProcessada` (~401), acrescentar as duas entradas em `metadados_extras`, logo depois de `"aliq_simples": aliq_simples,`:

```python
                            "origem_a_dst": sorted({r.origem for r in resolucoes.get(grupo_key, [])}),
                            "detalhe_a_dst": "; ".join(
                                sorted({r.detalhe for r in resolucoes.get(grupo_key, [])})
                            ),
```

A chave de agrupamento **não muda**: incluir a origem nela desdobraria a nota em
linhas extras quando duas origens diferentes dessem a mesma alíquota numérica.

- [x] **Step 6: Corrigir o handler que engole a mensagem**

Em `app/services/pipeline_service.py:502`, trocar:

```python
            solicitacao.mensagem_erro = str(exc) if isinstance(exc, ValidationException) else "Falha interna ao processar os arquivos."
```

por:

```python
            # RuleResolutionException herda de PlanilhaATException, não de
            # ValidationException: sem isto, toda mensagem de regra chegava ao
            # usuário como "Falha interna".
            solicitacao.mensagem_erro = (
                str(exc) if isinstance(exc, PlanilhaATException)
                else "Falha interna ao processar os arquivos."
            )
```

e acrescentar `PlanilhaATException` ao import da linha 12:

```python
from app.core.exceptions import (
    ValidationException, NotFoundException, RuleResolutionException, PlanilhaATException,
)
```

- [x] **Step 7: Rodar a suíte inteira**

Run: `python -m pytest tests/test_reducao_produto_pipeline.py -v`
Expected: PASS — 4 testes.

Run: `python -m pytest -q`
Expected: PASS, sem regressões. Atenção especial a `test_end_to_end.py`, `test_end_to_end_sped.py`, `test_pipeline_multi_planilha.py` e `test_consolidation.py` — são os que exercitam o agrupamento.

- [x] **Step 8: Commit**

```bash
git add app/services/pipeline_service.py tests/test_reducao_produto_pipeline.py
git commit -m "feat(pipeline): aplica reducao por produto e grava origem da aliquota"
```

---

### Task 7: Endpoints de reduções por produto

**Files:**
- Create: `app/api/endpoints/regras_reducao_produto.py`
- Modify: `app/api/router.py`
- Test: `tests/test_camada1_config.py` (estender)

**Interfaces:**
- Consumes: schemas da Task 3; modelos da Task 2.
- Produces: rotas sob `/api/v1/regras-reducao-produto`.

- [x] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `tests/test_camada1_config.py`:

```python
def _criar_perfil(client):
    res = client.post("/api/v1/perfis-regras", json={"nome": "Perfil API Reducao"})
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def test_api_cria_e_lista_regra_de_reducao(client):
    perfil_id = _criar_perfil(client)

    res = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "7214.20.00",
        "termos_inclusao": ["vergalh*"], "termos_exclusao": ["cobre"],
        "aliquota": 12.00, "descricao": "Vergalhoes"})
    assert res.status_code == 201, res.text
    criada = res.json()
    assert criada["ncm"] == "72142000"
    assert criada["termos_inclusao"] == ["VERGALH*"]
    assert float(criada["aliquota"]) == 0.12

    listagem = client.get(f"/api/v1/regras-reducao-produto?perfil_id={perfil_id}")
    assert listagem.status_code == 200
    assert len(listagem.json()) == 1


def test_api_rejeita_regra_duplicada_com_os_mesmos_termos(client):
    perfil_id = _criar_perfil(client)
    corpo = {"perfil_regras_id": perfil_id, "ncm": "72142000",
             "termos_inclusao": ["vergalh*"], "aliquota": 0.12}

    assert client.post("/api/v1/regras-reducao-produto", json=corpo).status_code == 201
    repetida = client.post("/api/v1/regras-reducao-produto", json=corpo)
    assert repetida.status_code == 409, repetida.text


def test_api_aceita_segundo_termo_para_o_mesmo_ncm(client):
    perfil_id = _criar_perfil(client)
    assert client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "72142000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12}).status_code == 201
    assert client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "72142000",
        "termos_inclusao": ["barra chata"], "aliquota": 0.18}).status_code == 201


def test_api_rejeita_ncm_sentinela(client):
    perfil_id = _criar_perfil(client)
    res = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "00000000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12})
    assert res.status_code == 422, res.text


def test_api_cria_e_remove_excecao(client):
    perfil_id = _criar_perfil(client)
    regra_id = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": perfil_id, "ncm": "72142000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12}).json()["id"]

    res = client.post(f"/api/v1/regras-reducao-produto/{regra_id}/excecoes", json={
        "descricao_exata": "Vergalhão de Cobre", "enquadrado": False,
        "observacao": "Cobre nao entra no decreto"})
    assert res.status_code == 201, res.text
    excecao = res.json()
    assert excecao["descricao_exata"] == "VERGALHAO DE COBRE"

    detalhe = client.get(f"/api/v1/regras-reducao-produto/{regra_id}")
    assert len(detalhe.json()["excecoes"]) == 1

    apagar = client.delete(
        f"/api/v1/regras-reducao-produto/{regra_id}/excecoes/{excecao['id']}")
    assert apagar.status_code == 204


def test_api_rejeita_perfil_inexistente(client):
    res = client.post("/api/v1/regras-reducao-produto", json={
        "perfil_regras_id": 9999, "ncm": "72142000",
        "termos_inclusao": ["vergalh*"], "aliquota": 0.12})
    assert res.status_code == 404, res.text
```

Antes de rodar, confirmar o caminho real do endpoint de perfis:

Run: `grep -n "prefix=" app/api/endpoints/perfis_regras.py`

Se o prefixo não for `/perfis-regras`, ajustar `_criar_perfil`.

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_camada1_config.py -v -k api_`
Expected: FAIL com 404 — as rotas não existem.

- [x] **Step 3: Implementar o endpoint**

Criar `app/api/endpoints/regras_reducao_produto.py`:

```python
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404
from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.perfil_regras import PerfilRegras
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto
from app.schemas.regra_reducao_produto import (
    ExcecaoReducaoCreate, ExcecaoReducaoOut, RegraReducaoCreate,
    RegraReducaoOut, RegraReducaoUpdate,
)

router = APIRouter(
    prefix="/regras-reducao-produto",
    tags=["Reduções por Produto (NCM + Descrição)"],
    dependencies=[Depends(get_current_user)],
)


def _conflita(db: Session, perfil_id: int, ncm: str, termos: List[str], ignorar_id: Optional[int] = None) -> bool:
    """Duplicata literal: mesmo perfil, mesmo NCM e mesmo conjunto de termos.

    Duas regras para o mesmo NCM são legítimas (vergalhão e barra chata); o que
    não pode é a mesma regra duas vezes.
    """
    query = db.query(RegraReducaoProduto).filter(
        RegraReducaoProduto.perfil_regras_id == perfil_id,
        RegraReducaoProduto.ncm == ncm,
    )
    if ignorar_id is not None:
        query = query.filter(RegraReducaoProduto.id != ignorar_id)
    alvo = sorted(termos)
    return any(sorted(r.termos_inclusao or []) == alvo for r in query.all())


@router.post("", response_model=RegraReducaoOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_admin)])
def criar_regra_reducao(payload: RegraReducaoCreate, db: Session = Depends(get_db)):
    perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil de regras não encontrado.")

    if _conflita(db, payload.perfil_regras_id, payload.ncm, payload.termos_inclusao):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra para o NCM '{payload.ncm}' com estes mesmos termos de inclusão.",
        )

    regra = RegraReducaoProduto(
        perfil_regras_id=payload.perfil_regras_id,
        ncm=payload.ncm,
        termos_inclusao=payload.termos_inclusao,
        termos_exclusao=payload.termos_exclusao,
        aliquota=payload.aliquota,
        descricao=payload.descricao,
    )
    db.add(regra)
    return commit_and_refresh(db, regra)


@router.get("", response_model=List[RegraReducaoOut])
def listar_regras_reducao(
    perfil_id: Optional[int] = None,
    ncm: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(RegraReducaoProduto)
    if perfil_id:
        query = query.filter(RegraReducaoProduto.perfil_regras_id == perfil_id)
    if ncm:
        query = query.filter(RegraReducaoProduto.ncm == ncm.strip())
    return query.all()


@router.get("/{id}", response_model=RegraReducaoOut)
def obter_regra_reducao(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")


@router.put("/{id}", response_model=RegraReducaoOut, dependencies=[Depends(require_admin)])
def atualizar_regra_reducao(id: int, payload: RegraReducaoUpdate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")

    if payload.ncm is not None:
        regra.ncm = payload.ncm
    if payload.termos_inclusao is not None:
        regra.termos_inclusao = payload.termos_inclusao
    if payload.termos_exclusao is not None:
        regra.termos_exclusao = payload.termos_exclusao
    if payload.aliquota is not None:
        regra.aliquota = payload.aliquota
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao

    if _conflita(db, regra.perfil_regras_id, regra.ncm, regra.termos_inclusao, ignorar_id=id):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra para o NCM '{regra.ncm}' com estes mesmos termos de inclusão.",
        )
    return commit_and_refresh(db, regra)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def deletar_regra_reducao(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")
    delete_and_commit(db, regra)


@router.post("/{id}/excecoes", response_model=ExcecaoReducaoOut,
             status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def criar_excecao(id: int, payload: ExcecaoReducaoCreate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")
    excecao = ExcecaoReducaoProduto(
        regra_reducao_id=regra.id,
        descricao_exata=payload.descricao_exata,
        enquadrado=payload.enquadrado,
        observacao=payload.observacao,
    )
    db.add(excecao)
    return commit_and_refresh(
        db, excecao, conflict_detail="Já existe uma exceção com esta descrição nesta regra."
    )


@router.delete("/{id}/excecoes/{excecao_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_admin)])
def deletar_excecao(id: int, excecao_id: int, db: Session = Depends(get_db)):
    excecao = get_by_id_or_404(db, ExcecaoReducaoProduto, excecao_id, "Exceção não encontrada.")
    if excecao.regra_reducao_id != id:
        raise HTTPException(status_code=404, detail="Exceção não pertence a esta regra.")
    delete_and_commit(db, excecao)
```

- [x] **Step 4: Registrar o router**

Em `app/api/router.py`, acrescentar o import depois de `regras_aliquotas`:

```python
from app.api.endpoints.regras_reducao_produto import router as regras_reducao_produto_router
```

e a entrada na tupla `ROUTERS`, depois de `regras_aliquotas_router,`:

```python
    regras_reducao_produto_router,
```

- [x] **Step 5: Rodar para confirmar que passa**

Run: `python -m pytest tests/test_camada1_config.py -v`
Expected: PASS.

Run: `python -m pytest -q`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add app/api/endpoints/regras_reducao_produto.py app/api/router.py tests/test_camada1_config.py
git commit -m "feat(api): expoe CRUD de reducoes por produto e suas excecoes"
```

---

### Task 8: Endpoint de termo de acordo

Pendurado em `/empresas/{id}` porque a cardinalidade é 1:1 — o frontend não precisa rastrear id separado.

**Files:**
- Modify: `app/api/endpoints/empresas.py`
- Modify: `app/schemas/empresa.py`
- Test: `tests/test_camada1_config.py` (estender)

**Interfaces:**
- Consumes: `TermoAcordoUpsert`, `TermoAcordoOut` (Task 3); `RegraAliquotaEmpresa` (Task 2).
- Produces: `PUT`/`DELETE /empresas/{id}/termo-acordo`; campo `termo_acordo` em `EmpresaOut`.

- [x] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `tests/test_camada1_config.py`:

```python
def _criar_empresa(client):
    perfil_id = _criar_perfil(client)
    res = client.post("/api/v1/empresas", json={
        "razao_social": "Cliente BA LTDA", "cnpj": "12345678000195",
        "uf": "BA", "perfil_regras_id": perfil_id})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_api_empresa_nasce_sem_termo_de_acordo(client):
    empresa_id = _criar_empresa(client)
    res = client.get(f"/api/v1/empresas/{empresa_id}")
    assert res.status_code == 200
    assert res.json()["termo_acordo"] is None


def test_api_upsert_de_termo_de_acordo_nao_duplica(client):
    empresa_id = _criar_empresa(client)

    primeiro = client.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={
        "aliquota": 12.06, "descricao": "Termo 123/2025"})
    assert primeiro.status_code == 200, primeiro.text
    assert float(primeiro.json()["aliquota"]) == 0.1206

    segundo = client.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={
        "aliquota": 0.1000, "descricao": "Termo 456/2026"})
    assert segundo.status_code == 200
    assert segundo.json()["id"] == primeiro.json()["id"]
    assert float(segundo.json()["aliquota"]) == 0.10

    empresa = client.get(f"/api/v1/empresas/{empresa_id}").json()
    assert empresa["termo_acordo"]["descricao"] == "Termo 456/2026"


def test_api_remove_termo_de_acordo(client):
    empresa_id = _criar_empresa(client)
    client.put(f"/api/v1/empresas/{empresa_id}/termo-acordo", json={"aliquota": 12.06})

    assert client.delete(f"/api/v1/empresas/{empresa_id}/termo-acordo").status_code == 204
    assert client.get(f"/api/v1/empresas/{empresa_id}").json()["termo_acordo"] is None


def test_api_remover_termo_inexistente_e_404(client):
    empresa_id = _criar_empresa(client)
    assert client.delete(f"/api/v1/empresas/{empresa_id}/termo-acordo").status_code == 404
```

- [x] **Step 2: Rodar para confirmar que falha**

Run: `python -m pytest tests/test_camada1_config.py -v -k termo`
Expected: FAIL — `KeyError: 'termo_acordo'` e 405/404 nas rotas.

- [x] **Step 3: Expor `termo_acordo` em `EmpresaOut`**

Em `app/schemas/empresa.py`, acrescentar o import no topo:

```python
from app.schemas.regra_aliquota_empresa import TermoAcordoOut
```

e o campo em `EmpresaOut`:

```python
class EmpresaOut(EmpresaBase):
    id: int
    termo_acordo: Optional[TermoAcordoOut] = None
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
```

- [x] **Step 4: Adicionar a propriedade no modelo**

Em `app/models/empresa.py`, depois do relacionamento adicionado na Task 2:

```python
    @property
    def termo_acordo(self):
        """O termo de acordo vigente, ou None.

        A relação é lista (preparada para o histórico por vigência), mas hoje o
        índice único em empresa_id garante no máximo um.
        """
        return self.regras_aliquotas_empresa[0] if self.regras_aliquotas_empresa else None
```

- [x] **Step 5: Implementar as rotas**

Em `app/api/endpoints/empresas.py`, acrescentar aos imports:

```python
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.schemas.regra_aliquota_empresa import TermoAcordoOut, TermoAcordoUpsert
```

e ao final do arquivo:

```python
@router.put("/{id}/termo-acordo", response_model=TermoAcordoOut, dependencies=[Depends(require_admin)])
def definir_termo_acordo(id: int, payload: TermoAcordoUpsert, db: Session = Depends(get_db)):
    """Cria ou substitui o termo de acordo da empresa.

    Upsert em vez de coleção porque a empresa tem no máximo um termo — o cliente
    não precisa rastrear um id separado.
    """
    empresa = get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")

    termo = (
        db.query(RegraAliquotaEmpresa)
        .filter(RegraAliquotaEmpresa.empresa_id == empresa.id)
        .first()
    )
    if termo is None:
        termo = RegraAliquotaEmpresa(empresa_id=empresa.id)
        db.add(termo)

    termo.aliquota = payload.aliquota
    termo.descricao = payload.descricao
    return commit_and_refresh(db, termo)


@router.delete("/{id}/termo-acordo", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_admin)])
def remover_termo_acordo(id: int, db: Session = Depends(get_db)):
    empresa = get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")
    termo = (
        db.query(RegraAliquotaEmpresa)
        .filter(RegraAliquotaEmpresa.empresa_id == empresa.id)
        .first()
    )
    if termo is None:
        raise HTTPException(status_code=404, detail="Esta empresa não possui termo de acordo.")
    delete_and_commit(db, termo)
```

- [x] **Step 6: Rodar para confirmar que passa**

Run: `python -m pytest tests/test_camada1_config.py -v`
Expected: PASS.

Run: `python -m pytest -q`
Expected: PASS. Se `test_header_inscricao_estadual.py` ou outros testes que serializam empresa falharem, verificar que `termo_acordo` está como `Optional[...] = None`.

- [x] **Step 7: Commit**

```bash
git add app/api/endpoints/empresas.py app/schemas/empresa.py app/models/empresa.py \
        tests/test_camada1_config.py
git commit -m "feat(api): permite cadastrar termo de acordo na empresa"
```

---

### Task 9: Frontend — seção Reduções por Produto

Componente próprio: `PerfisRegras/index.tsx` já tem 642 linhas, 3 Cards e 3 Modals; uma quarta seção inline chegaria a ~900.

**Files:**
- Create: `frontend/src/types/regraReducao.ts`
- Create: `frontend/src/api/regrasReducao.ts`
- Create: `frontend/src/pages/PerfisRegras/ReducaoProdutoSection.tsx`
- Create: `frontend/src/pages/PerfisRegras/useReducaoProdutoSection.ts`
- Modify: `frontend/src/api/queryKeys.ts`
- Modify: `frontend/src/pages/PerfisRegras/index.tsx`

**Interfaces:**
- Consumes: rotas da Task 7.
- Produces: `RegraReducao`, `RegraReducaoCreate`, `ExcecaoReducao`, `regrasReducaoApi`, `<ReducaoProdutoSection perfilId={number} />`.

- [x] **Step 1: Tipos**

Criar `frontend/src/types/regraReducao.ts`:

```ts
export interface ExcecaoReducao {
  id: number;
  regra_reducao_id: number;
  descricao_exata: string;
  enquadrado: boolean;
  observacao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface RegraReducao {
  id: number;
  perfil_regras_id: number;
  ncm: string;
  termos_inclusao: string[];
  termos_exclusao: string[];
  aliquota: number;
  descricao?: string | null;
  excecoes: ExcecaoReducao[];
  criado_em: string;
  atualizado_em: string;
}

export interface RegraReducaoCreate {
  perfil_regras_id: number;
  ncm: string;
  termos_inclusao: string[];
  termos_exclusao?: string[];
  aliquota: number;
  descricao?: string | null;
}

export interface RegraReducaoUpdate {
  ncm?: string;
  termos_inclusao?: string[];
  termos_exclusao?: string[];
  aliquota?: number;
  descricao?: string | null;
}

export interface ExcecaoReducaoCreate {
  descricao_exata: string;
  enquadrado: boolean;
  observacao?: string | null;
}
```

- [x] **Step 2: Camada de API**

Criar `frontend/src/api/regrasReducao.ts`:

```ts
import { apiClient } from './client';
import { createCrudApi } from './crud';
import type {
  ExcecaoReducao,
  ExcecaoReducaoCreate,
  RegraReducao,
  RegraReducaoCreate,
  RegraReducaoUpdate,
} from '../types/regraReducao';

const regraReducaoCrud = createCrudApi<RegraReducao, RegraReducaoCreate, RegraReducaoUpdate>(
  '/regras-reducao-produto',
);

export const regrasReducaoApi = {
  ...regraReducaoCrud,
  listar: async (params?: { perfil_id?: number; ncm?: string }): Promise<RegraReducao[]> => {
    const { data } = await apiClient.get<RegraReducao[]>('/regras-reducao-produto', { params });
    return data;
  },
  criarExcecao: async (regraId: number, payload: ExcecaoReducaoCreate): Promise<ExcecaoReducao> => {
    const { data } = await apiClient.post<ExcecaoReducao>(
      `/regras-reducao-produto/${regraId}/excecoes`,
      payload,
    );
    return data;
  },
  deletarExcecao: async (regraId: number, excecaoId: number): Promise<void> => {
    await apiClient.delete(`/regras-reducao-produto/${regraId}/excecoes/${excecaoId}`);
  },
};
```

Em `frontend/src/api/queryKeys.ts`, acrescentar dentro do objeto:

```ts
  regrasReducaoProduto: (perfilId?: number) => ['regras-reducao-produto', perfilId] as const,
```

- [x] **Step 3: Hook da seção**

Criar `frontend/src/pages/PerfisRegras/useReducaoProdutoSection.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { regrasReducaoApi } from '../../api/regrasReducao';
import { queryKeys } from '../../api/queryKeys';
import type { ExcecaoReducaoCreate, RegraReducaoCreate } from '../../types/regraReducao';

export function useReducaoProdutoSection(perfilId?: number) {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.regrasReducaoProduto(perfilId) });
  };

  const extrairErro = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    setErro(typeof detail === 'string' ? detail : 'Não foi possível concluir a operação.');
  };

  const regras = useQuery({
    queryKey: queryKeys.regrasReducaoProduto(perfilId),
    queryFn: () => regrasReducaoApi.listar({ perfil_id: perfilId }),
    enabled: typeof perfilId === 'number',
  });

  const criarRegra = useMutation({
    mutationFn: (payload: RegraReducaoCreate) => regrasReducaoApi.criar(payload),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  const deletarRegra = useMutation({
    mutationFn: (id: number) => regrasReducaoApi.deletar(id),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  const criarExcecao = useMutation({
    mutationFn: ({ regraId, payload }: { regraId: number; payload: ExcecaoReducaoCreate }) =>
      regrasReducaoApi.criarExcecao(regraId, payload),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  const deletarExcecao = useMutation({
    mutationFn: ({ regraId, excecaoId }: { regraId: number; excecaoId: number }) =>
      regrasReducaoApi.deletarExcecao(regraId, excecaoId),
    onSuccess: () => { setErro(null); invalidar(); },
    onError: extrairErro,
  });

  return { regras, criarRegra, deletarRegra, criarExcecao, deletarExcecao, erro, setErro };
}
```

- [x] **Step 4: Componente da seção**

Criar `frontend/src/pages/PerfisRegras/ReducaoProdutoSection.tsx`:

```tsx
import React, { useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { useReducaoProdutoSection } from './useReducaoProdutoSection';
import type { RegraReducao } from '../../types/regraReducao';

const AJUDA_TERMOS =
  'Separe por vírgula. Use * no fim para casar prefixo: vergalh* pega VERGALHAO e ' +
  'VERGALHOES. O termo casa palavras inteiras — ferro não casa FERROVIARIO.';

const listaDeTermos = (texto: string): string[] =>
  texto.split(',').map((t) => t.trim()).filter(Boolean);

const percentual = (aliquota: number): string => `${(aliquota * 100).toFixed(2)}%`;

interface Props {
  perfilId: number;
}

export const ReducaoProdutoSection: React.FC<Props> = ({ perfilId }) => {
  const { regras, criarRegra, deletarRegra, criarExcecao, deletarExcecao, erro, setErro } =
    useReducaoProdutoSection(perfilId);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [regraDaExcecao, setRegraDaExcecao] = useState<RegraReducao | null>(null);

  const [ncm, setNcm] = useState('');
  const [inclusao, setInclusao] = useState('');
  const [exclusao, setExclusao] = useState('');
  const [aliquota, setAliquota] = useState('');
  const [descricao, setDescricao] = useState('');

  const [descricaoExata, setDescricaoExata] = useState('');
  const [enquadrado, setEnquadrado] = useState('nao');
  const [observacao, setObservacao] = useState('');

  const limparFormRegra = () => {
    setNcm(''); setInclusao(''); setExclusao(''); setAliquota(''); setDescricao('');
  };

  const submeterRegra = (e: React.FormEvent) => {
    e.preventDefault();
    criarRegra.mutate(
      {
        perfil_regras_id: perfilId,
        ncm,
        termos_inclusao: listaDeTermos(inclusao),
        termos_exclusao: listaDeTermos(exclusao),
        aliquota: Number(aliquota.replace(',', '.')),
        descricao: descricao || null,
      },
      { onSuccess: () => { limparFormRegra(); setModalRegraAberto(false); } },
    );
  };

  const submeterExcecao = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regraDaExcecao) return;
    criarExcecao.mutate(
      {
        regraId: regraDaExcecao.id,
        payload: {
          descricao_exata: descricaoExata,
          enquadrado: enquadrado === 'sim',
          observacao: observacao || null,
        },
      },
      {
        onSuccess: () => {
          setDescricaoExata(''); setObservacao(''); setEnquadrado('nao');
          setRegraDaExcecao(null);
        },
      },
    );
  };

  return (
    <>
      <Card
        title="Reduções por Produto (NCM + Descrição) — Prioridade Máxima"
        subtitle="Aplicada quando o NCM E a descrição do item conferem. Vence o termo de acordo da empresa e as demais regras."
        headerAction={
          <Button
            size="sm"
            onClick={() => { setErro(null); setModalRegraAberto(true); }}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Nova redução
          </Button>
        }
      >
        {erro && <ErrorAlert message={erro} />}

        {regras.data && regras.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4">NCM</th>
                  <th className="py-2 pr-4">Inclusão</th>
                  <th className="py-2 pr-4">Exclusão</th>
                  <th className="py-2 pr-4">Alíquota</th>
                  <th className="py-2 pr-4">Descrição</th>
                  <th className="py-2 pr-4">Exceções</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {regras.data.map((regra) => (
                  <tr key={regra.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{regra.ncm}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{regra.termos_inclusao.join(', ')}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                      {regra.termos_exclusao.join(', ') || '—'}
                    </td>
                    <td className="py-2 pr-4 font-semibold">{percentual(regra.aliquota)}</td>
                    <td className="py-2 pr-4 text-slate-600">{regra.descricao || '—'}</td>
                    <td className="py-2 pr-4">
                      <div className="space-y-1">
                        {regra.excecoes.map((exc) => (
                          <div key={exc.id} className="flex items-center gap-2 text-xs">
                            <span className={exc.enquadrado ? 'text-emerald-700' : 'text-amber-700'}>
                              {exc.enquadrado ? '✓' : '✕'} {exc.descricao_exata}
                            </span>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                              onClick={() =>
                                deletarExcecao.mutate({ regraId: regra.id, excecaoId: exc.id })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setErro(null); setRegraDaExcecao(regra); }}
                        >
                          + exceção
                        </Button>
                      </div>
                    </td>
                    <td className="py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deletarRegra.mutate(regra.id)}
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      >
                        Excluir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Nenhuma redução cadastrada. Sem regra aqui, todos os produtos usam o termo de
            acordo da empresa ou a alíquota padrão do estado.
          </p>
        )}
      </Card>

      <Modal
        isOpen={modalRegraAberto}
        onClose={() => setModalRegraAberto(false)}
        title="Nova redução por produto"
        subtitle="A regra só se aplica quando o NCM e a descrição do item conferem."
      >
        <form onSubmit={submeterRegra} className="space-y-4">
          <Input
            label="NCM"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            placeholder="72142000"
            required
          />
          <Input
            label="Termos de inclusão"
            value={inclusao}
            onChange={(e) => setInclusao(e.target.value)}
            placeholder="vergalh*, verg ca"
            helperText={AJUDA_TERMOS}
            required
          />
          <Input
            label="Termos de exclusão (opcional)"
            value={exclusao}
            onChange={(e) => setExclusao(e.target.value)}
            placeholder="cobre, aluminio"
            helperText="Se algum destes casar, a regra é descartada para o item."
          />
          <Input
            label="Alíquota"
            value={aliquota}
            onChange={(e) => setAliquota(e.target.value)}
            placeholder="12,00"
            helperText="Aceita 12 ou 0.12."
            required
          />
          <Input
            label="Descrição (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Vergalhões — Decreto 12.345"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalRegraAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarRegra.isPending}>
              Cadastrar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={regraDaExcecao !== null}
        onClose={() => setRegraDaExcecao(null)}
        title="Exceção para uma descrição específica"
        subtitle="Avaliada antes dos termos: resolve o caso que a regra erra, sem alterar a regra."
      >
        <form onSubmit={submeterExcecao} className="space-y-4">
          <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-3">
            <TriangleAlert className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              Informe a descrição como ela aparece na nota. Acento, caixa e pontuação são
              normalizados automaticamente.
            </span>
          </div>
          <Input
            label="Descrição exata"
            value={descricaoExata}
            onChange={(e) => setDescricaoExata(e.target.value)}
            placeholder="VERGALHAO DE COBRE"
            required
          />
          <Select
            label="Este produto se enquadra na redução?"
            value={enquadrado}
            onChange={(e) => setEnquadrado(e.target.value)}
            options={[
              { value: 'nao', label: 'Não — usar a alíquota normal' },
              { value: 'sim', label: 'Sim — aplicar a redução' },
            ]}
          />
          <Input
            label="Observação (opcional)"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Cobre não entra no decreto"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRegraDaExcecao(null)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarExcecao.isPending}>
              Cadastrar exceção
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
};
```

As assinaturas usadas acima foram conferidas contra o código atual:
`Card` (`title`, `subtitle`, `headerAction`), `Modal` (`isOpen`, `onClose`,
`title`, `subtitle`), `Input` (`label`, `helperText`, `placeholder`), `Select`
(`label`, `options: {value, label}[]`), `Button` (`variant`, `size`,
`isLoading`, `leftIcon`) e `ErrorAlert` (`message`) — todos named exports.

- [x] **Step 5: Montar a seção na página e corrigir os títulos**

Em `frontend/src/pages/PerfisRegras/index.tsx`:

1. Importar o componente: `import { ReducaoProdutoSection } from './ReducaoProdutoSection';`
2. Renderizar `<ReducaoProdutoSection perfilId={activePerfil.id} />` **antes** da "Seção 1: Regras Padrão por Estado" (linha ~186), para que a ordem visual espelhe a precedência.
3. Corrigir os rótulos que deixaram de ser verdade:
   - Linha ~271: trocar o título `"Exceções Tributárias por NCM (Prioridade Máxima)"` por `"Exceções Tributárias por NCM"`, e o subtítulo por `"Sobrescreve a alíquota padrão do estado. É superada pelas reduções por produto e pelo termo de acordo da empresa."`
   - Linha ~188: manter o título da seção padrão e trocar o subtítulo para `"Alíquota base do estado. Vale quando não há redução por produto, termo de acordo nem exceção de NCM."`

- [x] **Step 6: Verificar**

Run: `cd frontend && npm run build`
Expected: build sem erro de TypeScript.

Run: `cd frontend && npm run lint`
Expected: sem erros novos.

- [x] **Step 7: Commit**

```bash
git add frontend/src/types/regraReducao.ts frontend/src/api/regrasReducao.ts \
        frontend/src/api/queryKeys.ts frontend/src/pages/PerfisRegras/
git commit -m "feat(ui): adiciona secao de reducoes por produto e corrige rotulos de precedencia"
```

---

### Task 10: Frontend — bloco Termo de Acordo

**Files:**
- Modify: `frontend/src/types/empresa.ts`
- Modify: `frontend/src/api/empresas.ts`
- Modify: `frontend/src/pages/Empresas/index.tsx`
- Modify: `frontend/src/pages/Empresas/useEmpresasPage.ts`

**Interfaces:**
- Consumes: rotas da Task 8.
- Produces: `empresasApi.definirTermoAcordo`, `empresasApi.removerTermoAcordo`.

- [x] **Step 1: Tipo**

Em `frontend/src/types/empresa.ts`, acrescentar:

```ts
export interface TermoAcordo {
  id: number;
  empresa_id: number;
  aliquota: number;
  descricao?: string | null;
  criado_em: string;
  atualizado_em: string;
}
```

e o campo na interface `Empresa`:

```ts
  termo_acordo?: TermoAcordo | null;
```

- [x] **Step 2: API**

Em `frontend/src/api/empresas.ts`, acrescentar ao objeto exportado:

```ts
  definirTermoAcordo: async (
    empresaId: number,
    payload: { aliquota: number; descricao?: string | null },
  ): Promise<TermoAcordo> => {
    const { data } = await apiClient.put<TermoAcordo>(
      `/empresas/${empresaId}/termo-acordo`,
      payload,
    );
    return data;
  },
  removerTermoAcordo: async (empresaId: number): Promise<void> => {
    await apiClient.delete(`/empresas/${empresaId}/termo-acordo`);
  },
```

Importar `TermoAcordo` de `../types/empresa` e garantir que `apiClient` já está importado no arquivo.

- [x] **Step 3: Mutations no hook**

Em `frontend/src/pages/Empresas/useEmpresasPage.ts`, acrescentar duas mutations seguindo o padrão das que já existem no arquivo, ambas invalidando `queryKeys.empresas`:

```ts
  const definirTermoAcordo = useMutation({
    mutationFn: ({ empresaId, aliquota, descricao }:
      { empresaId: number; aliquota: number; descricao?: string | null }) =>
      empresasApi.definirTermoAcordo(empresaId, { aliquota, descricao }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.empresas }); },
  });

  const removerTermoAcordo = useMutation({
    mutationFn: (empresaId: number) => empresasApi.removerTermoAcordo(empresaId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.empresas }); },
  });
```

Confirmar os nomes reais de `queryClient` e `empresasApi` no arquivo antes de colar, e devolver as duas mutations no `return` do hook.

- [x] **Step 4: Bloco na tela**

Em `frontend/src/pages/Empresas/index.tsx`, acrescentar na listagem/detalhe da empresa um bloco "Termo de Acordo":

- Quando `empresa.termo_acordo` existir: mostrar a alíquota formatada em percentual e a descrição, com botões "Editar" e "Remover".
- Quando não existir: botão "Cadastrar termo de acordo".
- Modal com dois campos: alíquota (aceita `12,06` ou `0.1206` — o backend normaliza) e identificação do termo (texto, opcional).
- Texto de apoio: **"Alíquota de destino própria desta empresa. Vale para todas as mercadorias, exceto as que tiverem redução por produto cadastrada no perfil de regras."**

Seguir o padrão de `Modal`, `Input`, `Button` já usado no arquivo.

- [x] **Step 5: Verificar**

Run: `cd frontend && npm run build`
Expected: build sem erro de TypeScript.

Run: `cd frontend && npm run lint`
Expected: sem erros novos.

- [x] **Step 6: Verificação final de ponta a ponta**

Run: `python -m pytest -q`
Expected: PASS — suíte inteira.

Run: `python -m alembic upgrade head`
Expected: aplica a `010_aliquotas_reduzidas` sem erro.

- [x] **Step 7: Commit**

```bash
git add frontend/src/types/empresa.ts frontend/src/api/empresas.ts frontend/src/pages/Empresas/
git commit -m "feat(ui): adiciona cadastro de termo de acordo na empresa"
```

---

## Verificação de cobertura da spec

| Requisito da spec | Task |
|---|---|
| Precedência produto > empresa > UF | 4 |
| `regras_aliquotas_destino` intocada | 4 (nível 3 preservado), verificado em 4/Step 5 |
| Três tabelas + migração 010 | 2 |
| Vigência no banco, fora da API | 2 (colunas), 3 (ausentes nos schemas) |
| Normalização e matching por token com wildcard | 1 |
| Exceções nos dois sentidos | 2 (modelo), 4 (algoritmo), 7 (API), 9 (UI) |
| Conflito falha com mensagem acionável | 4 (mensagem), 6 (prefixo da nota e propagação) |
| Retorno `ResolucaoAliquota` com origem | 4 |
| `preload` por solicitação | 4 (método), 6 (chamada) |
| `descricao_confiavel` | 5 |
| NCM sentinela rejeitado | 3 |
| Chave de agrupamento inalterada | 6 |
| `metadados_extras` com origem | 6 |
| Correção do handler de erro | 6 |
| Validador de alíquota compartilhado | 3 |
| Endpoints de redução e exceções | 7 |
| Termo de acordo em `/empresas/{id}` | 8 |
| Seção nova como componente próprio | 9 |
| Rótulos de precedência corrigidos | 9 |
| Bloco de termo de acordo em Empresas | 10 |
| Sem endpoint de simulação | — (fora de escopo, nenhuma task) |
