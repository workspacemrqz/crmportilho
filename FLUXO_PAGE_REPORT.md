# Relatório Completo - Página '/fluxo'

**Data do Relatório:** 21 de Novembro de 2025  
**Versão:** 1.0  
**Localização do Arquivo:** `client/src/pages/fluxo.tsx`

---

## 📋 Sumário Executivo

A página `/fluxo` é o **painel de configuração central do sistema de atendimento automático via WhatsApp** da aplicação Seguro IA. Ela permite que administradores configurem, customize e testem o comportamento do chatbot inteligente de seguros, sem necessidade de programação.

---

## 🎯 Propósito Principal

Fornecer uma interface abrangente para:
- Configurar mensagens padrão do atendimento
- Definir regras automáticas baseadas em palavras-chave
- Criar fluxos de conversa multi-etapas com IA
- Testar e validar respostas da IA em tempo real

---

## 🏗️ Arquitetura e Estrutura

### Camada de Frontend
- **Framework:** React com TypeScript
- **Localização:** `client/src/pages/fluxo.tsx`
- **Tamanho:** ~655 linhas de código
- **Biblioteca de UI:** Shadcn/ui components (Cards, Buttons, Textarea, etc.)
- **Gerenciamento de Estado:** React hooks (useState, useEffect)
- **Requisições HTTP:** TanStack React Query com mutations
- **Notificações:** Sistema de toast com feedback ao usuário

### Camada de Backend
- **Serviço IA:** `server/flow-ai.service.ts`
- **Rotas API:** Endpoints em `server/routes.ts`
- **Armazenamento:** PostgreSQL via Drizzle ORM (`server/storage.ts`)
- **Integração:** OpenAI API para geração de respostas inteligentes

---

## 💾 Estrutura de Dados

### 1. **FlowConfig** - Configuração Principal do Fluxo
```typescript
type FlowConfig = {
  id?: string;                          // ID único da configuração
  welcomeMessage: string;               // Mensagem de boas-vindas
  institutionalMessage: string;         // Informações institucionais
  importantInstructions: string;        // Instruções importantes
  globalPrompt: string;                 // Prompt global para IA
  isActive?: boolean;                   // Status de ativação
};
```

**Valores Padrão Inclusos:**
- Mensagem de boas-vindas com informações sobre as seguradoras
- Mensagem institucional com instruções sobre canais de comunicação
- Instruções para manutenção de qualidade no atendimento
- Prompt global definindo o comportamento do assistente

### 2. **KeywordRule** - Regras Automáticas por Palavra-chave
```typescript
type KeywordRule = {
  id?: string;
  keyword: string;                      // Palavra-chave disparadora
  response: string;                     // Resposta automática
  isActive?: boolean;                   // Status ativo/inativo
};
```

**Exemplos Padrão:**
- `"oi"` → "Olá! Como posso ajudá-lo hoje?"
- `"bom dia"` → "Bom dia! Seja bem-vindo à Seguro IA."
- `"link"` → "Aqui está o link do formulário de cotação."

### 3. **FlowStep** - Etapas do Fluxo Conversacional
```typescript
type FlowStep = {
  id?: string;
  stepId: string;                       // ID único da etapa (sem espaços)
  stepName: string;                     // Nome legível da etapa
  objective: string;                    // Objetivo da etapa
  stepPrompt: string;                   // Instruções para comportamento da IA
  routingInstructions: string;          // Como rotear para próxima etapa
  order: number;                        // Ordem de execução
  exampleMessage?: string;              // Mensagem de teste
};
```

### 4. **AIPreviewResponse** - Resposta da IA para Testes
```typescript
type AIPreviewResponse = {
  mensagemAgente: string;              // Resposta gerada pela IA
  proximaEtapaId: string | null;       // ID da próxima etapa (ou null)
};
```

---

## 🎨 Componentes e Seções da Interface

