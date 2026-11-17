import os
import io
import hashlib
import logging
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import desc
import openpyxl
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.models.empresa import Empresa
from app.models.template_xlsx import TemplateXlsx
from app.schemas.template_xlsx import TemplateMapping
from app.core.config import settings
from app.core.exceptions import ValidationException, NotFoundException
from app.constants import (
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
    DIFAL_ANTECIPADO,
    TIPOS_PLANILHA,
)
from app.services.supabase_storage import SupabaseStorageService
from app.services.local_files import atomic_write, remove_file_if_exists

logger = logging.getLogger(__name__)

STRICT_OFFICIAL_TEMPLATE_TYPES = {
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
    DIFAL_ANTECIPADO,
}
SAFETY_MARGIN_KEY = "margem_seguranca_linhas"
MAX_SAFETY_MARGIN_LINES = 100_000


class TemplateManager:
    """
    Camada 9: Gestão, upload, validação de mapeamento obrigatório e versionamento rastreável de templates Excel.
    """

    DEFAULT_ORDER = (
        TemplateXlsx.empresa_id.is_not(None),
        TemplateXlsx.empresa_id,
        TemplateXlsx.tipo,
        TemplateXlsx.capacidade_linhas.is_(None),
        TemplateXlsx.capacidade_linhas,
        TemplateXlsx.versao.desc(),
    )

    @staticmethod
    def _scope_filter(empresa_id: Optional[int] = None):
        return (
            TemplateXlsx.empresa_id == empresa_id
            if empresa_id is not None
            else TemplateXlsx.empresa_id.is_(None)
        )

    @classmethod
    def _family_filter(
        cls,
        tipo: str,
        capacidade_linhas: Optional[int],
        empresa_id: Optional[int] = None,
    ):
        return [
            cls._scope_filter(empresa_id),
            TemplateXlsx.tipo == tipo,
            (
                TemplateXlsx.capacidade_linhas == capacidade_linhas
                if capacidade_linhas is not None
                else TemplateXlsx.capacidade_linhas.is_(None)
            ),
        ]

    @classmethod
    def _assert_hash_matches(
        cls,
        file_bytes: bytes,
        template: TemplateXlsx,
        *,
        error_message: str,
    ) -> None:
        expected_hash = (template.arquivo_hash or "").strip().lower()
        if expected_hash and cls.calculate_file_hash(file_bytes).lower() != expected_hash:
            raise ValidationException(error_message)

    @classmethod
    def calculate_file_hash(cls, file_bytes: bytes) -> str:
        return hashlib.sha256(file_bytes).hexdigest()

    @classmethod
    def upload_new_template_version(
        cls,
        db: Session,
        tipo: str,
        file_bytes: bytes,
        filename: str,
        mapeamento: Dict[str, Any],
        capacidade_linhas: Optional[int] = None,
        observacoes: Optional[str] = None,
        promover_ativo: bool = False,
        empresa_id: Optional[int] = None,
    ) -> TemplateXlsx:
        valid_tipos = TIPOS_PLANILHA
        clean_tipo = tipo.strip().lower()
        if clean_tipo not in valid_tipos:
            raise ValidationException(f"Tipo de planilha '{tipo}' inválido. Tipos suportados: {valid_tipos}")
        if capacidade_linhas is not None and capacidade_linhas < 1:
            raise ValidationException("A capacidade de linhas deve ser maior ou igual a 1.")
        if empresa_id is not None:
            empresa = db.query(Empresa).filter(Empresa.id == empresa_id).first()
            if not empresa:
                raise NotFoundException("Empresa não encontrada.")

        # Validação obrigatória da estrutura de mapeamento
        try:
            validated_mapping = TemplateMapping(**mapeamento)
        except Exception as e:
            raise ValidationException(f"Declaração de mapeamento de campos inválida ou incompleta: {str(e)}")

        # Validar integralmente antes de persistir localmente ou na nuvem.
        detected_active_sheet = None
        try:
            workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=False, read_only=False)
            if validated_mapping.sheet_name and validated_mapping.sheet_name.lower() != "auto":
                if validated_mapping.sheet_name not in workbook.sheetnames:
                    raise ValidationException(
                        f"A aba '{validated_mapping.sheet_name}' declarada no mapeamento não existe no arquivo."
                    )
            else:
                visible_sheets = [
                    s for s in workbook.sheetnames
                    if getattr(workbook[s], "sheet_state", "visible") == "visible"
                ]
                # Se há apenas uma única aba visível (ex.: modelos com abas ocultas de rascunho),
                # vincula explicitamente a ela para evitar fallback incorreto em abas ocultas.
                if len(visible_sheets) == 1:
                    detected_active_sheet = visible_sheets[0]
            workbook.close()
        except ValidationException:
            raise
        except Exception as exc:
            raise ValidationException("O arquivo enviado não é uma planilha Excel (.xlsx) válida.") from exc

        file_hash = cls.calculate_file_hash(file_bytes)
        
        # Próxima versão sequencial no escopo (global ou da empresa)
        ultima_versao = (
            db.query(TemplateXlsx)
            .filter(
                TemplateXlsx.tipo == clean_tipo,
                cls._scope_filter(empresa_id),
            )
            .order_by(desc(TemplateXlsx.versao))
            .first()
        )
        proxima_versao = (ultima_versao.versao + 1) if ultima_versao else 1

        # Salvar o arquivo no diretório de templates versionados
        ext = os.path.splitext(filename)[1] or ".xlsx"
        empresa_part = f"_emp{empresa_id}" if empresa_id is not None else ""
        capacity_part = f"_cap{capacidade_linhas}" if capacidade_linhas is not None else ""
        stored_filename = (
            f"template_{clean_tipo}{empresa_part}{capacity_part}_v{proxima_versao}_{file_hash[:8]}{ext}"
        )
        stored_path = os.path.join(settings.TEMPLATES_DIR, stored_filename)

        try:
            atomic_write(stored_path, file_bytes, prefix="template_")
        except Exception:
            raise ValidationException("Não foi possível armazenar o template enviado.")

        # O banco é a fonte persistente primária do arquivo original. O Supabase
        # Storage permanece como réplica opcional quando houver credencial de serviço.
        if SupabaseStorageService.is_configured() and not SupabaseStorageService.upload_file(
            bucket=settings.SUPABASE_STORAGE_BUCKET_TEMPLATES,
            path=stored_filename,
            file_bytes=file_bytes,
        ):
            logger.warning(
                "Não foi possível replicar o template %s v%s no Supabase Storage; "
                "o arquivo original permanece persistido no banco.",
                clean_tipo,
                proxima_versao,
            )

        # Cada escopo e capacidade possui sua própria versão oficial. Modelos legados
        # (capacidade nula) permanecem isolados para compatibilidade.
        family_filter = cls._family_filter(clean_tipo, capacidade_linhas, empresa_id)
        template_ativo_existente = (
            db.query(TemplateXlsx)
            .filter(*family_filter, TemplateXlsx.ativo == True)
            .first()
        )
        deve_ativar = promover_ativo or (template_ativo_existente is None)

        if deve_ativar:
            db.query(TemplateXlsx).filter(*family_filter).update(
                {"ativo": False},
                synchronize_session=False,
            )

        mapping_payload = validated_mapping.dict()
        if (not mapping_payload.get("sheet_name") or mapping_payload.get("sheet_name") == "auto") and detected_active_sheet:
            mapping_payload["sheet_name"] = detected_active_sheet
        extra_options = dict(mapping_payload.get("extra_options") or {})
        extra_options[SAFETY_MARGIN_KEY] = cls.get_safety_margin(db, clean_tipo)
        mapping_payload["extra_options"] = extra_options

        novo_template = TemplateXlsx(
            empresa_id=empresa_id,
            tipo=clean_tipo,
            versao=proxima_versao,
            capacidade_linhas=capacidade_linhas,
            arquivo_path=stored_path,
            arquivo_hash=file_hash,
            arquivo_blob=file_bytes,
            mapeamento_campos=mapping_payload,
            ativo=deve_ativar,
            observacoes=observacoes
        )
        db.add(novo_template)
        try:
            db.commit()
            db.refresh(novo_template)
            return novo_template
        except IntegrityError as exc:
            db.rollback()
            cls._descartar_arquivo_orfao(stored_path, stored_filename)
            raise ValidationException("Outro upload criou esta versão simultaneamente; tente novamente.") from exc
        except SQLAlchemyError as exc:
            # Sem esta compensação, uma falha de banco que não fosse conflito de
            # unicidade deixava o arquivo publicado sem nenhuma versão apontando
            # para ele, ocupando espaço e confundindo a resolução por nome.
            db.rollback()
            logger.exception("Falha ao registrar a versão %s v%s", clean_tipo, proxima_versao)
            cls._descartar_arquivo_orfao(stored_path, stored_filename)
            raise ValidationException(
                "Não foi possível registrar a nova versão do modelo. Tente novamente."
            ) from exc

    @classmethod
    def _descartar_arquivo_orfao(cls, stored_path: str, stored_filename: str) -> None:
        """Remove o arquivo recém-gravado quando o registro correspondente falha."""
        try:
            remove_file_if_exists(stored_path)
        except OSError:
            logger.warning("Arquivo órfão %s não pôde ser removido", stored_path, exc_info=True)
        if SupabaseStorageService.is_configured():
            SupabaseStorageService.delete_file(
                settings.SUPABASE_STORAGE_BUCKET_TEMPLATES, stored_filename
            )

    @classmethod
    def promote_version(cls, db: Session, template_id: int) -> TemplateXlsx:
        """Promove uma versão específica de template para se tornar a versão ativa vigente"""
        target = db.query(TemplateXlsx).filter(TemplateXlsx.id == template_id).first()
        if not target:
            raise NotFoundException(f"Template com ID {template_id} não encontrado.")

        clean_tipo = target.tipo.strip().lower()
        if clean_tipo in STRICT_OFFICIAL_TEMPLATE_TYPES or target.empresa_id is not None:
            # A promoção só é permitida se a versão puder resolver exatamente
            # o arquivo correspondente ao hash registrado.
            cls.resolve_template_path(target)

        # Desativa somente versões concorrentes da mesma família (escopo + tipo + capacidade).
        family_filter = cls._family_filter(
            target.tipo,
            target.capacidade_linhas,
            target.empresa_id,
        )
        db.query(TemplateXlsx).filter(*family_filter).update(
            {"ativo": False},
            synchronize_session=False,
        )
        target.ativo = True
        db.commit()
        db.refresh(target)
        return target

    @classmethod
    def deactivate_version(cls, db: Session, template_id: int) -> TemplateXlsx:
        """Desativa um modelo personalizado de empresa para retornar ao padrão global."""
        target = db.query(TemplateXlsx).filter(TemplateXlsx.id == template_id).first()
        if not target:
            raise NotFoundException(f"Template com ID {template_id} não encontrado.")
        if target.empresa_id is None:
            raise ValidationException(
                "Modelos padrão globais não podem ser desativados sem substituição. "
                "Coloque outra versão em uso."
            )

        target.ativo = False
        db.commit()
        db.refresh(target)
        return target

    @classmethod
    def get_safety_margin(cls, db: Session, tipo: str) -> int:
        """Retorna a margem opcional de linhas configurada para um tipo de planilha."""
        clean_tipo = tipo.strip().lower()
        if clean_tipo not in TIPOS_PLANILHA:
            raise ValidationException(
                f"Tipo de planilha '{tipo}' inválido. Tipos suportados: {TIPOS_PLANILHA}"
            )

        templates = (
            db.query(TemplateXlsx)
            .filter(TemplateXlsx.tipo == clean_tipo)
            .order_by(TemplateXlsx.ativo.desc(), TemplateXlsx.versao.desc())
            .all()
        )
        for template in templates:
            mapping = template.mapeamento_campos or {}
            extra_options = mapping.get("extra_options") or {}
            raw_margin = extra_options.get(SAFETY_MARGIN_KEY)
            if raw_margin is None:
                continue
            try:
                margin = int(raw_margin)
            except (TypeError, ValueError):
                logger.warning(
                    "Margem de segurança inválida ignorada no template %s v%s: %r",
                    template.tipo,
                    template.versao,
                    raw_margin,
                )
                continue
            if 0 <= margin <= MAX_SAFETY_MARGIN_LINES:
                return margin
        return 0

    @classmethod
    def set_safety_margin(cls, db: Session, tipo: str, margin: int) -> int:
        """Sincroniza a margem de segurança em todos os modelos do mesmo tipo."""
        clean_tipo = tipo.strip().lower()
        if clean_tipo not in TIPOS_PLANILHA:
            raise ValidationException(
                f"Tipo de planilha '{tipo}' inválido. Tipos suportados: {TIPOS_PLANILHA}"
            )
        if margin < 0 or margin > MAX_SAFETY_MARGIN_LINES:
            raise ValidationException(
                f"A margem de segurança deve ficar entre 0 e {MAX_SAFETY_MARGIN_LINES} linhas."
            )

        templates = (
            db.query(TemplateXlsx)
            .filter(TemplateXlsx.tipo == clean_tipo)
            .all()
        )
        if not templates:
            raise NotFoundException(
                f"Nenhum template cadastrado para o tipo '{tipo}'. "
                "Cadastre ao menos um modelo antes de configurar a margem de segurança."
            )

        for template in templates:
            mapping = dict(template.mapeamento_campos or {})
            extra_options = dict(mapping.get("extra_options") or {})
            extra_options[SAFETY_MARGIN_KEY] = int(margin)
            mapping["extra_options"] = extra_options
            template.mapeamento_campos = mapping

        db.commit()
        return int(margin)

    @classmethod
    def _select_from_scope(
        cls,
        db: Session,
        clean_tipo: str,
        required_rows: Optional[int],
        safety_margin: int,
        empresa_id: Optional[int],
    ) -> Tuple[Optional[TemplateXlsx], Optional[int]]:
        base_query = db.query(TemplateXlsx).filter(
            cls._scope_filter(empresa_id),
            TemplateXlsx.tipo == clean_tipo,
            TemplateXlsx.ativo == True,
        )

        capacity_templates = (
            base_query
            .filter(TemplateXlsx.capacidade_linhas.is_not(None))
            .order_by(TemplateXlsx.capacidade_linhas.asc(), TemplateXlsx.versao.desc())
            .all()
        )

        if required_rows is None:
            legacy = (
                base_query
                .filter(TemplateXlsx.capacidade_linhas.is_(None))
                .order_by(TemplateXlsx.versao.desc())
                .first()
            )
            if legacy:
                return legacy, None
            if capacity_templates:
                max_capacity = max(
                    int(template.capacidade_linhas or 0)
                    for template in capacity_templates
                )
                return capacity_templates[0], max_capacity
            return None, None

        required_capacity = required_rows + safety_margin
        if capacity_templates:
            max_capacity = max(
                int(template.capacidade_linhas or 0)
                for template in capacity_templates
            )
            for template in capacity_templates:
                if int(template.capacidade_linhas or 0) >= required_capacity:
                    return template, max_capacity
            return None, max_capacity

        legacy = (
            base_query
            .filter(TemplateXlsx.capacidade_linhas.is_(None))
            .order_by(TemplateXlsx.versao.desc())
            .first()
        )
        return legacy, None

    @classmethod
    def get_active_template(
        cls,
        db: Session,
        tipo: str,
        required_rows: Optional[int] = None,
        empresa_id: Optional[int] = None,
    ) -> TemplateXlsx:
        """Seleciona a versão oficial adequada ao escopo, tipo e quantidade de linhas.

        Quando ``empresa_id`` é informado, prioriza o menor modelo ativo da empresa
        que comporte as linhas solicitadas; se não houver ou a capacidade da empresa
        for insuficiente, faz fallback para o padrão global.
        """
        clean_tipo = tipo.strip().lower()
        if required_rows is not None and required_rows < 1:
            raise ValidationException("A quantidade de linhas necessária deve ser maior ou igual a 1.")

        safety_margin = cls.get_safety_margin(db, clean_tipo) if required_rows is not None else 0
        required_capacity = (required_rows + safety_margin) if required_rows is not None else None

        company_max_capacity: Optional[int] = None
        if empresa_id is not None:
            selected, company_max_capacity = cls._select_from_scope(
                db=db,
                clean_tipo=clean_tipo,
                required_rows=required_rows,
                safety_margin=safety_margin,
                empresa_id=empresa_id,
            )
            if selected is not None:
                return selected

        selected, global_max_capacity = cls._select_from_scope(
            db=db,
            clean_tipo=clean_tipo,
            required_rows=required_rows,
            safety_margin=safety_margin,
            empresa_id=None,
        )
        if selected is not None:
            return selected

        available_caps = [
            cap for cap in (company_max_capacity, global_max_capacity) if cap is not None
        ]
        if required_rows is not None and available_caps:
            max_capacity = max(available_caps)
            margin_detail = (
                f" + {safety_margin} linhas de segurança = {required_capacity}"
                if safety_margin
                else ""
            )
            raise ValidationException(
                f"O processamento de '{tipo}' necessita de {required_rows} linhas"
                f"{margin_detail}, mas o maior modelo oficial cadastrado suporta {max_capacity} linhas. "
                f"Cadastre um modelo com capacidade igual ou superior a {required_capacity}."
            )

        raise NotFoundException(
            f"Nenhum template ativo cadastrado para o tipo '{tipo}'. "
            f"Faça o upload do template com seu mapeamento correspondente antes de processar."
        )

    @classmethod
    def _path_matches_template_hash(cls, template: TemplateXlsx, path: str) -> bool:
        try:
            with open(path, "rb") as handle:
                actual_hash = cls.calculate_file_hash(handle.read())
        except OSError:
            return False

        expected_hash = (template.arquivo_hash or "").strip().lower()
        if not expected_hash:
            return True

        matches = actual_hash.lower() == expected_hash
        if not matches:
            logger.warning(
                "Template %s v%s rejeitado por divergência de hash em %s",
                template.tipo,
                template.versao,
                path,
            )
        return matches

    @classmethod
    def resolve_template_path(cls, template: TemplateXlsx) -> str:
        """
        Resolve determinísticamente o arquivo exato associado à versão do template.

        Para DIFAL e Antecipação Tributária, nunca substitui silenciosamente uma
        versão oficial ausente por outro modelo empacotado: o SHA-256 precisa ser
        exatamente o registrado na versão ativa.
        """
        raw_path = (template.arquivo_path or "").replace("\\", "/")
        clean_tipo = template.tipo.strip().lower()
        filename = os.path.basename(raw_path) if raw_path else f"modelo_padrao_{clean_tipo}.xlsx"
        strict_official = (clean_tipo in STRICT_OFFICIAL_TEMPLATE_TYPES) or (
            template.empresa_id is not None
        )

        # 1. Caminho direto existente
        if raw_path and os.path.exists(raw_path):
            if not strict_official or cls._path_matches_template_hash(template, raw_path):
                return raw_path

        # 2. Arquivo presente no diretório de templates runtime
        runtime_path = os.path.join(settings.TEMPLATES_DIR, filename)
        if os.path.exists(runtime_path):
            if not strict_official or cls._path_matches_template_hash(template, runtime_path):
                return runtime_path

        # 3. Bytes originais persistidos no banco. Essa é a fonte de verdade
        # para uploads feitos pelo app e sobrevive a cold starts/deploys da Vercel.
        persisted_blob = getattr(template, "arquivo_blob", None)
        if persisted_blob:
            file_bytes = bytes(persisted_blob)
            cls._assert_hash_matches(
                file_bytes,
                template,
                error_message=(
                    f"O arquivo persistido da versão {template.tipo} v{template.versao} "
                    "não corresponde ao hash registrado. O processamento foi bloqueado."
                ),
            )
            atomic_write(runtime_path, file_bytes, prefix="template_db_")
            return runtime_path

        # 4. Réplica opcional no Supabase Storage
        file_bytes = SupabaseStorageService.download_file(
            settings.SUPABASE_STORAGE_BUCKET_TEMPLATES, filename
        )
        if file_bytes:
            if strict_official:
                cls._assert_hash_matches(
                    file_bytes,
                    template,
                    error_message=(
                        f"O arquivo persistido da versão oficial {template.tipo} v{template.versao} "
                        "não corresponde ao hash registrado. O processamento foi bloqueado para "
                        "evitar o uso de um modelo incorreto."
                    ),
                )
            atomic_write(runtime_path, file_bytes, prefix="template_download_")
            return runtime_path

        # 5. Fallback para modelos empacotados. Para os tipos oficiais estritos,
        # o fallback só é permitido quando o próprio arquivo empacotado possui
        # exatamente o mesmo hash da versão registrada (ex.: versão seed original).
        bundled_candidates = [
            os.path.join(settings.BUNDLED_TEMPLATES_DIR, filename),
            os.path.join(settings.BUNDLED_TEMPLATES_DIR, f"modelo_padrao_{clean_tipo}.xlsx"),
            os.path.join(settings.TEMPLATES_DIR, f"modelo_padrao_{clean_tipo}.xlsx"),
            os.path.join(os.getcwd(), "storage", "templates", f"modelo_padrao_{clean_tipo}.xlsx"),
            os.path.join(os.getcwd(), "storage", "templates", filename),
        ]
        for candidate in bundled_candidates:
            if not os.path.exists(candidate):
                continue
            if not strict_official or cls._path_matches_template_hash(template, candidate):
                return candidate

        if strict_official:
            raise ValidationException(
                f"A versão oficial {template.tipo} v{template.versao} está ativa, mas o arquivo original "
                f"'{filename}' não está disponível no armazenamento persistente. "
                "O sistema não utilizará outra versão no lugar dela. Reenvie o arquivo e publique-o como oficial."
            )

        raise ValidationException(
            f"Arquivo de template '{filename}' (tipo: '{template.tipo}') não foi encontrado no servidor "
            f"nem pôde ser baixado do armazenamento em nuvem."
        )
