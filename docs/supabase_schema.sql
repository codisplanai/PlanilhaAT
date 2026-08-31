-- ============================================================================
-- PLANILHA AT — SUPABASE POSTGRESQL SCHEMA COMPLETO
-- Execute este script no SQL Editor do Supabase para inicializar toda a estrutura
-- ============================================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABELA DE PERFIS DE USUÁRIOS (Vinculada ao auth.users do Supabase)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    cargo TEXT NOT NULL DEFAULT 'Analista Fiscal',
    role TEXT NOT NULL DEFAULT 'operador', -- 'admin' ou 'operador'
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS em profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Perfis visíveis para todos os usuários autenticados"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Usuários podem atualizar seu próprio perfil"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id);

-- 3. TRIGGER AUTOMÁTICO: Ao criar usuário no auth.users, insere no public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_nome TEXT;
    user_cargo TEXT;
    user_role TEXT;
BEGIN
    user_nome := COALESCE(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1));
    user_cargo := COALESCE(new.raw_user_meta_data->>'cargo', 'Analista Fiscal');
    user_role := COALESCE(new.raw_user_meta_data->>'role', 'operador');

    -- Se for o email do admin ou contador sênior, promove automaticamente
    IF new.email = 'admin@contabilidade.com' OR user_cargo = 'Contador Sênior' THEN
        user_role := 'admin';
        user_cargo := 'Contador Sênior';
    END IF;

    INSERT INTO public.profiles (id, email, nome, cargo, role)
    VALUES (new.id, new.email, user_nome, user_cargo, user_role)
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        nome = EXCLUDED.nome,
        cargo = EXCLUDED.cargo,
        role = EXCLUDED.role,
        atualizado_em = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. TABELA DE PERFIS DE REGRAS FISCAIS
