import OpenAI from 'openai';

interface FlowStepPreviewRequest {
  promptGlobal: string;
  etapaAtual: {
    id: string;
    nome: string;
    objetivo: string;
    promptEtapa: string;
    instrucoesRoteamento: string;
  };
  etapasDefinidas: Array<{
    id: string;
    nome: string;
  }>;
  historicoConversaExemplo?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  mensagemClienteExemplo: string;
}

interface FlowStepPreviewResponse {
  mensagemAgente: string;
  proximaEtapaId: string | null;
}

export class FlowAIService {
  private openai: OpenAI | null = null;

  constructor() {
  }

  private getOpenAIClient(): OpenAI {
    if (!this.openai) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY não configurada nas variáveis de ambiente. Configure a chave para usar funcionalidades de IA.');
      }
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }

  async generateFlowStepPreview(request: FlowStepPreviewRequest): Promise<FlowStepPreviewResponse> {
    const openai = this.getOpenAIClient();
    const { 
      promptGlobal, 
      etapaAtual, 
      etapasDefinidas, 
      historicoConversaExemplo = [], 
      mensagemClienteExemplo 
    } = request;

    // Construir lista de IDs de etapas disponíveis
    const etapasDisponiveis = etapasDefinidas.map(e => `"${e.id}" (${e.nome})`).join(', ');

    // Prompt técnico fixo de orquestração
    const promptOrquestracao = `Você é um sistema de orquestração de fluxo de atendimento inteligente.

CONTEXTO GLOBAL DO AGENTE:
${promptGlobal}

ETAPA ATUAL: ${etapaAtual.nome} (ID: ${etapaAtual.id})
OBJETIVO DA ETAPA: ${etapaAtual.objetivo}

INSTRUÇÕES ESPECÍFICAS DA ETAPA:
${etapaAtual.promptEtapa}

INSTRUÇÕES DE ROTEAMENTO:
${etapaAtual.instrucoesRoteamento}

ETAPAS DISPONÍVEIS NO FLUXO:
${etapasDisponiveis}

TAREFA:
Com base no histórico da conversa e na mensagem atual do cliente, você deve:
1. Gerar uma mensagem de resposta apropriada do agente seguindo o objetivo e instruções da etapa atual.
2. Decidir qual deve ser a próxima etapa do fluxo usando as instruções de roteamento fornecidas.

IMPORTANTE:
- A mensagem do agente deve ser cordial, profissional e seguir o tom de voz definido no contexto global.
- A próxima etapa deve ser escolhida APENAS entre os IDs das etapas disponíveis listadas acima.
- Se o fluxo deve ser encerrado, use null para proximaEtapaId.
- Responda APENAS em formato JSON válido, sem texto adicional.

FORMATO DE RESPOSTA (JSON):
{
  "mensagemAgente": "texto da mensagem que será enviada ao cliente",
  "proximaEtapaId": "id_da_proxima_etapa" ou null
}`;

    // Construir mensagens para a API
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: promptOrquestracao
      }
    ];

    // Adicionar histórico de conversa se fornecido
    if (historicoConversaExemplo.length > 0) {
      messages.push(...historicoConversaExemplo.map(msg => ({
        role: msg.role,
        content: msg.content
      })));
    }

    // Adicionar mensagem atual do cliente
    messages.push({
      role: 'user',
      content: mensagemClienteExemplo
    });

    try {
      // Chamar API da OpenAI
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });

      const responseContent = completion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('Resposta vazia da API OpenAI');
      }

      // Parse da resposta JSON
      const response: FlowStepPreviewResponse = JSON.parse(responseContent);

      // Validar resposta
      if (!response.mensagemAgente) {
        throw new Error('Resposta da IA não contém mensagemAgente');
      }

      // Validar se a próxima etapa existe (se não for null)
      if (response.proximaEtapaId !== null) {
        const etapaValida = etapasDefinidas.some(e => e.id === response.proximaEtapaId);
        if (!etapaValida) {
          console.warn(`IA sugeriu etapa inválida: ${response.proximaEtapaId}. Definindo como null.`);
          response.proximaEtapaId = null;
        }
      }

      return response;

    } catch (error: any) {
      console.error('Erro ao chamar OpenAI API:', error);
      
      if (error.code === 'invalid_api_key') {
        throw new Error('Chave da API OpenAI inválida');
      }
      
      if (error instanceof SyntaxError) {
        throw new Error('Erro ao processar resposta da IA: JSON inválido');
      }
      
      throw new Error(`Erro ao gerar preview do fluxo: ${error.message}`);
    }
  }
}

export const flowAIService = new FlowAIService();
