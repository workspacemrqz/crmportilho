# Placeholders de Personalização

## Funcionalidade

O sistema agora suporta placeholders nas mensagens dos nodes (tanto fixas quanto de IA) que são substituídos automaticamente pelos dados do cliente.

## Placeholders Disponíveis

### `{nome}`
- **Descrição**: Substitui pelo **primeiro nome** do cliente
- **Exemplo**: 
  - Cliente: "Gabriel Marquez"
  - Mensagem: "Olá, {nome}! Como posso ajudar?"
  - Resultado: "Olá, Gabriel! Como posso ajudar?"

## Como Usar

1. **Em Nodes de Mensagem Fixa (Manual)**:
   - No editor de fluxo, ao criar ou editar um node de mensagem fixa
   - Digite `{nome}` em qualquer lugar do texto
   - Exemplo: "Oi, {nome}! Tudo ótimo por aqui, e com você?"

2. **Em Nodes de IA**:
   - No prompt do node de IA, você pode usar `{nome}`
   - A IA receberá o prompt com o placeholder já substituído
   - Exemplo no prompt: "Responda ao {nome} de forma cordial..."

## Implementação Técnica

A substituição acontece automaticamente em `chatbot.service.ts`:

```typescript
// Extrai o primeiro nome
private extractFirstName(lead: Lead): string {
  const fullName = lead.name || lead.whatsappName || '';
  const firstName = fullName.trim().split(/\s+/)[0];
  return firstName;
}

// Substitui placeholders
private replacePlaceholders(text: string, lead: Lead): string {
  const firstName = this.extractFirstName(lead);
  if (firstName) {
    return text.replace(/\{nome\}/gi, firstName);
  }
  return text;
}
```

## Onde a Substituição Ocorre

- ✅ Mensagens fixas (nodes manuais)
- ✅ Mensagens de IA (nodes com IA)
- ✅ Múltiplas mensagens em sequência
- ✅ Case-insensitive (`{nome}`, `{NOME}`, `{Nome}` funcionam)

## Exemplo Prático

**Antes (hardcoded):**
```
"Oi, Gabriel! Tudo ótimo por aqui, e com você?"
```

**Depois (com placeholder):**
```
"Oi, {nome}! Tudo ótimo por aqui, e com você?"
```

Resultado para diferentes clientes:
- Gabriel Marquez → "Oi, Gabriel! Tudo ótimo por aqui, e com você?"
- Maria Silva → "Oi, Maria! Tudo ótimo por aqui, e com você?"
- João Santos → "Oi, João! Tudo ótimo por aqui, e com você?"
