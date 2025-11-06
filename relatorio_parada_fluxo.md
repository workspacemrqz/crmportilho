# Relatório de Interrupção do Fluxo de Mensagens para Clientes/Leads

## Resumo Executivo

Este relatório documenta todas as ocasiões identificadas no sistema em que o fluxo automatizado de mensagens via chatbot é interrompido, seja temporariamente ou permanentemente, para clientes e leads.

---

## 1. Transferência para Atendimento Humano (Handoff)

### 1.1 Solicitação Explícita do Cliente
**Condição:** O cliente solicita explicitamente falar com um atendente humano  
**Palavras-chave detectadas:**
- "humano"
- "atendente"
- "pessoa"
- "quero falar com alguém"
- "falar com atendente"
- "atendimento humano"

**Ação do Sistema:**
- O bot marca handoff permanente em memória
- Atualiza status do lead para "transferido_humano"
- Define `isPermanentHandoff = true` no estado do chatbot
- Envia mensagem: "Obrigado pela paciência. Atenderemos você o mais rápido possível."

### 1.2 Opções de Menu que Requerem Atendimento Humano
**Condições - Opções do Menu Principal:**
- **Opção 2:** "Já sou cliente" → Transferência automática
- **Opção 3:** "Renovação" → Transferência automática
- **Opção 4:** "Endosso/Alteração" → Transferência automática
- **Opção 5:** "Parcelas/Boletos" → Transferência automática
- **Opção 6:** "Sinistros/Assistências" → Transferência automática

**Ação do Sistema:**
- Transfere imediatamente para atendimento humano
- Mensagem personalizada conforme a opção escolhida

### 1.3 Fluxos Específicos que Levam ao Handoff
**Fluxo Autorio - Veículo não está com o cliente:**
- Quando: Cliente informa que ainda não possui o veículo
- Ação: Coleta informações básicas e transfere para atendente

---

## 2. Intervenção Manual de Atendente

### 2.1 Mensagem Manual Enviada por Humano
**Condição:** Um atendente humano envia uma mensagem manual para a conversa  
**Detecção:** Campo `source` da mensagem diferente de "api" (ex: "app" ou "web")

**Ação do Sistema:**
- Desativa permanentemente respostas automáticas do bot para esse lead
- Marca handoff permanente em memória (`permanentHandoffConversations`)
- Define `isPermanentHandoff = true` no banco de dados
- Registra mensagem de sistema sobre a intervenção manual
- O bot não responde mais automaticamente até que seja reativado manualmente

---

## 3. Estados Finais da Conversa

### 3.1 Conversa Finalizada (conversa_finalizada)
**Condição:** Estado do chatbot = "conversa_finalizada"  
**Quando ocorre:**
- Após conclusão bem-sucedida do fluxo
- Após transferência para humano
- Após erros críticos

**Ação do Sistema:**
- Bot não processa mais mensagens para essa conversa
- Log: "Bot não responde em conversas finalizadas"

### 3.2 Conversa com Status "closed"
**Condição:** Status da conversa = "closed"  
**Quando ocorre:**
- Atendente fecha manualmente a conversa
- Sistema fecha após período de inatividade
- Após conclusão de atendimento

**Ação do Sistema:**
- Bot não responde a mensagens em conversas fechadas
- Necessário criar nova conversa para reiniciar atendimento

---

## 4. Erros e Falhas Técnicas

### 4.1 Erros de Envio de Mensagem
**Condições:**
- Falha na API WAHA após 3 tentativas
- Erro de rede ou timeout
- API do WhatsApp indisponível

**Mecanismo de Retry:**
```
Tentativa 1: Envia imediatamente
Tentativa 2: Aguarda 1 segundo
Tentativa 3: Aguarda 2 segundos
```

**Ação após falha:**
- Log do erro
- Mensagem não é entregue
- Fluxo é interrompido

### 4.2 Erros de Estado Desconhecido
**Condição:** Sistema encontra um estado não mapeado na máquina de estados  
**Exemplo:** Estado não existe no switch/case do `processStateMachine`

**Ação do Sistema:**
- Transfere automaticamente para atendente humano
- Log: "Estado desconhecido encontrado"
- Evita loop infinito ou comportamento inesperado

### 4.3 Erros de Processamento OpenAI
**Condições:**
- API OpenAI indisponível
- Erro de autenticação (API key inválida)
- Rate limit excedido
- Timeout na geração de resposta

**Ação do Sistema:**
- Tenta processar sem IA (fluxo degradado)
- Se crítico: transfere para humano
- Log do erro para análise

