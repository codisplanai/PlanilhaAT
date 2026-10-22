# Consulta de NF-e em PDF — Meu DANFE v2

Integração opcional e sob demanda, voltada à revisão humana da classificação fiscal. Não altera as regras automáticas de apuração.

## Pontos de uso

- Modal de bonificação / amostra grátis / outras saídas: consulta para escolher antecipação parcial ou DIFAL.
- Modal do Convênio ICMS 52/91: conferir discriminação, NCM, CST e tratamento do produto.
- Relatório de itens excluídos / MVA pendente e histórico de processamento: rastreabilidade fiscal.

O botão **Visualizar DANFE** examina somente arquivos XML e ZIP selecionados na sessão e envia exclusivamente o XML da chave solicitada. Nada é enviado automaticamente durante o processamento normal. Se o XML não estiver disponível, o sistema tenta obter documento já cadastrado no Meu DANFE (sem nova consulta cobrada); se ausente, exige confirmação adicional antes da busca pela chave, que pode custar R$ 0,03 segundo o fornecedor.

**Privacidade:** a empresa Meu DANFE armazena NF-e convertidas na Área do Cliente do serviço. Ao usar o botão, o usuário autoriza o envio de um XML específico ou de uma chave fiscal ao terceiro, sujeito aos contratos aplicáveis e às políticas internas e à LGPD. O backend do Planaut não persiste o XML/PDF.

## Configuração

1. Crie a Api-Key na [Área do Cliente](https://web.meudanfe.com.br/signed/apikey), em API / Integração.
2. Adicione a variável secreta de backend MEUDANFE_API_KEY no projeto Vercel do Planaut, para os ambientes desejados. No backend local, use o .env.
3. Nunca use prefixo VITE_ ou exponha a Api-Key ao navegador. Faça novo deploy após definir a variável.

Sem a chave, somente a consulta DANFE informa 503; a apuração fiscal permanece funcional.

Documentação: https://meudanfe.com.br/doc/v2.php?v=260827.0.0

## Contrato

POST /api/v1/danfe/pdf — usuário autenticado (Bearer token). Body JSON com chave_acesso (44 dígitos), xml opcional e buscar_por_chave (boolean). Retorna application/pdf, com Cache-Control no-store. Um GET ao fornecedor verifica gratuitamente documento armazenado. PUT add/chave somente quando buscar_por_chave=true e GET retornou 404.

Pesquisa pode retornar WAITING/SEARCHING e o backend responde 409 para permitir nova tentativa após intervalo. Sem XML, a interface oferece confirmação extra para potencial consulta cobrada.

O serviço fixa os endpoints externos, verifica chave correspondente ao infNFe.Id, NF-e modelo 55, limita XML a 20 MB, PDF a 15 MB, rejeita DTD/entidades e PDF não válido. Não loga segredo ou conteúdo fiscal; cache no frontend limitado à instância do componente na sessão.

A consulta não decide automaticamente classificação, regulamentação ou destino de planilha. Cobertura: tests/test_meu_danfe.py.