### Seção 1️⃣: **Mensagens Padrão**
**Objetivo:** Configurar mensagens iniciais do atendimento

**Campos Editáveis:**
- **Mensagem de Boas-vindas** (TextArea - 6 linhas)
  - Cumprimento inicial e informações sobre as seguradoras
  - Exemplo inclui emoji e formatação visual
  
- **Mensagem Institucional** (TextArea - 4 linhas)
  - Informações sobre canais de comunicação
  - Avisos importantes sobre comunicação
  
- **Instruções Importantes** (TextArea - 4 linhas)
  - Diretrizes gerais para o atendimento
  - Boas práticas a serem seguidas

**Data-testid:** `textarea-welcome-message`, `textarea-institutional-message`, `textarea-important-instructions`

---

### Seção 2️⃣: **Regras de Resposta por Palavra-chave**
**Objetivo:** Definir respostas automáticas simples baseadas em palavras-chave

**Funcionalidades:**
- ✅ Adicionar novas regras com botão "Adicionar Regra"
- ✅ Editar palavra-chave e resposta para cada regra
- ✅ Remover regras individuais
- ✅ Visualização clara de palavras-chave configuradas

**Estrutura de Cada Regra:**
```
┌─────────────────────────────────────┐
│ Palavra-chave: "oi"                │
│ Resposta: "Olá! Como posso..."     │
│ [Remove Button]                    │
└─────────────────────────────────────┘
```

**Data-testid:** `button-add-keyword`, `input-keyword-${index}`, `textarea-keyword-response-${index}`, `button-remove-keyword-${index}`

---

### Seção 3️⃣: **Fluxo com IA** (Principal Feature)
**Objetivo:** Configurar comportamento inteligente do chatbot com múltiplas etapas

#### **3.1 - Prompt Global do Agente**
- TextArea com 8 linhas
- Define a personalidade, tom e objetivo geral do assistente
- Exemplo padrão inclui:
  - Papel: Assistente digital Seguro IA
  - Tom: Cordial, profissional e objetivo
  - Objetivo: Conduzir lead ao formulário de cotação
  - Regras gerais de interação

**Data-testid:** `textarea-global-prompt`

#### **3.2 - Etapas do Fluxo**
Sistema de múltiplas etapas, cada uma com:

**Campos Configuráveis:**
1. **ID da Etapa** (Input)
   - Identificador único sem espaços
   - Exemplo: `identificacao_inicial`, `tipo_seguro`

2. **Nome da Etapa** (Input)
   - Nome legível e amigável
   - Exemplo: "Identificação Inicial"

3. **Objetivo da Etapa** (TextArea - 2 linhas)
   - O que essa etapa deve alcançar
   - Exemplo: "Identificar se é cliente ou nova cotação"

4. **Prompt da Etapa** (TextArea - 3 linhas)
   - Instruções específicas para IA
   - Que perguntas fazer?
   - Como se comportar?

5. **Instruções de Roteamento** (TextArea - 3 linhas)
   - Em linguagem natural (não código!)
   - Exemplos:
     - "Se o lead disser que já é cliente, siga para 'atendimento_cliente'"
     - "Se disser que quer nova cotação, siga para 'tipo_seguro'"

6. **Testar com IA** (Preview Section)
   - Input para mensagem de teste do cliente
   - Botão "Testar Resposta" com ícone Sparkles
   - Exibe resposta gerada e próxima etapa sugerida

**Data-testid:** 
- `button-add-step`, `button-remove-step-${index}`
- `input-step-id-${index}`, `input-step-name-${index}`
- `textarea-step-objective-${index}`, `textarea-step-prompt-${index}`
- `textarea-step-routing-${index}`

#### **Etapas Padrão Pré-configuradas:**

1. **Identificação Inicial**
   - ID: `identificacao_inicial`
   - Objetivo: Identificar se é cliente ou cotação nova
   - Rota para: `atendimento_cliente` ou `tipo_seguro`

