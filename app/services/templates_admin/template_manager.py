import os
import io
import hashlib
import logging
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc
import openpyxl
from sqlalchemy.exc import IntegrityError

from app.models.template_xlsx import TemplateXlsx
from app.schemas.template_xlsx import TemplateMapping
from app.core.config import settings
from app.core.exceptions import ValidationException, NotFoundException
from app.constants import TIPOS_PLANILHA
from app.services.supabase_storage import SupabaseStorageService
from app.services.local_files import atomic_write, remove_file_if_exists

logger = logging.getLogger(__name__)

STRICT_OFFICIAL_TEMPLATE_TYPES = {"antecipacao_tributaria", "difal"}

class TemplateManager:
    """
    Camada 9: Gestão, upload, validação de mapeamento obrigatório e versionamento rastreável de templates Excel.
    """

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
        observacoes: Optional[str] = None,
        promover_ativo: bool = False
    ) -> TemplateXlsx:
        valid_tipos = TIPOS_PLANILHA
        clean_tipo = tipo.strip().lower()
        if clean_tipo not in valid_tipos:
            raise ValidationException(f"Tipo de planilha '{tipo}' inválido. Tipos suportados: {valid_tipos}")

        # Validação obrigatória da estrutura de mapeamento
        try:
            validated_mapping = TemplateMapping(**mapeamento)
        except Exception as e:
            raise ValidationException(f"Declaração de mapeamento de campos inválida ou incompleta: {str(e)}")

        # Validar integralmente antes de persistir localmente ou na nuvem.
        try:
            workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=False, read_only=True)
            if validated_mapping.sheet_name and validated_mapping.sheet_name.lower() != "auto":
                if validated_mapping.sheet_name not in workbook.sheetnames:
                    raise ValidationException(
                        f"A aba '{validated_mapping.sheet_name}' declarada no mapeamento não existe no arquivo."
                    )
            workbook.close()
        except ValidationException:
            raise
        except Exception as exc:
            raise ValidationException("O arquivo enviado não é uma planilha Excel (.xlsx) válida.") from exc

        file_hash = cls.calculate_file_hash(file_bytes)
        
        # Próxima versão sequencial
        ultima_versao = (
            db.query(TemplateXlsx)
            .filter(TemplateXlsx.tipo == clean_tipo)
            .order_by(desc(TemplateXlsx.versao))
            .first()
        )
        proxima_versao = (ultima_versao.versao + 1) if ultima_versao else 1

        # DIFAL e Antecipação Tributária precisam estar em armazenamento persistente
        # quando executadas em ambiente serverless. Sem isso, /tmp desaparece entre
        # invocações e uma versão marcada como oficial deixa de ser reproduzível.
        if clean_tipo in STRICT_OFFICIAL_TEMPLATE_TYPES and os.getenv("VERCEL") == "1":
            if not SupabaseStorageService.is_configured():
                raise ValidationException(
                    "O armazenamento persistente de templates não está configurado. "
                    "Não é possível publicar uma versão oficial de DIFAL/Antecipação Tributária "
                    "apenas no disco temporário da Vercel."
                )

        # Salvar o arquivo no diretório de templates versionados
        ext = os.path.splitext(filename)[1] or ".xlsx"
        stored_filename = f"template_{clean_tipo}_v{proxima_versao}_{file_hash[:8]}{ext}"
        stored_path = os.path.join(settings.TEMPLATES_DIR, stored_filename)

        try:
            atomic_write(stored_path, file_bytes, prefix="template_")
        except Exception:
            raise ValidationException("Não foi possível armazenar o template enviado.")

        # Upload para Supabase Storage se configurado (armazenamento em nuvem)
        if SupabaseStorageService.is_configured() and not SupabaseStorageService.upload_file(
            bucket=settings.SUPABASE_STORAGE_BUCKET_TEMPLATES,
            path=stored_filename,
            file_bytes=file_bytes,
        ):
            remove_file_if_exists(stored_path)
            raise ValidationException("Não foi possível armazenar o template na nuvem.")

        # Se for o primeiro template do tipo, ativa por padrão se não houver ativo
        template_ativo_existente = (
            db.query(TemplateXlsx)
            .filter(TemplateXlsx.tipo == clean_tipo, TemplateXlsx.ativo == True)
            .first()
        )
        deve_ativar = promover_ativo or (template_ativo_existente is None)

        if deve_ativar:
            # Desativa templates anteriores do mesmo tipo
            db.query(TemplateXlsx).filter(TemplateXlsx.tipo == clean_tipo).update({"ativo": False})

        novo_template = TemplateXlsx(
            tipo=clean_tipo,
            versao=proxima_versao,
            arquivo_path=stored_path,
            arquivo_hash=file_hash,
            mapeamento_campos=validated_mapping.dict(),
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
            remove_file_if_exists(stored_path)
            SupabaseStorageService.delete_file(settings.SUPABASE_STORAGE_BUCKET_TEMPLATES, stored_filename)
            raise ValidationException("Outro upload criou esta versão simultaneamente; tente novamente.") from exc

    @classmethod
    def promote_version(cls, db: Session, template_id: int) -> TemplateXlsx:
        """Promove uma versão específica de template para se tornar a versão ativa vigente"""
        target = db.query(TemplateXlsx).filter(TemplateXlsx.id == template_id).first()
        if not target:
            raise NotFoundException(f"Template com ID {template_id} não encontrado.")

        clean_tipo = target.tipo.strip().lower()
        if clean_tipo in STRICT_OFFICIAL_TEMPLATE_TYPES and os.getenv("VERCEL") == "1":
            raw_path = (target.arquivo_path or "").replace("\\", "/")
            filename = os.path.basename(raw_path)
            file_bytes = SupabaseStorageService.download_file(
                settings.SUPABASE_STORAGE_BUCKET_TEMPLATES,
                filename,
            )
            if not file_bytes:
                raise ValidationException(
                    f"A versão {target.tipo} v{target.versao} não possui o arquivo original "
                    "no armazenamento persistente e não pode ser promovida como oficial."
                )
            expected_hash = (target.arquivo_hash or "").strip().lower()
            actual_hash = cls.calculate_file_hash(file_bytes).lower()
            if expected_hash and actual_hash != expected_hash:
                raise ValidationException(
                    f"A versão {target.tipo} v{target.versao} possui arquivo persistido divergente "
                    "do hash registrado e não pode ser promovida."
                )

        # Desativa todos do mesmo tipo
        db.query(TemplateXlsx).filter(TemplateXlsx.tipo == target.tipo).update({"ativo": False})
        target.ativo = True
        db.commit()
        db.refresh(target)
        return target

    @classmethod
    def get_active_template(cls, db: Session, tipo: str) -> TemplateXlsx:
        """Obtém a versão vigente (ativa) para o tipo de planilha informado"""
        clean_tipo = tipo.strip().lower()
        template = (
            db.query(TemplateXlsx)
            .filter(TemplateXlsx.tipo == clean_tipo, TemplateXlsx.ativo == True)
            .first()
        )
        if not template:
            raise NotFoundException(
                f"Nenhum template ativo cadastrado para o tipo '{tipo}'. "
                f"Faça o upload do template com seu mapeamento correspondente antes de processar."
            )
        return template

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
        strict_official = clean_tipo in STRICT_OFFICIAL_TEMPLATE_TYPES

        # 1. Caminho direto existente
        if raw_path and os.path.exists(raw_path):
            if not strict_official or cls._path_matches_template_hash(template, raw_path):
                return raw_path

        # 2. Arquivo presente no diretório de templates runtime
        runtime_path = os.path.join(settings.TEMPLATES_DIR, filename)
        if os.path.exists(runtime_path):
            if not strict_official or cls._path_matches_template_hash(template, runtime_path):
                return runtime_path

        # 3. Download do Supabase Storage
        file_bytes = SupabaseStorageService.download_file(
            settings.SUPABASE_STORAGE_BUCKET_TEMPLATES, filename
        )
        if file_bytes:
            if strict_official:
                downloaded_hash = cls.calculate_file_hash(file_bytes).lower()
                expected_hash = (template.arquivo_hash or "").strip().lower()
                if expected_hash and downloaded_hash != expected_hash:
                    raise ValidationException(
                        f"O arquivo persistido da versão oficial {template.tipo} v{template.versao} "
                        "não corresponde ao hash registrado. O processamento foi bloqueado para "
                        "evitar o uso de um modelo incorreto."
                    )
            atomic_write(runtime_path, file_bytes, prefix="template_download_")
            return runtime_path

        # 4. Fallback para modelos empacotados. Para os tipos oficiais estritos,
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
