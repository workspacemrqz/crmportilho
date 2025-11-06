# Guia de Configuração: Webhook do Chatwoot

## Objetivo

Este guia explica como configurar o webhook do Chatwoot para garantir que o chatbot seja desativado permanentemente quando um atendente humano assumir uma conversa.

---

## Por que isso é necessário?

Quando um atendente envia uma mensagem via Chatwoot, essa mensagem é enviada através da API WAHA e pode ter características que dificultam a detecção automática de intervenção humana. O webhook do Chatwoot permite que o sistema seja notificado **ANTES** da mensagem ser enviada pelo WhatsApp, garantindo que o bot não responda após o atendente assumir.

---

## Passo a Passo

### 1. Acessar Configurações do Chatwoot

1. Faça login no seu Chatwoot
2. Vá para **Settings** (Configurações)
3. Navegue até **Integrations** > **Webhooks**

### 2. Adicionar Novo Webhook

Clique em **"Add new webhook"** ou **"Adicionar webhook"**

### 3. Configurar o Webhook

Preencha os seguintes campos:

**URL do Webhook:**
```
https://[SEU-DOMINIO]/api/webhook/chatwoot
```

Substitua `[SEU-DOMINIO]` pelo domínio real da sua aplicação.

**Exemplos:**
- `https://chatbot.portilho.com.br/api/webhook/chatwoot`
- `https://280e77c0-1522-442a-b2c1-ea0223156155-00-1ikkad91hj0mp.worf.replit.dev/api/webhook/chatwoot`

### 4. Selecionar Eventos

Selecione **APENAS** o seguinte evento:
- ✅ **message_created** (obrigatório)

**Importante:** NÃO selecione outros eventos para evitar processamento desnecessário.

### 5. Headers (Opcional)

Não é necessário configurar headers de autenticação. O endpoint é público e seguro.

### 6. Salvar

Clique em **Save** ou **Salvar** para ativar o webhook.

---

## Testando o Webhook

### Como testar:

1. Inicie uma conversa com o chatbot via WhatsApp
2. Abra a conversa correspondente no Chatwoot
3. Como atendente, envie uma mensagem para o cliente
4. Verifique os logs do sistema para confirmar:

**Logs esperados:**
```
[CHATWOOT-WEBHOOK] 🎯 Webhook recebido!
[CHATWOOT-WEBHOOK] Event: message_created
[CHATWOOT-WEBHOOK] 🚨 Atendente enviou mensagem!
[CHATWOOT-WEBHOOK] ✅ Marcando handoff permanente para conversation: [ID]
[CHATWOOT-WEBHOOK] 🔇 Bot desativado permanentemente para lead: [PROTOCOL]
```

5. Tente enviar uma nova mensagem como cliente
6. Confirme que o **bot NÃO responde** automaticamente

---

## Solução de Problemas

### O webhook não está sendo chamado

**Possíveis causas:**
- URL do webhook incorreta
- Evento `message_created` não selecionado
- Firewall bloqueando requisições do Chatwoot

**Solução:**
- Verifique a URL (deve terminar em `/api/webhook/chatwoot`)
- Confirme que o evento está marcado
- Verifique logs de firewall/segurança

### O bot continua respondendo após atendente assumir

**Possíveis causas:**
- Webhook não configurado
- Webhook retornando erro
- Race condition (timing muito apertado)

**Solução:**
- Verifique se webhook está ativo no Chatwoot
- Consulte logs do sistema para erros
- Reinicie a aplicação se necessário

### Mensagens duplicadas ou loops

**Possíveis causas:**
- Múltiplos webhooks configurados
- Eventos incorretos selecionados

**Solução:**
- Remova webhooks duplicados
- Mantenha APENAS o evento `message_created`
- Limpe o cache do Chatwoot

---

## Arquitetura de Handoff

O sistema implementa **4 camadas de proteção** para garantir que o bot não responda após intervenção humana:

### Camada 1: Webhook Chatwoot (Proativa)
- Detecta quando atendente envia mensagem
- Marca handoff **ANTES** da mensagem ser processada

### Camada 2: Filtro de Source API (Preventiva)
- Ignora mensagens enviadas via API no webhook WAHA
- Evita loops e processamento duplicado

### Camada 3: Guard em Memória (Performance)
- Verificação rápida em `permanentHandoffConversations`
- Previne race conditions

### Camada 4: Banco de Dados (Persistência)
- Campo `isPermanentHandoff` garante persistência
- Sobrevive a reinícios da aplicação

---

## Payload do Webhook

Para referência técnica, o webhook espera o seguinte payload do Chatwoot:

```json
{
  "event": "message_created",
  "message_type": "outgoing",
  "content": "Mensagem do atendente",
  "conversation": {
    "id": 123,
    "meta": {
      "sender": {
        "phone_number": "+5512974041539",
        "identifier": "+5512974041539"
      }
    }
  },
  "sender": {
    "id": 1,
    "name": "Atendente Nome"
  }
}
```

**Campos importantes:**
- `event`: Deve ser "message_created"
- `message_type`: Deve ser "outgoing"
- `conversation.meta.sender.phone_number`: Telefone do lead
- `sender.name`: Nome do atendente (para logs)

---

## Monitoramento

### Logs Importantes

O sistema registra todos os eventos de handoff. Consulte os logs para:

**Sucesso:**
```
[CHATWOOT-WEBHOOK] ✅ Marcando handoff permanente
[CHATWOOT-WEBHOOK] 🔇 Bot desativado permanentemente
```

**Erro:**
```
[CHATWOOT-WEBHOOK] Erro: [descrição do erro]
```

### Métricas Recomendadas

- Taxa de handoff manual vs. automático
- Tempo médio até primeiro handoff
- Taxa de erro no webhook
- Conversas com intervenção humana

---

## Segurança

### Notas de Segurança

- O endpoint `/api/webhook/chatwoot` é público por design
- Rate limiting está ativo (30 req/min por IP)
- Validações de payload são aplicadas
- Logs de segurança registram todas as requisições

### Proteção Adicional (Opcional)

Se desejar adicionar autenticação ao webhook:

1. Configure um token secreto no Chatwoot
2. Modifique o código do endpoint para validar o token
3. Adicione middleware de autenticação em `server/routes.ts`

---

## Suporte

Para dúvidas ou problemas:

1. Consulte os logs do sistema (`/tmp/logs/dev_*.log`)
2. Verifique o status do webhook no Chatwoot
3. Teste manualmente enviando uma requisição POST para o endpoint
4. Revise a documentação do Chatwoot sobre webhooks

---

**Última atualização:** Novembro 2025  
**Versão:** 1.0
