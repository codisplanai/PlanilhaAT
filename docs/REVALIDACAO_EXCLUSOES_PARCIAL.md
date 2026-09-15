# Revalidação das correções da Parcial

Data: 15/09/2026.
Escopo: alterações locais após a [primeira revisão](REVISAO_EXCLUSOES_PARCIAL.md).

## Conclusão

As reproduções originais passaram, mas a correção ainda é parcial. Há quatro
casos confirmados que precisam de ajuste. A revisão não alterou código funcional.

| Ponto da primeira revisão | Resultado da revalidação |
|---|---|
| Preservar edições ao recarregar o padrão BA | Corrigido para termos; ainda falha ao editar o NCM |
| Não concluir sem apuração completa | Corrigido para CFOP desconhecido; ainda falha com erro de validação |
| Excluir mercadoria antes de resolver A.dest | Corrigido e testado |
| Conferência mostrar valores reais e ausência de cálculo | Corrigido na expressão da tela; inclui débito, crédito e critérios |
| Validar a política numérica | Booleanos estritos corrigidos; restam compatibilidade com dados antigos e normalização de UF |
| Avisar sobre descrição vazia e NCM ausente | Reproduções originais corrigidas e testadas |

## 1. [P1] Erro de validação ainda resulta em “Nenhum item a recolher”

Local: `app/services/pipeline_service.py`, linhas 538–542 e 640–659.

A condição de saída passou a verificar CFOPs sem regra, mas continua concluindo
assim que existe algum item excluído, antes de considerar falhas de validação
registradas em `notas_ignoradas`.

Reprodução: nota com dois itens de R$ 100 cada:

- Charque, excluído por mercadoria.
- Plástico, com alíquota de origem inválida de 200%.

O segundo item falha na validação numérica. Mesmo assim, a solicitação retorna
`status=concluido` e `mensagem_erro="Nenhum item a recolher na Parcial"`.
O motivo da falha fica na lista de ignorados, mas a conclusão afirma ausência
de imposto antes de uma apuração completa. A tela mantém a mesma conclusão,
pois só acrescentou CFOP desconhecido à condição de bloqueio.

Correção: distinguir motivos legítimos de descarte (por exemplo, documento fora
do período) de falhas que deixam um item elegível sem apuração. O resultado sem
linhas deve exigir ausência de pendências de apuração, incluindo erros numéricos.
Não basta testar se a lista de notas ignoradas está vazia, pois ela reúne motivos
de naturezas diferentes.

Teste reprovado: `test_empty_result_does_not_mask_invalid_origin_rate`.

## 2. [P2] Carga inicial ainda restaura a versão anterior após editar NCM

Local: `app/api/endpoints/regras_exclusao_parcial.py`, linhas 213–231.

A chave de identificação passou de NCM + termos para apenas NCM. Isso preserva
as edições dos termos, mas o NCM também é editável na API e na tela.

Reprodução:

1. Carregar as sete regras da Bahia.
2. Editar o NCM da regra de charque de `02102000` para `02109900`.
3. Carregar o padrão novamente.

Resultado: oito regras, incluindo uma regra ativa novamente para `02102000`.
O exemplo é apenas uma mudança de cadastro para testar identidade; não representa
recomendação de classificação fiscal. A carga deixa de respeitar a correção
anterior do cadastro e volta a excluir pelo código antigo.

Correção: usar um identificador de origem estável para cada regra inicial,
independente dos campos editáveis, como indicado na primeira revisão. Preservar
também estado ativo/inativo e tratar explicitamente a remoção de uma regra inicial.

Teste reprovado: `test_reload_preserves_correction_to_seed_ncm`.

## 3. [P2] A validação nova quebra a leitura de perfis no formato anterior

Local: `app/schemas/perfil_regras.py`, linhas 24–32 e 73.

O validador estrito também é herdado por `PerfilRegrasOut`, usado para responder
à consulta de perfis. A implementação anterior aceitava política global booleana,
mas a nova exige um dicionário de UFs, sem conversão dos registros existentes.