2. **Tipo de Seguro**
   - ID: `tipo_seguro`
   - Objetivo: Identificar tipo de seguro desejado
   - Rota para: `detalhes_auto`, `detalhes_residencial`, `encaminhamento_especialista`

3. **Detalhes do Seguro Auto**
   - ID: `detalhes_auto`
   - Objetivo: Coletar informações básicas do veículo
   - Rota para: `envio_formulario` ou `produto_nao_disponivel`

4. **Envio do Formulário**
   - ID: `envio_formulario`
   - Objetivo: Enviar link do formulário de cotação
   - Rota para: `aguardando_preenchimento` ou `tratamento_objecao`

5. **Aguardando Preenchimento**
   - ID: `aguardando_preenchimento`
   - Objetivo: Confirmar recebimento e orientar
   - Rota para: `confirmacao_dados` ou repetir

---

## 🔄 Fluxo de Operação e Estados

### 1. **Carregamento Inicial**
```
App Mounted
    ↓
useQuery('/api/flows/active') executada
    ↓
activeFlow carregado com dados salvos
    ↓
useEffect atualiza config, keywords, steps
    ↓
UI renderizada com dados
```

### 2. **Edição de Configurações**
```
Usuário edita campos
    ↓
State local atualizado (React Hook)
    ↓
Mudanças não persistidas até "Salvar"
    ↓
Usuário clica "Salvar Fluxo"
    ↓
saveMutation executada
```

### 3. **Salvamento de Dados**
```
saveMutation.mutate() chamada
    ↓
Validação básica local
    ↓
Se config.id existe:
  → PUT /api/flows/{id} (atualizar)
Senão:
  → POST /api/flows (criar novo)
  → POST /api/flows/{newId}/activate (ativar)
    ↓
queryClient.invalidateQueries(['api/flows/active'])
    ↓
Toast de sucesso/erro
    ↓
Cache atualizado, UI refreshada
```

### 4. **Teste com IA (Preview)**
```
Usuário digita mensagem de teste
    ↓
Clica "Testar Resposta"
    ↓
previewMutation.mutate() chamada com:
  - promptGlobal
  - etapaAtual (dados atuais)
  - etapasDefinidas (todas as etapas)
  - mensagemClienteExemplo (texto digitado)
    ↓
POST /api/ia/preview chamado
    ↓
FlowAIService.generateFlowStepPreview() processada
    ↓
OpenAI gera resposta + próxima etapa
    ↓
Resultado exibido em UI
    ↓
Toast de confirmação
```

---

## 🤖 Integração com IA (OpenAI)

### Serviço: `FlowAIService`
**Localização:** `server/flow-ai.service.ts`

**Método Principal:** `generateFlowStepPreview(request)`

**Processo:**
1. Recebe configuração de testes
2. Cria prompt de orquestração técnico (sistema fixo)
3. Injeta contexto global + etapa atual
4. Envia para OpenAI Chat API
5. Parseia resposta JSON
6. Retorna mensagem do agente + próxima etapa

**Prompt de Orquestração (Técnico):**
```
Você é um sistema de orquestração de fluxo de atendimento inteligente.

CONTEXTO GLOBAL DO AGENTE:
[promptGlobal do usuário]

ETAPA ATUAL: [nome da etapa]
OBJETIVO DA ETAPA: [objetivo]

INSTRUÇÕES ESPECÍFICAS DA ETAPA:
[prompt da etapa]

INSTRUÇÕES DE ROTEAMENTO:
[instruções de roteamento em linguagem natural]

ETAPAS DISPONÍVEIS NO FLUXO:
[lista de todas as etapas]

TAREFA:
1. Gerar resposta apropriada seguindo objetivo e instruções
2. Decidir próxima etapa usando instruções de roteamento

RESPONDER APENAS EM JSON VÁLIDO
```