CREATE TABLE IF NOT EXISTS public.perfis_regras (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE,
    descricao TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABELA DE EMPRESAS
CREATE TABLE IF NOT EXISTS public.empresas (
    id SERIAL PRIMARY KEY,
    razao_social VARCHAR(255) NOT NULL,
    cnpj VARCHAR(14) NOT NULL UNIQUE,
    inscricao_estadual VARCHAR(30),
    uf VARCHAR(2) NOT NULL,
    perfil_regras_id INTEGER NOT NULL REFERENCES public.perfis_regras(id) ON DELETE RESTRICT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_empresas_cnpj ON public.empresas(cnpj);

-- 6. TABELA DE REGRAS DE ALÍQUOTAS
CREATE TABLE IF NOT EXISTS public.regras_aliquotas (
    id SERIAL PRIMARY KEY,
    perfil_regras_id INTEGER NOT NULL REFERENCES public.perfis_regras(id) ON DELETE CASCADE,
    uf_origem VARCHAR(2) NOT NULL,
    uf_destino VARCHAR(2) NOT NULL,
    ncm VARCHAR(8),
    aliquota_interna NUMERIC(5,4) NOT NULL,
    aliquota_interestadual NUMERIC(5,4) NOT NULL,
    aliquota_fcp NUMERIC(5,4) NOT NULL DEFAULT 0,
    mva NUMERIC(7,4) NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_regras_aliquotas_busca ON public.regras_aliquotas(perfil_regras_id, uf_origem, uf_destino, ncm);

-- 7. TABELA DE REGRAS DE CFOP (Roteamento de planilhas)
CREATE TABLE IF NOT EXISTS public.regras_cfop (
    id SERIAL PRIMARY KEY,
    perfil_regras_id INTEGER NOT NULL REFERENCES public.perfis_regras(id) ON DELETE CASCADE,
    sufixo_cfop VARCHAR(3) NOT NULL,
    acao VARCHAR(20) NOT NULL DEFAULT 'processar', -- 'processar' ou 'descartar'
    destino_planilha VARCHAR(50) NOT NULL,        -- 'antecipacao_parcial', 'antecipacao_parcial_antecipado', 'antecipacao_tributaria', 'difal', 'nenhum'
    observacao TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. TABELA DE TEMPLATES XLSX (Modelos de Planilha gerenciados pelo Adm)
CREATE TABLE IF NOT EXISTS public.templates_xlsx (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) NOT NULL,
    versao INTEGER NOT NULL,
    arquivo_path VARCHAR(500) NOT NULL,
    arquivo_hash VARCHAR(64) NOT NULL,
    mapeamento_campos JSONB NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT FALSE,
    observacoes TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tipo_versao UNIQUE (tipo, versao)
);
CREATE INDEX IF NOT EXISTS idx_templates_tipo_ativo ON public.templates_xlsx(tipo, ativo);

-- 9. TABELA DE SOLICITAÇÕES (Histórico de Planilhas vinculado ao Usuário)
CREATE TABLE IF NOT EXISTS public.solicitacoes (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    empresa_id INTEGER NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
    usuario_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    periodo_inicio DATE NOT NULL,
    periodo_fim DATE NOT NULL,
    tipo_planilha VARCHAR(50) NOT NULL DEFAULT 'multi',
    template_id INTEGER REFERENCES public.templates_xlsx(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente',
    mensagem_erro TEXT,
    arquivo_saida_path VARCHAR(500),
    total_notas_processadas INTEGER NOT NULL DEFAULT 0,
    notas_ignoradas JSONB NOT NULL DEFAULT '[]'::jsonb,
    cfops_sem_regra JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_usuario ON public.solicitacoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_empresa ON public.solicitacoes(empresa_id);

-- 10. TABELA DE SAÍDAS DA SOLICITAÇÃO (Planilhas geradas no processamento multi-tipo)
CREATE TABLE IF NOT EXISTS public.solicitacao_saidas (
    id SERIAL PRIMARY KEY,
    solicitacao_id VARCHAR(36) NOT NULL REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
    tipo_planilha VARCHAR(50) NOT NULL,
    arquivo_saida_path VARCHAR(500) NOT NULL,
    total_linhas INTEGER NOT NULL DEFAULT 0,
    valor_total_debito NUMERIC(15,2) NOT NULL DEFAULT 0,
    valor_total_credito NUMERIC(15,2) NOT NULL DEFAULT 0,
    valor_total_devido NUMERIC(15,2) NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_solicitacao_saidas_solicitacao ON public.solicitacao_saidas(solicitacao_id);

-- 11. TABELA DE NOTAS PROCESSADAS (Itens fiscais extraídos)
CREATE TABLE IF NOT EXISTS public.notas_processadas (
    id SERIAL PRIMARY KEY,
    solicitacao_id VARCHAR(36) NOT NULL REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
    chave_acesso VARCHAR(44) NOT NULL,
    numero_nota VARCHAR(20) NOT NULL,
    data_emissao DATE NOT NULL,
    data_entrada DATE,
    uf VARCHAR(2),
    item_numero INTEGER NOT NULL,
    ncm VARCHAR(8) NOT NULL,
    cfop VARCHAR(4),
    valor_total NUMERIC(15,2) NOT NULL,
    base_calculo NUMERIC(15,2) NOT NULL,
    aliquota_origem NUMERIC(5,4) NOT NULL,
    aliquota_destino NUMERIC(5,4) NOT NULL,
    valor_debito NUMERIC(15,2) NOT NULL,
    valor_credito NUMERIC(15,2) NOT NULL,
    valor_devido NUMERIC(15,2) NOT NULL,
    tipo_saida VARCHAR(50),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notas_processadas_solicitacao ON public.notas_processadas(solicitacao_id);

-- 12. DADOS INICIAIS (SEED)
INSERT INTO public.perfis_regras (id, nome, descricao, ativo)
VALUES (1, 'Padrão Geral', 'Perfil de regras padrão para empresas do Simples / Lucro Presumido', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 13. CONFIGURAÇÃO DE BUCKET STORAGE NO SUPABASE (Caso use Supabase Storage)
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', false),
       ('outputs', 'outputs', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas de acesso ao Storage para templates
CREATE POLICY "Admins podem fazer upload de templates"
    ON storage.objects FOR ALL
    TO authenticated
    USING (bucket_id = 'templates' AND EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ));

CREATE POLICY "Usuários autenticados podem ler templates"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'templates');