Reprodução: guardar um perfil com
`{"politica_aliquotas_iguais_parcial": true}`, formato aceito anteriormente,
e consultar `GET /api/v1/perfis-regras`.
Resultado: erro na serialização de `PerfilRegrasOut`; o endpoint falha ao listar
os perfis. O teste simulou um registro preexistente em banco isolado. Não foi
verificado se há registros desse formato em produção.

Correção: manter validação estrita na entrada e prover estratégia de leitura e
migração para os formatos antigos. A conversão deve respeitar o escopo decidido,
sem transformar silenciosamente a configuração em autorização global.

Teste reprovado: `test_existing_global_policy_does_not_break_profile_listing`.

## 4. [P2] UF com espaços é aceita, mas a política não entra em vigor

Locais: `app/schemas/perfil_regras.py`, linhas 29 e 64;
`app/services/rules_engine/parcial_decision.py`, linhas 90 e 111.

O validador verifica `uf_k.strip()`, mas devolve a chave original sem normalizar.
O carregamento do motor aplica apenas `upper()`. Assim, `" BA "` é aceita como
UF válida, persistida com espaços e não corresponde a `"BA"` durante a apuração.

Reprodução: salvar via API
`{"politica_aliquotas_iguais_parcial": {" BA ": true}}` nas configurações.
A API responde 200, mas o serviço retorna política inativa para BA.
O caso equivalente com `"ba"` sem espaços passou no motor com preload.

Correção: normalizar as chaves para UF canônica com `strip().upper()` e validar
contra a lista de UFs brasileiras, ou rejeitar chaves fora do formato aceito.
Usar o mesmo formato em entrada, persistência, consulta do motor e interface.
Tratar colisões após normalização, como `BA` e `ba` no mesmo objeto.

Teste reprovado: `test_accepted_uf_key_activates_correct_state[ BA ]`.

## Validações executadas nesta rodada

- **79 testes relevantes do projeto: aprovados.** Incluem as reproduções
  incorporadas pelo implementador e as suítes fiscais, SPED e fórmulas.
- **25 testes da revisão anterior: aprovados**, incluindo migração SQLite
  012 → 013 → 012 com dados existentes.
- **5 casos adicionais sobre as correções: 1 aprovado e 4 reprovados**, conforme
  os problemas descritos acima.
- **Frontend:** `npm.cmd run lint` e `npm.cmd run build` aprovados.
- Expressões da conferência revisadas: valor negativo real, distinção de nulo,
  débito, crédito e termos das regras estão presentes. Não houve teste visual
  completo no navegador.

As verificações utilizaram banco de teste e armazenamento isolado em
`.runtime-tmp/review-parcial`; nenhuma confirmação de implantação em produção
ou execução em PostgreSQL faz parte desta conclusão.

## Arquivo de reprodução dos casos restantes

`.runtime-tmp/review-parcial/test_recheck_edges.py`

Na raiz do projeto:

```powershell
$env:STORAGE_DIR = "$PWD/.runtime-tmp/review-parcial/storage"
$env:TEMPLATES_DIR = "$PWD/.runtime-tmp/review-parcial/storage/templates"
$env:OUTPUTS_DIR = "$PWD/.runtime-tmp/review-parcial/storage/outputs"
$env:UPLOADS_DIR = "$PWD/.runtime-tmp/review-parcial/storage/uploads"
$env:PYTHONPATH = "$PWD/tests;$PWD"
./.venv/Scripts/python.exe -m pytest -p conftest -p no:cacheprovider -q .runtime-tmp/review-parcial/test_recheck_edges.py --tb=short
```

Manter as expectativas dos quatro casos como testes de regressão e corrigir o
comportamento correspondente. Prioridade imediata: impedir conclusão sem valores
a recolher quando um item deixou de ser apurado por erro de validação.
