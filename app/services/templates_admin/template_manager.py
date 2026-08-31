import os
import hashlib
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
import openpyxl

from app.models.template_xlsx import TemplateXlsx
from app.schemas.template_xlsx import TemplateMapping
from app.core.config import settings
from app.core.exceptions import ValidationException, NotFoundException
from app.constants import TIPOS_PLANILHA
from app.services.supabase_storage import SupabaseStorageService

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

        # Validar se o arquivo é um .xlsx válido que abre com openpyxl
        file_hash = cls.calculate_file_hash(file_bytes)
        
        # Próxima versão sequencial
        ultima_versao = (
            db.query(TemplateXlsx)
            .filter(TemplateXlsx.tipo == clean_tipo)
            .order_by(desc(TemplateXlsx.versao))
            .first()
        )
        proxima_versao = (ultima_versao.versao + 1) if ultima_versao else 1

        # Salvar o arquivo no diretório de templates versionados
        ext = os.path.splitext(filename)[1] or ".xlsx"
        stored_filename = f"template_{clean_tipo}_v{proxima_versao}_{file_hash[:8]}{ext}"
        stored_path = os.path.join(settings.TEMPLATES_DIR, stored_filename)

        with open(stored_path, "wb") as f:
            f.write(file_bytes)

        # Upload para Supabase Storage se configurado (armazenamento em nuvem)
        SupabaseStorageService.upload_file(
            bucket=settings.SUPABASE_STORAGE_BUCKET_TEMPLATES,
            path=stored_filename,
            file_bytes=file_bytes
        )

        # Testar se o openpyxl abre o arquivo salvo
        try:
            wb = openpyxl.load_workbook(stored_path, data_only=False)
            wb.close()
        except Exception as e:
            if os.path.exists(stored_path):
                os.remove(stored_path)
            raise ValidationException(f"O arquivo enviado não é uma planilha Excel (.xlsx) válida: {str(e)}")

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
        db.commit()
        db.refresh(novo_template)
        return novo_template

    @classmethod
    def promote_version(cls, db: Session, template_id: int) -> TemplateXlsx:
        """Promove uma versão específica de template para se tornar a versão ativa vigente"""
        target = db.query(TemplateXlsx).filter(TemplateXlsx.id == template_id).first()
        if not target:
            raise NotFoundException(f"Template com ID {template_id} não encontrado.")

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
    def resolve_template_path(cls, template: TemplateXlsx) -> str:
        """
        Resolve determinísticamente o caminho local do arquivo de template no sistema de arquivos,
        com suporte a cold-start e ambientes serverless (Vercel):
        1. Verifica se o caminho salvo existe diretamente no disco (normalizando separadores).
        2. Verifica se o arquivo pelo basename existe no diretório TEMPLATES_DIR.
        3. Tenta baixar do Supabase Storage se configurado.
        4. Tenta carregar o modelo padrão oficial dos templates empacotados (BUNDLED_TEMPLATES_DIR).
        """
        raw_path = (template.arquivo_path or "").replace("\\", "/")
        clean_tipo = template.tipo.strip().lower()
        filename = os.path.basename(raw_path) if raw_path else f"modelo_padrao_{clean_tipo}.xlsx"

        # 1. Caminho direto existente
        if raw_path and os.path.exists(raw_path):
            return raw_path

        # 2. Arquivo presente no diretório de templates runtime
        runtime_path = os.path.join(settings.TEMPLATES_DIR, filename)
        if os.path.exists(runtime_path):
            return runtime_path

        # 3. Download do Supabase Storage
        file_bytes = SupabaseStorageService.download_file(
            settings.SUPABASE_STORAGE_BUCKET_TEMPLATES, filename
        )
        if file_bytes:
            os.makedirs(settings.TEMPLATES_DIR, exist_ok=True)
            with open(runtime_path, "wb") as f:
                f.write(file_bytes)
            return runtime_path

        # 4. Fallback para os modelos oficiais empacotados no repositório
        bundled_candidates = [
            os.path.join(settings.BUNDLED_TEMPLATES_DIR, filename),
            os.path.join(settings.BUNDLED_TEMPLATES_DIR, f"modelo_padrao_{clean_tipo}.xlsx"),
            os.path.join(settings.TEMPLATES_DIR, f"modelo_padrao_{clean_tipo}.xlsx"),
            os.path.join(os.getcwd(), "storage", "templates", f"modelo_padrao_{clean_tipo}.xlsx"),
            os.path.join(os.getcwd(), "storage", "templates", filename),
        ]
        for candidate in bundled_candidates:
            if os.path.exists(candidate):
                return candidate

        raise ValidationException(
            f"Arquivo de template '{filename}' (tipo: '{template.tipo}') não foi encontrado no servidor "
            f"nem pôde ser baixado do armazenamento em nuvem."
        )