### 4.4 Erros de Banco de Dados
**Condições:**
- Conexão com PostgreSQL perdida
- Timeout de conexão (10 segundos)
- Pool de conexões esgotado
- Falha ao salvar/recuperar dados

**Ação do Sistema:**
- Fluxo é interrompido
- Mensagem de erro genérica ao cliente (se possível)
- Log detalhado do erro

---

## 5. Validações e Limites

### 5.1 Rate Limiting (Limite de Taxa)
**Limites Configurados:**
- **Webhook:** 30 requisições por minuto por IP
- **API Geral:** 100 requisições por minuto por IP
- **Atividade Suspeita:** 10 requisições por 15 minutos

**Ação quando excedido:**
- Retorna erro 429 (Too Many Requests)
- IP pode ser temporariamente bloqueado
- Mensagens não são processadas durante bloqueio

### 5.2 Validação de Webhook
**Validações:**
- Estrutura do payload (schema Zod)
- Autenticação do webhook
- Sanitização de dados (prevenção de injeção)

**Ação em falha:**
- Webhook rejeitado (400 ou 401)
- Mensagem não é processada
- Log de segurança registrado

### 5.3 Validação de Arquivos
**Limites:**
- Tamanho máximo: 10MB
- Tipos permitidos: JPEG, PNG, PDF, DOC, DOCX

**Ação em falha:**
- Upload rejeitado
- Erro retornado ao usuário
- Arquivo não é enviado ao WhatsApp

---

## 6. Controles de Tempo

### 6.1 Buffer de Mensagens
**Configuração:**
- Timeout padrão: 30 segundos
- Customizável via configurações do sistema
- Customizável por telefone específico

**Comportamento:**
- Agrupa mensagens consecutivas do cliente
- Processa após timeout ou quantidade máxima
- Se handoff ocorrer: buffer é limpo imediatamente

### 6.2 Timeout de Conexão de Banco
**Limites:**
- Conexão: 10 segundos
- Idle: 30 segundos
- Pool máximo: 20 conexões

**Ação em timeout:**
- Operação falha
- Retry automático em algumas operações
- Log de erro se persistir

---

## 7. Configurações e Ambiente

### 7.1 Variáveis de Ambiente Ausentes
**Variáveis Críticas:**
- `DATABASE_URL` - Sem isso, aplicação não inicia
- `OPENAI_API_KEY` - IA não funciona
- `WAHA_API` e `WAHA_API_KEY` - WhatsApp não funciona
- `SESSION_SECRET` - Autenticação comprometida

**Ação do Sistema:**
- Aplicação pode não iniciar
- Funcionalidades degradadas
- Erros em cascata

### 7.2 Serviços Externos Indisponíveis
**Serviços:**
- WAHA API (WhatsApp)
- Supabase Storage (arquivos)
- OpenAI API (processamento de linguagem)
- Chatwoot (integração de suporte)

**Ação em falha:**
- Funcionalidade específica não disponível
- Fallback quando possível
- Transferência para humano se crítico

---

## 8. Condições Especiais

### 8.1 Mensagens de Grupo
**Condição:** Mensagem vem de um grupo WhatsApp  
**Detecção:** Campo `isGroup = true`

**Ação do Sistema:**
- Bot pode ignorar mensagens de grupo
- Depende da configuração
- Log indicando origem de grupo

### 8.2 Guard de Memória para Handoff
**Mecanismo:** `permanentHandoffConversations` (Set em memória)

**Características:**
- Previne condições de corrida
- Persiste durante a sessão da aplicação
- Mais rápido que consulta ao banco
- Crítico para garantir handoff permanente

---

## Recomendações

### Para Manutenção do Sistema

1. **Monitoramento Proativo:**
   - Implementar alertas para falhas recorrentes
   - Dashboard de métricas de handoff
   - Análise de padrões de interrupção

2. **Gestão de Erros:**
   - Implementar circuit breakers para APIs externas
   - Fallbacks mais robustos
   - Queue de retry para mensagens falhas

3. **Otimização de Performance:**
   - Cache de templates de mensagem
   - Pool de conexões otimizado
   - Timeout adaptativo baseado em carga

### Para Experiência do Usuário

1. **Comunicação Clara:**
   - Mensagens de erro mais amigáveis
   - Expectativas claras sobre tempo de resposta
   - Status visível da conversa

2. **Recuperação Graceful:**
   - Opção de reiniciar conversa
   - Salvamento de progresso
   - Contexto preservado em handoffs

3. **Prevenção de Interrupções:**
   - Validação preventiva de dados
   - Detecção precoce de problemas
   - Avisos antes de timeouts

