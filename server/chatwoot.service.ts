import axios, { AxiosInstance } from 'axios';

interface ChatwootConfig {
  apiUrl: string;
  apiToken: string;
  accountId: string;
  inboxId: string;
}

interface ChatwootContact {
  id: number;
  name: string;
  email?: string;
  phone_number?: string;
  identifier?: string;
  custom_attributes?: Record<string, any>;
}

interface ChatwootConversation {
  id: number;
  account_id: number;
  inbox_id: number;
  contact_id: number;
  status: string;
  priority: string;
  labels: string[];
}

interface CreateContactPayload {
  name: string;
  email?: string;
  phone_number?: string;
  identifier?: string;
  custom_attributes?: Record<string, any>;
}

interface CreateConversationPayload {
  source_id: string;
  inbox_id: number;
  contact_id: number;
  status?: 'open' | 'resolved' | 'pending';
  custom_attributes?: Record<string, any>;
  message?: {
    content: string;
  };
}

export class ChatwootService {
  private client: AxiosInstance;
  private config: ChatwootConfig;

  constructor() {
    this.config = {
      apiUrl: process.env.CHATWOOT_API_URL || '',
      apiToken: process.env.CHATWOOT_API_TOKEN || '',
      accountId: process.env.CHATWOOT_ACCOUNT_ID || '',
      inboxId: process.env.CHATWOOT_INBOX_ID || '',
    };

    if (!this.config.apiUrl || !this.config.apiToken || !this.config.accountId || !this.config.inboxId) {
      console.warn('[ChatwootService] ⚠️ Chatwoot credentials not configured. Service will not function.');
    }

    this.client = axios.create({
      baseURL: `${this.config.apiUrl}/api/v1/accounts/${this.config.accountId}`,
      headers: {
        'Content-Type': 'application/json',
        'api_access_token': this.config.apiToken,
      },
    });
  }

  /**
   * Verifica se o serviço está configurado corretamente
   */
  isConfigured(): boolean {
    return !!(this.config.apiUrl && this.config.apiToken && this.config.accountId && this.config.inboxId);
  }

