# ⚠️ CONFIGURAÇÃO URGENTE: Webhook do Chatwoot

## Problema Atual

O bot continua respondendo mesmo após o atendente assumir a conversa via Chatwoot porque **o webhook ainda não foi configurado**.

## Solução Imediata

Siga estes passos AGORA:

### 1. Acesse o Chatwoot

Faça login em: https://[SEU-CHATWOOT-URL]

### 2. Vá para Webhooks

1. Clique em **Settings** (Configurações)
2. Clique em **Integrations** (Integrações)  
3. Clique em **Webhooks**

### 3. Adicione o Webhook

Clique em **"Add new webhook"**

Configure assim:

**URL:**
```
https://280e77c0-1522-442a-b2c1-ea0223156155-00-1ikkad91hj0mp.worf.replit.dev/api/webhook/chatwoot
```

**Events (Eventos):**
- ✅ Marque **APENAS**: `message_created`
- ❌ NÃO marque outros eventos

**Descrição (opcional):**
```
Desativa bot quando atendente assume conversa
```

### 4. Salvar

Clique em **Save** ou **Salvar**

### 5. Testar

1. Inicie uma nova conversa com o bot pelo WhatsApp
2. Abra a conversa no Chatwoot
3. Como atendente, envie uma mensagem
4. Verifique que o bot **NÃO responde mais**

## Como Saber se Está Funcionando

Você verá estes logs no sistema:

```
[CHATWOOT-WEBHOOK] 🎯 Webhook recebido!
[CHATWOOT-WEBHOOK] Event: message_created
[CHATWOOT-WEBHOOK] 🚨 Atendente enviou mensagem!
[CHATWOOT-WEBHOOK] ✅ Marcando handoff permanente
[CHATWOOT-WEBHOOK] 🔇 Bot desativado permanentemente
```

Se não ver esses logs, o webhook não está configurado corretamente.

## Por Que o Webhook É Obrigatório?

Quando o atendente envia mensagem via Chatwoot:
- A mensagem é enviada pela WAHA API
- Ela tem `source: "api"` (igual às mensagens do bot)
- **Sem o webhook, é IMPOSSÍVEL distinguir** se a mensagem veio do bot ou do atendente

O webhook do Chatwoot avisa o sistema ANTES da mensagem ser enviada, permitindo desativar o bot a tempo.

## Alternativa Temporária (NÃO RECOMENDADA)

Se por algum motivo não conseguir configurar o webhook, você pode:

1. Desativar o bot manualmente no CRM após assumir a conversa
2. Ou enviar a palavra-chave "humano" como primeira mensagem (isso aciona o handoff)

**Mas isso NÃO é ideal!** Configure o webhook para funcionar automaticamente.

---

**Status Atual:** ❌ Webhook NÃO configurado  
**Prioridade:** 🔴 URGENTE  
**Tempo estimado:** 2 minutos
