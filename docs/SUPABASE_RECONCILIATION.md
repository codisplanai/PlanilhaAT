# Reconciliação do Supabase existente

Auditoria realizada em 01/09/2026 identificou que o banco configurado localmente não possui `alembic_version` e contém dois esquemas paralelos. As tabelas usadas pelo código são `regras_aliquotas_destino`, `regras_cfop_destino`, `solicitacoes_saidas` e `notas_fiscais_processadas`; o SQL antigo criou também `regras_aliquotas`, `regras_cfop`, `solicitacao_saidas` e `notas_processadas`, com colunas incompatíveis.

Não foi feita alteração automática nesse banco. Excluir ou mesclar as tabelas antigas sem validar os dados seria destrutivo.

## Procedimento seguro

1. Coloque a aplicação em manutenção e gere um backup restaurável do projeto Supabase.
2. Compare as contagens e amostras das tabelas paralelas. Confirme com o responsável fiscal se alguma tabela antiga possui dados que precisam ser convertidos.
3. Valide se todas as tabelas/colunas da cadeia Alembic até a revisão `008_profiles_user_ownership` já existem. Não execute `001` sobre esse banco populado.
4. Somente depois dessa validação, marque o baseline existente:

   ```powershell
   alembic stamp 008_profiles_user_ownership
   alembic upgrade head
   ```

5. Execute os testes de fumaça de login, CRUD, processamento e download antes de remover tabelas legadas.
6. Arquive as tabelas antigas por um ciclo de retenção. A remoção deve ocorrer em uma mudança separada e aprovada.

## Consultas de diagnóstico

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT 'regras_aliquotas' AS tabela, count(*) FROM public.regras_aliquotas
UNION ALL SELECT 'regras_aliquotas_destino', count(*) FROM public.regras_aliquotas_destino
UNION ALL SELECT 'regras_cfop', count(*) FROM public.regras_cfop
UNION ALL SELECT 'regras_cfop_destino', count(*) FROM public.regras_cfop_destino
UNION ALL SELECT 'solicitacao_saidas', count(*) FROM public.solicitacao_saidas
UNION ALL SELECT 'solicitacoes_saidas', count(*) FROM public.solicitacoes_saidas
UNION ALL SELECT 'notas_processadas', count(*) FROM public.notas_processadas
UNION ALL SELECT 'notas_fiscais_processadas', count(*) FROM public.notas_fiscais_processadas;

SELECT perfil_regras_id, uf, COALESCE(ncm, '') AS ncm, count(*)
FROM public.regras_aliquotas_destino
GROUP BY 1, 2, 3 HAVING count(*) > 1;

SELECT COALESCE(perfil_regras_id, 0) AS perfil, cfop_sufixo, count(*)
FROM public.regras_cfop_destino
GROUP BY 1, 2 HAVING count(*) > 1;

SELECT tipo, count(*)
FROM public.templates_xlsx
WHERE ativo = TRUE
GROUP BY tipo HAVING count(*) > 1;
```

O arquivo `docs/supabase_schema.sql` agora representa apenas instalações novas e bloqueia a autoelevação por `raw_user_meta_data`. Em ambiente existente, aplique a mesma política por migração revisada e nunca colando o schema completo sobre as tabelas atuais.