---

## 9. Correções Implementadas para Integração Chatwoot

### 9.1 Problema Identificado
**Descrição:** Quando um atendente humano envia mensagem via Chatwoot, a mensagem é enviada através da WAHA API com as seguintes características:
- `isFromMe: true` (porque vem da conta business)
- `source: "api"` (porque foi enviada via API)

Isso causava **dois problemas críticos:**
1. O bot não detectava a intervenção humana imediatamente
2. O webhook WAHA poderia processar a mensagem do atendente e criar um loop

### 9.2 Solução 1: Webhook do Chatwoot
**Implementação:** Endpoint `/api/webhook/chatwoot`

**Funcionamento:**
- Detecta evento `message_created` com `message_type: 'outgoing'`
- Identifica o telefone do lead através dos metadados da conversa
- Marca handoff permanente **ANTES** da mensagem ser enviada pelo WhatsApp
- Atualiza tanto memória (`permanentHandoffConversations`) quanto banco de dados (`isPermanentHandoff`)

**Benefícios:**
- Prevenção proativa: handoff é marcado **antes** do bot processar qualquer resposta
- Zero race conditions: impossível do bot responder após atendente assumir

### 9.3 Solução 2: Filtro de Mensagens API no Webhook WAHA
**Implementação:** Filtro adicional no endpoint `/api/webhook/waha`

**Código:**
```typescript
if (parsedMessage.isFromMe && parsedMessage.source === 'api') {
  console.log('[WAHA-WEBHOOK] 🤖 Mensagem enviada pelo bot via API - IGNORANDO para evitar loop');
  return res.status(200).json({ status: 'ignored', reason: 'bot-message-via-api' });
}
```

**Funcionamento:**
- Ignora **TODAS** as mensagens com `isFromMe: true` e `source: "api"`
- Isso inclui:
  - Mensagens enviadas pelo próprio bot
  - Mensagens enviadas por atendentes via Chatwoot
  - Qualquer outra mensagem enviada via API WAHA

**Benefícios:**
- Previne loops infinitos onde bot processaria suas próprias mensagens
- Protege contra race conditions no handoff
- Simples e efetivo

### 9.4 Camadas de Proteção Implementadas

O sistema agora possui **4 camadas de proteção** contra resposta indevida do bot:

**Camada 1: Webhook Chatwoot (Proativa)**
- Detecta quando atendente envia mensagem
- Marca handoff permanente ANTES da mensagem chegar ao webhook WAHA

**Camada 2: Filtro de Source API (Preventiva)**
- Ignora mensagens com `source: "api"` no webhook WAHA
- Evita loops e processamento desnecessário

**Camada 3: Guard em Memória (Performance)**
- Verificação em `permanentHandoffConversations` (Set)
- Mais rápido que banco de dados
- Previne race conditions

**Camada 4: Banco de Dados (Persistência)**
- Campo `isPermanentHandoff` no chatbot state
- Garante que handoff persiste mesmo após reinício
- Fonte única da verdade

### 9.5 Configuração Necessária

Para que o sistema funcione completamente, é necessário configurar o webhook do Chatwoot:

**URL do Webhook:** `https://[SEU-DOMINIO]/api/webhook/chatwoot`

**Eventos a Monitorar:**
- `message_created` (obrigatório)

**Headers:** Não são necessários headers de autenticação (endpoint público)

**Observações:**
- O webhook funciona apenas para mensagens outgoing (enviadas por atendentes)
- O webhook não processa mensagens do bot ou do cliente
- Recomenda-se configurar no Chatwoot: Settings > Integrations > Webhooks

---

## Conclusão

O sistema possui múltiplos pontos de interrupção do fluxo automatizado, desde condições planejadas (transferência para humano) até falhas técnicas (erros de API, timeouts). A maioria das interrupções são adequadamente tratadas com mecanismos de fallback ou transferência para atendimento humano, garantindo que o cliente não fique sem resposta.

As principais áreas de atenção são:
- **Confiabilidade:** Dependência de serviços externos (WhatsApp, OpenAI)
- **Performance:** Timeouts e limites de taxa podem afetar experiência
- **Recuperação:** Nem todos os erros têm recuperação automática

O sistema demonstra robustez adequada com múltiplas camadas de proteção, mas beneficiaria de melhorias em observabilidade e recuperação automática de falhas.

---

*Documento gerado em: ${new Date().toLocaleDateString('pt-BR')}*  
*Versão: 1.0*  
*Autor: Sistema de Análise Automatizada*