  /**
   * Busca um contato existente por telefone ou identificador
   */
  async findContact(phone: string): Promise<ChatwootContact | null> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping findContact');
      return null;
    }

    try {
      console.log(`[ChatwootService] 🔍 Buscando contato com telefone: ${phone}`);
      
      // Chatwoot API usa o endpoint /contacts/search
      const response = await this.client.get('/contacts/search', {
        params: { q: phone }
      });

      const contacts = response.data.payload || [];
      
      if (contacts.length > 0) {
        console.log(`[ChatwootService] ✅ Contato encontrado: ID ${contacts[0].id}`);
        return contacts[0];
      }

      console.log('[ChatwootService] ℹ️ Nenhum contato encontrado');
      return null;
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao buscar contato:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Cria um novo contato no Chatwoot
   */
  async createContact(payload: CreateContactPayload): Promise<ChatwootContact | null> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping createContact');
      return null;
    }

    try {
      console.log(`[ChatwootService] 📝 Criando contato: ${payload.name}`);
      
      const response = await this.client.post('/contacts', payload);
      const contact = response.data.payload;
      
      console.log(`[ChatwootService] ✅ Contato criado: ID ${contact.id}`);
      return contact;
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao criar contato:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Busca ou cria um contato
   */
  async findOrCreateContact(name: string, phone: string, email?: string, cpf?: string): Promise<ChatwootContact | null> {
    // Primeiro, tenta buscar o contato existente
    let contact = await this.findContact(phone);

    if (contact) {
      return contact;
    }

    // Se não encontrou, cria um novo
    const customAttributes: Record<string, any> = {};
    if (cpf) {
      customAttributes.cpf = cpf;
    }

    return await this.createContact({
      name,
      phone_number: phone,
      email,
      identifier: phone,
      custom_attributes: Object.keys(customAttributes).length > 0 ? customAttributes : undefined,
    });
  }

  /**
   * Cria uma nova conversação no Chatwoot
   */
  async createConversation(
    contactId: number,
    sourceId: string,
    initialMessage?: string
  ): Promise<ChatwootConversation | null> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping createConversation');
      return null;
    }

    try {
      console.log(`[ChatwootService] 💬 Criando conversação para contato ID: ${contactId}`);
      
      const payload: CreateConversationPayload = {
        source_id: sourceId,
        inbox_id: parseInt(this.config.inboxId),
        contact_id: contactId,
        status: 'open',
      };

      if (initialMessage) {
        payload.message = {
          content: initialMessage,
        };
      }

      const response = await this.client.post('/conversations', payload);
      const conversation = response.data;
      
      console.log(`[ChatwootService] ✅ Conversação criada: ID ${conversation.id}`);
      return conversation;
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao criar conversação:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Adiciona labels/tags a uma conversação
   */
  async addLabels(conversationId: number, labels: string[]): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping addLabels');
      return false;
    }

    try {
      console.log(`[ChatwootService] 🏷️ Adicionando labels à conversação ${conversationId}:`, labels);
      
      await this.client.post(`/conversations/${conversationId}/labels`, {
        labels,
      });
      
      console.log('[ChatwootService] ✅ Labels adicionadas com sucesso');
      return true;
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao adicionar labels:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Define a prioridade de uma conversação
   */
  async setPriority(conversationId: number, priority: 'low' | 'medium' | 'high' | 'urgent'): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping setPriority');
      return false;
    }

    try {
      console.log(`[ChatwootService] ⚡ Definindo prioridade da conversação ${conversationId} como: ${priority}`);
      
      await this.client.post(`/conversations/${conversationId}/toggle_priority`, {
        priority,
      });
      
      console.log('[ChatwootService] ✅ Prioridade definida com sucesso');
      return true;
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao definir prioridade:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Envia uma mensagem para uma conversação existente
   */
  async sendMessage(conversationId: number, message: string, messageType: 'incoming' | 'outgoing' = 'incoming'): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping sendMessage');
      return false;
    }

    try {
      console.log(`[ChatwootService] 📨 Enviando mensagem para conversação ${conversationId}`);
      
      await this.client.post(`/conversations/${conversationId}/messages`, {
        content: message,
        message_type: messageType,
      });
      
      console.log('[ChatwootService] ✅ Mensagem enviada com sucesso');
      return true;
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao enviar mensagem:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Cria conversação completa com contato, prioridade e labels
   * Método principal para integração com o fluxo de seguros
   */
  async createInsuranceConversation(
    leadName: string,
    leadPhone: string,
    leadEmail: string | undefined,
    leadCpf: string | undefined,
    protocol: string,
    priority: 'urgent' | 'medium',
    labels: string[],
    initialMessage?: string
  ): Promise<{ contactId: number; conversationId: number } | null> {
    if (!this.isConfigured()) {
      console.warn('[ChatwootService] Service not configured, skipping createInsuranceConversation');
      return null;
    }

    try {
      console.log(`[ChatwootService] 🚀 Criando conversação de seguro para ${leadName} (${protocol})`);

      // 1. Buscar ou criar contato
      const contact = await this.findOrCreateContact(leadName, leadPhone, leadEmail, leadCpf);
      
      if (!contact) {
        console.error('[ChatwootService] ❌ Falha ao criar/encontrar contato');
        return null;
      }

      // 2. Criar conversação
      const conversation = await this.createConversation(
        contact.id,
        protocol,
        initialMessage
      );

      if (!conversation) {
        console.error('[ChatwootService] ❌ Falha ao criar conversação');
        return null;
      }

      // 3. Adicionar labels
      if (labels.length > 0) {
        await this.addLabels(conversation.id, labels);
      }

      // 4. Definir prioridade
      await this.setPriority(conversation.id, priority);

      console.log(`[ChatwootService] ✅ Conversação completa criada: Contact ID ${contact.id}, Conversation ID ${conversation.id}`);

      return {
        contactId: contact.id,
        conversationId: conversation.id,
      };
    } catch (error: any) {
      console.error('[ChatwootService] ❌ Erro ao criar conversação de seguro:', error);
      return null;
    }
  }
}

// Export singleton instance
export const chatwootService = new ChatwootService();