---

## 💾 Integração com Backend e Banco de Dados

### Endpoints da API

#### **GET /api/flows/active**
- **Autenticação:** Requerida (`requireAuth`)
- **Retorna:** Configuração ativa com keywords e steps
- **Uso:** Carregamento inicial do formulário

#### **POST /api/flows**
- **Autenticação:** Requerida
- **Payload:** FlowConfig + keywords + steps
- **Retorna:** Nova configuração com ID
- **Uso:** Criar novo fluxo

#### **PUT /api/flows/{id}**
- **Autenticação:** Requerida
- **Payload:** Campos atualizados
- **Retorna:** Configuração atualizada
- **Uso:** Atualizar fluxo existente

#### **POST /api/flows/{id}/activate**
- **Autenticação:** Requerida
- **Uso:** Ativar uma configuração como ativa

#### **POST /api/ia/preview**
- **Autenticação:** Requerida
- **Payload:** Configuração de teste com step e mensagem
- **Retorna:** AIPreviewResponse (mensagem + próxima etapa)
- **Validação:** Zod schema com validações obrigatórias
- **Uso:** Testar resposta da IA

### Schema Zod de Validação
```typescript
flowStepPreviewSchema = {
  promptGlobal: string (min 1),
  etapaAtual: {
    id: string (min 1),
    nome: string (min 1),
    objetivo: string (min 1),
    promptEtapa: string (min 1),
    instrucoesRoteamento: string (min 1)
  },
  etapasDefinidas: [
    { id: string (min 1), nome: string (min 1) }
  ] (min 1),
  historicoConversaExemplo: [] (optional),
  mensagemClienteExemplo: string (min 1)
}
```

### Tabelas do Banco de Dados

#### **flowConfigs**
- `id` (PK)
- `welcomeMessage` (text)
- `institutionalMessage` (text)
- `importantInstructions` (text)
- `globalPrompt` (text)
- `isActive` (boolean)
- `createdAt`, `updatedAt` (timestamps)

#### **keywordRules**
- `id` (PK)
- `flowConfigId` (FK)
- `keyword` (string)
- `response` (text)
- `isActive` (boolean)
- `createdAt`, `updatedAt` (timestamps)

#### **flowSteps**
- `id` (PK)
- `flowConfigId` (FK)
- `stepId` (string unique)
- `stepName` (string)
- `objective` (text)
- `stepPrompt` (text)
- `routingInstructions` (text)
- `order` (integer)
- `isActive` (boolean)
- `createdAt`, `updatedAt` (timestamps)

---

## 🛡️ Segurança e Validação

### Validações Client-side
- TextArea não permite vazio para campos obrigatórios (configuração é opcional ao usuário)
- Inputs específicos para ID têm placeholder de formato
- Mensagens de exemplo requeridas para preview

### Validações Server-side
- `requireAuth` middleware em todos endpoints
- Zod schema validation para POST /api/ia/preview
- Validação de IDs e formato de dados

### Proteção de Dados
- Senhas/Chaves armazenadas seguramente
- OpenAI API key em variáveis de ambiente
- Sessão de usuário obrigatória

---

## 🎯 Funcionalidades Principais

### ✅ Funcionalidades Implementadas

| Funcionalidade | Status | Descrição |
|---|---|---|
| Configurar mensagens padrão | ✅ | Editar boas-vindas, institucional, instruções |
| Gerenciar regras por palavra-chave | ✅ | CRUD completo de keywords |
| Criar etapas do fluxo | ✅ | CRUD de steps com suporte a múltiplas etapas |
| Testar com IA | ✅ | Preview de respostas da IA |
| Salvar configurações | ✅ | Persistência em banco de dados |
| Carregar configurações ativas | ✅ | Recuperar dados salvos ao carregar página |
| Feedback visual | ✅ | Toast notifications para sucesso/erro |
| Loading states | ✅ | Spinners durante requisições |
| Responsividade | ✅ | Layout adaptável para mobile/desktop |

---

## 📊 Performance e Otimizações

- **React Query Caching:** Cache de dados automático com invalidação estratégica
- **Lazy Loading:** Carregamento inicial com spinner
- **Debounce:** Não aplicado (entrada local), apenas ao salvar
- **Componentes Otimizados:** Usar de componentes Shadcn pré-otimizados
- **Data-testids:** Todos elementos interativos têm identificadores para testes

---

## 🧪 Testabilidade

Todos elementos interativos possuem `data-testid`:

**Principais:**
- `text-page-title` - Título da página
- `button-save-flow` - Botão salvar
- `button-add-keyword` - Adicionar regra
- `button-add-step` - Adicionar etapa
- `textarea-global-prompt` - Prompt global
- Todos inputs/textareas de steps com índice

---

## ⚠️ Limitações Conhecidas

1. **Sem Persistência Local:** Se navegação sair da página, dados não salvos são perdidos
2. **Sem Versioning:** Não há histórico de versões anteriores
3. **Sem Duplicação:** Não é possível duplicar uma configuração existente
4. **Sem Reordenação Visual:** Ordem de steps apenas por índice após adição
5. **Sem Validação Cruzada:** Roteamento não valida se etapas referenciadas existem

---

## 🚀 Melhorias Futuras Recomendadas

1. **Drag-and-drop** para reordenar etapas
2. **Histórico de versões** com rollback
3. **Duplicação de configurações** para templates
4. **Validação de roteamento** contra etapas existentes
5. **Teste em lote** para múltiplas mensagens
6. **Sugestões de IA** para prompts baseado em melhores práticas
7. **Análise de fluxo** com visualização em graph
8. **Exportação/Importação** de configurações
9. **Temas predefinidos** para casos de uso comuns
10. **Análise de desempenho** do fluxo em produção

---

## 📝 Notas de Desenvolvimento

### Variáveis de Ambiente Requeridas
```
OPENAI_API_KEY=your-key-here
```

### Dependências Críticas
- `@tanstack/react-query` - Gerenciamento de estado de servidor
- `react-hook-form` + `@hookform/resolvers/zod` - Formulários
- `drizzle-orm` - ORM do banco de dados
- `zod` - Validação de schema
- `openai` - SDK da OpenAI

### Fluxo de Deploy
1. Alterações em Frontend → Build Vite
2. Alterações em Backend → Rebuild server
3. Migrations automáticas se schema mudar
4. Restart de workflows conforme necessário

---

## 🔗 Relacionamentos e Dependências

```
FluxoPage (client/src/pages/fluxo.tsx)
    ↓
    ├─→ TanStack React Query (useQuery, useMutation)
    ├─→ Shadcn Components (Card, Button, etc.)
    ├─→ API Endpoints (server/routes.ts)
    │    ├─→ /api/flows/active (GET)
    │    ├─→ /api/flows (POST)
    │    ├─→ /api/flows/{id} (PUT)
    │    └─→ /api/ia/preview (POST)
    │
    ├─→ FlowAIService (server/flow-ai.service.ts)
    │    └─→ OpenAI API
    │
    └─→ Storage Layer (server/storage.ts)
         └─→ PostgreSQL Database
              ├─→ flowConfigs table
              ├─→ keywordRules table
              └─→ flowSteps table
```

---

## 📞 Suporte e Contato

Para dúvidas sobre implementação ou comportamento da página `/fluxo`, consulte:
- Código-fonte: `client/src/pages/fluxo.tsx`
- Serviço IA: `server/flow-ai.service.ts`
- Rotas API: `server/routes.ts`
- Documentação do TypeScript para tipos

---

**Fim do Relatório**

---

*Este relatório foi gerado automaticamente e fornece uma visão técnica completa da página '/fluxo' do sistema Seguro IA.*
