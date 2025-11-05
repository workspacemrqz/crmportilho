// Chatbot Service with state machine and message templates
import { db } from './db';
import { 
  leads, 
  conversations, 
  messages, 
  chatbotStates,
  vehicles,
  quotes,
  type Lead,
  type Conversation,
  type ChatbotState,
  type InsertLead,
  type InsertConversation,
  type InsertChatbotState,
  type InsertVehicle,
  type InsertQuote
} from '@shared/schema';
import { WAHAService } from './waha.service';
import { eq, and, desc, ne } from 'drizzle-orm';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';

// Initialize OpenAI with direct API key from secrets
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Type definitions for ChatbotState context
interface ChatbotContext {
  welcomeSent?: boolean;
  [key: string]: any;
}

interface ChatbotCollectedData {
  escolha?: string;
  tipoSeguro?: string;
  veiculoComCliente?: boolean;
  dadosPessoais?: any;
  dadosVeiculo?: any;
  tipoRenovacao?: string;
  tipoIdentificador?: string;
  tipoEndosso?: string;
  [key: string]: any;
}

interface ChatbotMenuSelections {
  mainMenu?: string;
  [key: string]: any;
}

interface MessageBuffer {
  phone: string;
  messages: Array<{
    content: string;
    timestamp: number;
    messageData: any;
  }>;
  timer: NodeJS.Timeout | null;
  startTime: number;
}

export class ChatbotService {
  private wahaAPI: WAHAService;
  private messageTemplatesCache: Map<string, string> = new Map();
  private cacheExpiry: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes cache
  private messageBuffers: Map<string, MessageBuffer> = new Map();
  private bufferTimeoutMs: number = 30000; // Cache do valor (default 30s)
  private settingsCacheTime: number = 0;
  private SETTINGS_CACHE_TTL = 60000; // 1 minuto

  // Required fields by chatbot state for validation
  private readonly REQUIRED_FIELDS_BY_STATE: Record<string, string[]> = {
    'dados_pessoais': ['name', 'cpf', 'phone', 'birthDate', 'maritalStatus', 'address', 'cep', 'email', 'profession', 'isPrincipalDriver'],
    'dados_veiculo': ['placa', 'marca', 'modelo', 'ano'],
  };

  constructor() {
    this.wahaAPI = new WAHAService();
    // Carregar configurações iniciais
    void this.loadSettings();
  }

  // Utility functions for data formatting
  private cleanMessagePrefix(text: string): string {
    // Remove "Mensagem N:" prefix from buffered messages
    return text.replace(/^Mensagem\s+\d+:\s*/i, '').trim();
  }

  private extractNumbers(text: string): string {
    // Remove everything except numbers
    return text.replace(/\D/g, '');
  }

  private formatCPF(cpf: string): string {
    // Remove tudo que não é número
    const numbers = this.extractNumbers(cpf);
    
    // Se tiver 11 dígitos, formata como XXX.XXX.XXX-XX
    if (numbers.length === 11) {
      return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    
    // Se não tiver 11 dígitos, retorna os números sem formatação
    return numbers;
  }

  private formatCNPJ(cnpj: string): string {
    // Remove tudo que não é número
    const numbers = this.extractNumbers(cnpj);
    
    // Se tiver 14 dígitos, formata como XX.XXX.XXX/XXXX-XX
    if (numbers.length === 14) {
      return numbers.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    
    // Se não tiver 14 dígitos, retorna os números sem formatação
    return numbers;
  }

  private formatCEP(cep: string): string {
    // Remove tudo que não é número
    const numbers = this.extractNumbers(cep);
    
    // Se tiver 8 dígitos, formata como XXXXX-XXX
    if (numbers.length === 8) {
      return numbers.replace(/(\d{5})(\d{3})/, '$1-$2');
    }
    
    // Se não tiver 8 dígitos, retorna os números sem formatação
    return numbers;
  }

  private formatPhone(phone: string): string {
    // Remove tudo que não é número
    const numbers = this.extractNumbers(phone);
    
    // Se tiver 11 dígitos (celular), formata como (XX) XXXXX-XXXX
    if (numbers.length === 11) {
      return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    }
    
    // Se tiver 10 dígitos (fixo), formata como (XX) XXXX-XXXX
    if (numbers.length === 10) {
      return numbers.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }
    
    // Se não tiver 10 ou 11 dígitos, retorna os números sem formatação
    return numbers;
  }

  // Load message templates from database with caching
  private async loadMessageTemplates(): Promise<void> {
    const now = Date.now();
    
    // Return cached templates if still valid
    if (this.messageTemplatesCache.size > 0 && now < this.cacheExpiry) {
      return;
    }

    // Import storage dynamically to avoid circular dependency
    const { storage } = await import('./storage');
    
    // Load all active workflow templates from database
    const templates = await storage.getWorkflowTemplates({ isActive: true });
    
    // Update cache
    this.messageTemplatesCache.clear();
    templates.forEach(template => {
      this.messageTemplatesCache.set(template.templateKey, template.content);
    });
    
    this.cacheExpiry = now + this.cacheTTL;
  }

  // Get message template with fallback
  private async getMessageTemplate(key: string): Promise<string> {
    await this.loadMessageTemplates();
    
    const template = this.messageTemplatesCache.get(key);
    if (!template) {
      console.warn(`Template ${key} not found in database, using fallback`);
      return `[Template ${key} não encontrado]`;
    }
    
    return template;
  }

  // Initialize method kept for backward compatibility (now loads from DB)
  private async initializeMessageTemplates() {
    // Load templates from database on initialization
    await this.loadMessageTemplates();
  }

  // Public method to invalidate the message templates cache
  public invalidateCache(): void {
    console.log('Invalidating ChatbotService message templates cache');
    this.messageTemplatesCache.clear();
    this.cacheExpiry = 0;
  }

  // Load system settings from database with caching
  private async loadSettings() {
    try {
      const { storage } = await import('./storage');
      const settings = await storage.getSystemSettings();
      this.bufferTimeoutMs = settings.bufferTimeoutSeconds * 1000;
      this.settingsCacheTime = Date.now();
      console.log(`[ChatbotService] Buffer timeout set to ${settings.bufferTimeoutSeconds} seconds`);
    } catch (error) {
      console.error('[ChatbotService] Error loading settings, using default 30s:', error);
      this.bufferTimeoutMs = 30000;
    }
  }

  // Get buffer timeout with cache refresh
  private async getBufferTimeout(): Promise<number> {
    // Refresh cache if expired
    if (Date.now() - this.settingsCacheTime > this.SETTINGS_CACHE_TTL) {
      await this.loadSettings();
    }
    return this.bufferTimeoutMs;
  }

  // Public method for manual refresh (useful after settings update)
  public async refreshSettings() {
    await this.loadSettings();
  }

  async processIncomingMessage(phone: string, messageContent: string, messageData: any) {
    try {
      console.log(`[ChatbotService] processIncomingMessage called with phone: ${phone}`);
      
      // Validate phone is not null/empty
      if (!phone || phone.trim() === '') {
        throw new Error('Phone number is required but was null or empty');
      }
      
      // Buscar ou criar buffer para este telefone
      let buffer = this.messageBuffers.get(phone);
      
      if (!buffer) {
        // For first message, use shorter timeout for better responsiveness
        const isFirstMessage = true;
        const timeout = isFirstMessage ? 3000 : await this.getBufferTimeout(); // 3 seconds for first message
        
        console.log(`[ChatbotService] Starting new ${timeout/1000}s buffer for ${phone} (first message: ${isFirstMessage})`);
        buffer = {
          phone,
          messages: [],
          timer: null,
          startTime: Date.now()
        };
        this.messageBuffers.set(phone, buffer);
        
        // Start timer with dynamic timeout
        buffer.timer = setTimeout(() => {
          void this.flushBuffer(phone).catch(err => {
            console.error(`[ChatbotService] Error flushing buffer for ${phone}:`, err);
            this.messageBuffers.delete(phone);
          });
        }, timeout); // Use shorter timeout for first message
      }
      
      // Adicionar mensagem ao buffer
      buffer.messages.push({
        content: messageContent,
        timestamp: Date.now(),
        messageData
      });
      
      const timeoutMs = await this.getBufferTimeout();
      const timeRemaining = timeoutMs - (Date.now() - buffer.startTime);
      console.log(`[ChatbotService] Message buffered (${buffer.messages.length} total). Timer ends in ${timeRemaining}ms`);

    } catch (error) {
      console.error('Error processing incoming message:', error);
      throw error;
    }
  }

  private async flushBuffer(phone: string) {
    const buffer = this.messageBuffers.get(phone);
    if (!buffer || buffer.messages.length === 0) {
      console.log(`[ChatbotService] No messages to flush for ${phone}`);
      return;
    }
    
    console.log(`[ChatbotService] ========== INÍCIO DO PROCESSAMENTO DE BUFFER ==========`);
    console.log(`[ChatbotService] 📱 Telefone: ${phone}`);
    console.log(`[ChatbotService] 📨 Mensagens coletadas: ${buffer.messages.length}`);
    console.log(`[ChatbotService] ⏱️ Tempo de buffer: ${Date.now() - buffer.startTime}ms`);
    
    try {
      // Limpar timer
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      
      // Remover buffer do Map (reset para próximo ciclo)
      this.messageBuffers.delete(phone);
      
      // Concatenar todas as mensagens
      const allMessages = buffer.messages
        .map((msg, idx) => `Mensagem ${idx + 1}: ${msg.content}`)
        .join('\n');
      
      console.log(`[ChatbotService] 📝 Conteúdo combinado das mensagens:\n${allMessages}`);
      
      // Processar usando a primeira mensagem como base, mas com conteúdo combinado
      const firstMessage = buffer.messages[0];
      
      // Lógica ORIGINAL de processamento (que estava em processIncomingMessage)
      
      // Extract contact info from message metadata if available
      const contactInfo = {
        name: firstMessage.messageData?.name,
        pushName: firstMessage.messageData?.pushName
      };
      
      // Find or create lead with contact information
      let lead = await this.findOrCreateLead(phone, contactInfo);
      console.log('[ChatbotService] Lead found/created:', lead.id, lead.protocol, 'Name:', lead.name || 'N/A');
      
      // Find or create conversation
      let conversation = await this.findOrCreateConversation(lead.id, lead.protocol);
      
      // Store all incoming messages
      for (const msg of buffer.messages) {
        // Determine message type from messageData
        const messageType = msg.messageData?.type || 'text';
        console.log(`[ChatbotService] 💬 Saving message with type: ${messageType}`);
        
        // Check if this is a media message that needs processing
        const isMediaMessage = ['image', 'document', 'media'].includes(messageType);
        let enrichedMetadata = msg.messageData;
        
        if (isMediaMessage) {
          console.log('[ChatbotService] 📎 Media message detected, processing...');
          try {
            const mediaMetadata = await this.processMediaMessage(msg.messageData, lead.id, conversation.id);
            
            // Merge media metadata with original messageData
            enrichedMetadata = {
              ...msg.messageData,
              mediaProcessing: mediaMetadata,
              messageId: msg.messageData?.id || msg.messageData?.messageId,
              mimetype: mediaMetadata.mimetype || msg.messageData?.mimetype,
              filename: mediaMetadata.filename || msg.messageData?.filename,
              mediaUrl: mediaMetadata.mediaUrl || msg.messageData?._data?.mediaUrl,
              size: mediaMetadata.size || msg.messageData?.size
            };
            
            console.log('[ChatbotService] ✅ Media processed and metadata enriched');
          } catch (error) {
            console.error('[ChatbotService] ❌ Error processing media, saving message anyway:', error);
          }
        }
        
        await db.insert(messages).values({
          conversationId: conversation.id,
          content: msg.content,
          isBot: false,
          messageType,
          metadata: enrichedMetadata
        });
      }

      console.log(`[ChatbotService] 🔑 FlushBuffer - conversationId: ${conversation.id} | protocol: ${lead.protocol}`);
      
      // Get or create chatbot state
      let chatbotState = await this.getOrCreateChatbotState(conversation.id);

      // Check if bot is permanently disabled due to human handoff
      if (chatbotState.isPermanentHandoff) {
        console.log(`[ChatbotService] 🔇 Bot PERMANENTEMENTE DESATIVADO para lead ${lead.protocol}. Apenas atendentes humanos podem responder.`);
        return;
      }

      // Check for human handoff request (check all messages)
      const hasHandoffRequest = buffer.messages.some(msg => this.isHumanHandoffRequest(msg.content));
      if (hasHandoffRequest) {
        await this.handleHumanHandoff(lead, conversation, 'Cliente solicitou atendimento humano');
        return;
      }

      // Process message based on current state with combined message content
      console.log(`[ChatbotService] 🔄 Processando mensagens com estado: ${chatbotState.currentState}`);
      console.log(`[ChatbotService] 📊 Dados coletados antes do processamento:`, JSON.stringify(chatbotState.collectedData));
      
      await this.processStateMachine(lead, conversation, chatbotState, allMessages);
      
      console.log(`[ChatbotService] ========== FIM DO PROCESSAMENTO DE BUFFER ==========`);
      
    } catch (error) {
      console.error(`[ChatbotService] ❌ ERRO CRÍTICO ao processar buffer para ${phone}:`, error);
      console.error('[ChatbotService] 📊 Stack trace:', error instanceof Error ? error.stack : 'N/A');
      
      // Log do erro sem tentar acessar variáveis fora de escopo
      console.error('[ChatbotService] 📊 Tentando preservar dados existentes após erro');
      
      // Tentar enviar mensagem de erro para o usuário
      try {
        await this.wahaAPI.sendText(
          phone,
          'Desculpe, encontrei um problema técnico. Vou transferir você para um atendente humano que poderá ajudá-lo melhor.',
          undefined // conversation.id pode não estar disponível
        );
      } catch (sendError) {
        console.error('[ChatbotService] ❌ Falha ao enviar mensagem de erro:', sendError);
      }
    }
  }

  private async processMediaMessage(messageData: any, leadId: string, conversationId: string): Promise<any> {
    try {
      console.log('[ChatbotService] 📎 Processing media message...');
      
      // Extract media information from messageData
      const messageId = messageData?.id || messageData?.messageId;
      const mimetype = messageData?.mimetype || messageData?._data?.mimetype;
      const mediaUrl = messageData?._data?.mediaUrl || messageData?.mediaUrl;
      const size = messageData?.size || messageData?._data?.size;
      
      // Extract filename from various possible locations
      let filename = 
        messageData?.filename ||
        messageData?.body ||
        messageData?._data?.filename ||
        messageData?._data?.caption ||
        `media_${messageId || Date.now()}`;
      
      // Add extension based on mimetype if not present
      if (filename && !path.extname(filename) && mimetype) {
        const ext = mimetype.split('/')[1]?.split(';')[0];
        if (ext) {
          filename = `${filename}.${ext}`;
        }
      }
      
      console.log('[ChatbotService] 📎 Media info:', { messageId, filename, mimetype, size, hasMediaUrl: !!mediaUrl });
      
      if (!messageId && !mediaUrl) {
        console.warn('[ChatbotService] ⚠️ No messageId or mediaUrl found, cannot download media');
        return { filename, mimetype, size, mediaUrl };
      }
      
      // Download the media file
      console.log('[ChatbotService] 📥 Downloading media...');
      const mediaBuffer = await this.wahaAPI.downloadMedia(messageId, mediaUrl);
      
      if (!mediaBuffer) {
        console.error('[ChatbotService] ❌ Failed to download media');
        return { filename, mimetype, size, mediaUrl, error: 'download_failed' };
      }
      
      // Generate unique filename for storage
      const timestamp = Date.now();
      const ext = path.extname(filename) || '.bin';
      const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueFilename = `${baseName}_${timestamp}${ext}`;
      const filePath = path.join('uploads', uniqueFilename);
      
      // Save file to uploads directory
      await fs.writeFile(filePath, mediaBuffer);
      console.log('[ChatbotService] 💾 Media saved to:', filePath);
      
      // Determine document type based on filename or mimetype
      let docType: 'CNH' | 'CRLV' | 'nota_fiscal' | 'chassi' | 'apolice' | 'outro' = 'outro';
      const filenameLower = filename.toLowerCase();
      if (filenameLower.includes('cnh') || filenameLower.includes('carteira')) {
        docType = 'CNH';
      } else if (filenameLower.includes('crlv') || filenameLower.includes('documento')) {
        docType = 'CRLV';
      } else if (filenameLower.includes('nota') || filenameLower.includes('fiscal')) {
        docType = 'nota_fiscal';
      } else if (filenameLower.includes('chassi')) {
        docType = 'chassi';
      } else if (filenameLower.includes('apolice') || filenameLower.includes('apólice')) {
        docType = 'apolice';
      }
      
      // Create document record in database
      const { storage } = await import('./storage');
      const document = await storage.createDocument({
        leadId,
        filename: uniqueFilename,
        type: docType,
        url: filePath,
        mimeType: mimetype || undefined,
        size: size || mediaBuffer.length
      });
      
      console.log('[ChatbotService] ✅ Document record created:', document.id);
      
      // Return enriched metadata
      return {
        filename: uniqueFilename,
        originalFilename: filename,
        mimetype,
        size: size || mediaBuffer.length,
        mediaUrl,
        messageId,
        savedPath: filePath,
        documentId: document.id,
        documentType: docType
      };
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Error processing media message:', error);
      return { error: 'processing_failed', details: error instanceof Error ? error.message : String(error) };
    }
  }

  private async findOrCreateLead(phone: string, contactInfo?: { name?: string; pushName?: string }): Promise<Lead> {
    console.log(`[ChatbotService] findOrCreateLead - phone: ${phone}, contactInfo:`, contactInfo);
    
    // Find lead by whatsappPhone instead of phone
    const [existingLead] = await db.select()
      .from(leads)
      .where(eq(leads.whatsappPhone, phone))
      .limit(1);

    if (existingLead) {
      // Sempre atualizar o whatsappName quando recebemos um novo valor do WhatsApp
      const incomingName = contactInfo?.pushName || contactInfo?.name;
      if (incomingName && incomingName !== existingLead.whatsappName) {
        console.log(`[ChatbotService] Updating lead ${existingLead.id} with whatsappName: "${incomingName}" (previous: "${existingLead.whatsappName || 'EMPTY'}")`);
        const [updatedLead] = await db.update(leads)
          .set({ whatsappName: incomingName })
          .where(eq(leads.id, existingLead.id))
          .returning();
        return updatedLead;
      }
      console.log(`[ChatbotService] Lead ${existingLead.id} already has whatsappName: "${existingLead.whatsappName}"`);
      return existingLead;
    }

    // Generate new protocol
    const protocol = this.generateProtocol();
    
    // Usar o nome do contato do WhatsApp se disponível
    const contactName = contactInfo?.pushName || contactInfo?.name || null;

    console.log(`[ChatbotService] Creating new lead with whatsappPhone: ${phone}, whatsappName: ${contactName || 'N/A'}`);

    // Create lead with whatsappPhone filled, phone will be filled during conversation
    // whatsappName: Name from WhatsApp contact (pushName)
    // name: Will be filled during conversation via GPT-4 extraction
    const [newLead] = await db.insert(leads).values({
      whatsappPhone: phone,
      whatsappName: contactName,
      protocol,
      status: 'novo',
      priority: 'normal',
      tags: []
    }).returning();

    return newLead;
  }

  private async findOrCreateConversation(leadId: string, protocol: string): Promise<Conversation> {
    console.log(`[ChatbotService] 🔎 findOrCreateConversation - leadId: ${leadId} | protocol: ${protocol}`);
    
    // 🔧 CORREÇÃO CRÍTICA: Procurar por conversas NÃO fechadas (active, waiting, transferred)
    // Isso evita criar nova conversa quando uma foi transferida para humano
    // O controle de handoff é feito via handoffUntil no chatbotState
    
    // Primeiro, vamos buscar TODAS as conversas desse lead para debugging
    const allConversations = await db.select()
      .from(conversations)
      .where(eq(conversations.leadId, leadId))
      .orderBy(desc(conversations.lastActivity));
    
    console.log(`[ChatbotService] 📊 Total de conversas para lead ${leadId}: ${allConversations.length}`);
    if (allConversations.length > 0) {
      console.log(`[ChatbotService] 📋 Conversas existentes:`);
      allConversations.forEach((conv, idx) => {
        console.log(`[ChatbotService]   ${idx + 1}. ID: ${conv.id} | Status: ${conv.status} | Created: ${conv.startedAt}`);
      });
    }
    
    const [existingConversation] = await db.select()
      .from(conversations)
      .where(and(
        eq(conversations.leadId, leadId),
        ne(conversations.status, 'closed')
      ))
      .orderBy(desc(conversations.lastActivity))
      .limit(1);

    if (existingConversation) {
      console.log(`[ChatbotService] ✅ Conversa existente encontrada - ID: ${existingConversation.id} | Status: ${existingConversation.status}`);
      console.log(`[ChatbotService] ✅ REUTILIZANDO conversa existente - NÃO criando nova!`);
      
      // Update last activity
      await db.update(conversations)
        .set({ lastActivity: new Date() })
        .where(eq(conversations.id, existingConversation.id));
      
      return existingConversation;
    }

    console.log(`[ChatbotService] ⚠️⚠️⚠️ NENHUMA CONVERSA NÃO-FECHADA ENCONTRADA!`);
    console.log(`[ChatbotService] ⚠️ CRIANDO NOVA CONVERSA para lead: ${leadId} | protocol: ${protocol}`);
    console.log(`[ChatbotService] ⚠️ Stack trace de onde foi chamado:`, new Error().stack);
    
    const [newConversation] = await db.insert(conversations).values({
      leadId,
      protocol,
      status: 'active',
      currentMenu: 'initial',
      currentStep: 'welcome'
    }).returning();

    console.log(`[ChatbotService] ✨ Nova conversa criada - ID: ${newConversation.id}`);
    return newConversation;
  }

  private async getOrCreateChatbotState(conversationId: string): Promise<ChatbotState> {
    console.log(`[ChatbotService] 🔍 getOrCreateChatbotState chamado para conversation: ${conversationId}`);
    
    const [existingState] = await db.select()
      .from(chatbotStates)
      .where(eq(chatbotStates.conversationId, conversationId))
      .limit(1);

    if (existingState) {
      console.log(`[ChatbotService] ✅ Estado existente encontrado - NÃO criando novo estado`);
      console.log(`[ChatbotService] 📊 Estado: ${existingState.currentState} | ID: ${existingState.id}`);
      console.log(`[ChatbotService] 📊 CollectedData:`, JSON.stringify(existingState.collectedData));
      console.log(`[ChatbotService] 🔄 Estado existente encontrado: ${existingState.currentState} (ID: ${existingState.id})`);
      console.log(`[ChatbotService] 📊 Dados coletados no estado: ${JSON.stringify(existingState.collectedData)}`);
      
      // PROTEÇÃO CRÍTICA: Se o estado já tem dados coletados, NUNCA permitir volta para initial
      if (existingState.currentState === 'initial' && existingState.collectedData && Object.keys(existingState.collectedData).length > 0) {
        console.log('[ChatbotService] ⚠️ ALERTA: Estado "initial" detectado mas já há dados coletados!');
        console.log('[ChatbotService] 🛡️ PROTEÇÃO ATIVADA: Mantendo estado anterior e dados coletados.');
        
        // Determinar o estado apropriado baseado nos dados coletados
        const collectedData = existingState.collectedData as ChatbotCollectedData;
        let appropriateState = 'initial';
        
        if (collectedData.dadosPessoais && collectedData.dadosVeiculo) {
          appropriateState = 'aguardando_documentos';
        } else if (collectedData.dadosPessoais) {
          appropriateState = 'fluxo_auto_dados_pessoais_confirmacao';
        } else if (collectedData.tipoSeguro) {
          appropriateState = 'fluxo_auto_status';
        } else if (collectedData.escolha) {
          appropriateState = 'menu1_tipo_seguro';
        } else if (collectedData.mainMenu) {
          appropriateState = 'menu_selection';
        }
        
        console.log(`[ChatbotService] 🔧 Corrigindo estado de "initial" para "${appropriateState}" baseado nos dados coletados`);
        
        // Atualizar o estado no banco para o estado apropriado
        await db.update(chatbotStates)
          .set({ currentState: appropriateState })
          .where(eq(chatbotStates.id, existingState.id));
        
        existingState.currentState = appropriateState;
      }
      
      return existingState;
    }

    console.log(`[ChatbotService] ⚠️⚠️⚠️ CRIANDO NOVO ESTADO - conversation: ${conversationId}`);
    console.log(`[ChatbotService] ⚠️ Stack trace de onde foi chamado:`, new Error().stack);
    console.log(`[ChatbotService] ✨ Criando NOVO estado para conversação ${conversationId}`);
    console.log(`[ChatbotService] ⚠️ IMPORTANTE: Novo estado será criado como 'initial'`);
    
    const [newState] = await db.insert(chatbotStates).values({
      conversationId,
      currentState: 'initial',
      context: {},
      menuSelections: {},
      collectedData: {},
      pendingActions: []
    }).returning();

    console.log(`[ChatbotService] ✅ Novo estado criado com ID: ${newState.id}`);
    return newState;
  }

  private async processStateMachine(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    const state = chatbotState.currentState;

    switch(state) {
      case 'initial':
        await this.handleInitialState(lead, conversation, chatbotState);
        break;
      
      case 'menu_selection':
        await this.handleMenuSelection(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'menu1_como_conheceu':
        await this.handleMenu1ComoConheceu(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'menu1_seguros_novos':
        await this.handleMenu1SegurosNovos(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'menu1_tipo_seguro':
        await this.handleMenu1TipoSeguro(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'menu2_autorio_status':
        await this.handleMenu2AutorioStatus(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'menu2_autorio_quando_pega':
        await this.handleMenu2AutorioQuandoPega(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'fluxo_auto_status':
        await this.handleFluxoAutoStatus(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'fluxo_auto_dados_pessoais':
        await this.handleFluxoAutoDadosPessoais(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'fluxo_auto_dados_pessoais_confirmacao':
        await this.handleFluxoAutoDadosPessoaisConfirmacao(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'fluxo_auto_dados_veiculo':
        await this.handleFluxoAutoDadosVeiculo(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_estacionamento':
        await this.handleDadosVeiculoEstacionamento(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_portao':
        await this.handleDadosVeiculoPortao(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_trabalho_estudo':
        await this.handleDadosVeiculoTrabalhoEstudo(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_moradia':
        await this.handleDadosVeiculoMoradia(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_carro_reserva':
        await this.handleDadosVeiculoCarroReserva(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_reboque':
        await this.handleDadosVeiculoReboque(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_condutor_menor_25':
        await this.handleDadosVeiculoCondutorMenor25(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'dados_veiculo_tipo_uso':
        await this.handleDadosVeiculoTipoUso(lead, conversation, chatbotState, messageContent);
        break;

      case 'menu3_renovacao':
        await this.handleMenu3Renovacao(lead, conversation, chatbotState, messageContent);
        break;

      case 'menu4_endosso':
        await this.handleMenu4Endosso(lead, conversation, chatbotState, messageContent);
        break;

      case 'menu5_parcelas':
        await this.handleMenu5Parcelas(lead, conversation, chatbotState, messageContent);
        break;

      case 'menu6_sinistros':
        await this.handleMenu6Sinistros(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'aguardando_apolice':
        await this.handleAguardandoApolice(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'fluxo_auto_quando_pega':
        await this.handleFluxoAutoQuandoPega(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'aguardando_identificador':
        await this.handleAguardandoIdentificador(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'aguardando_identificador_parcelas':
        await this.handleAguardandoIdentificadorParcelas(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'aguardando_identificador_sinistros':
        await this.handleAguardandoIdentificadorSinistros(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'endosso_item':
        await this.handleEndossoItem(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'aguardando_documentos':
        await this.handleAguardandoDocumentos(lead, conversation, chatbotState, messageContent);
        break;
      
      case 'conversa_finalizada':
        // Don't respond to finalized conversations
        console.log(`[ChatbotService] 🏁 Conversa finalizada - não responder automaticamente | Lead: ${lead.protocol}`);
        const context = chatbotState.context as any;
        console.log('[ChatbotService] 📊 Motivo da finalização:', context?.finalReason || 'não especificado');
        // Simply return without sending any message
        return;
      
      default:
        console.log(`[ChatbotService] ⚠️ Estado desconhecido: ${state}`);
        console.log('[ChatbotService] 📊 Transferindo para atendimento humano ao invés de resetar.');
        
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Encontrei um problema técnico. Vou transferir você para um atendente humano. Aguarde um momento, por favor.',
          conversation.id
        );
        
        // SEMPRE transferir para humano, NUNCA resetar
        await this.handleHumanHandoff(lead, conversation, 'Estado desconhecido');
    }
  }

  private async handleInitialState(lead: Lead, conversation: Conversation, chatbotState: ChatbotState) {
    try {
      console.log(`[ChatbotService] 📍 Estado: INICIAL | Lead: ${lead.protocol}`);
      console.log(`[ChatbotService] 🔍 Verificando se é primeira vez...`);
      console.log('[ChatbotService] 📊 Dados coletados no estado:', JSON.stringify(chatbotState.collectedData));
      
      // PROTEÇÃO CRÍTICA: Se há dados coletados, NUNCA enviar mensagem inicial
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      if (collectedData && Object.keys(collectedData).length > 0) {
        console.log('[ChatbotService] ⚠️ ALERTA CRÍTICO: Estado "initial" mas já há dados coletados!');
        console.log('[ChatbotService] 🛡️ PROTEÇÃO ATIVADA: Não enviar boas-vindas, determinar estado apropriado');
        console.log('[ChatbotService] 📊 Dados encontrados:', Object.keys(collectedData));
        
        // Determinar o estado apropriado baseado nos dados
        let appropriateState = 'menu_selection';
        let message = 'Desculpe pela interrupção. Vamos continuar de onde paramos.\n\n';
        
        if (collectedData.dadosPessoais && collectedData.dadosVeiculo) {
          appropriateState = 'aguardando_documentos';
          message += 'Você já forneceu seus dados pessoais e do veículo. Por favor, envie os documentos solicitados.';
        } else if (collectedData.dadosPessoais) {
          appropriateState = 'fluxo_auto_dados_pessoais_confirmacao';
          message += 'Você já forneceu seus dados pessoais. Os dados estão corretos ou deseja alterar algo?';
        } else if (collectedData.veiculoComCliente !== undefined) {
          appropriateState = 'fluxo_auto_dados_pessoais';
          message += 'Vamos continuar coletando seus dados pessoais. Por favor, informe os dados solicitados.';
        } else if (collectedData.tipoSeguro) {
          appropriateState = 'fluxo_auto_status';
          message += 'Você escolheu seguro Auto. O veículo já está com você ou quando você irá pegá-lo?';
        } else if (collectedData.escolha) {
          appropriateState = 'menu1_tipo_seguro';
          message += 'Qual tipo de seguro você deseja fazer?';
        } else {
          message += await this.getMessageTemplate('MENSAGEM2');
        }
        
        console.log(`[ChatbotService] 🔧 Corrigindo estado de "initial" para "${appropriateState}"`);
        
        // Enviar mensagem apropriada
        await this.wahaAPI.sendText(lead.whatsappPhone, message, conversation.id);
        
        // Atualizar estado
        await this.updateChatbotState(chatbotState.id, {
          currentState: appropriateState,
          context: { ...(chatbotState.context || {}), recoveredFromInitial: true }
        });
        
        console.log('[ChatbotService] ✅ Estado recuperado com sucesso, continuando fluxo');
        return;
      }
      
      // Check if welcome was already sent (to avoid sending multiple times)
      const context = chatbotState.context as ChatbotContext;
      if (context?.welcomeSent) {
        console.log('[ChatbotService] ⚠️ Mensagem de boas-vindas já foi enviada. Redirecionando para menu_selection.');
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'menu_selection',
          context: context
        });
        return;
      }
      
      console.log('[ChatbotService] ✨ PRIMEIRA MENSAGEM DO CLIENTE! Enviando MENSAGEM1 e MENSAGEM2...');
      
      // Prepare both messages with state indicator
      const message1 = await this.fillTemplate('MENSAGEM1', {
        '[NOME_DA_IA]': 'Serena',
        '[NÚMERO_DO_PROTOCOLO]': lead.protocol,
        '[DD/MM/AAAA]': new Date().toLocaleDateString('pt-BR')
      });
      
      const message2 = await this.getMessageTemplate('MENSAGEM2');
      
      console.log('[ChatbotService] 📤 Enviando MENSAGEM1 para', lead.whatsappPhone);
      await this.sendMessageWithRetry(lead.whatsappPhone, message1, conversation.id);
      console.log('[ChatbotService] ✅ MENSAGEM1 enviada com sucesso');
      
      // Small delay to ensure proper ordering
      await new Promise(resolve => setTimeout(resolve, 800));
      
      console.log('[ChatbotService] 📤 Enviando MENSAGEM2 para', lead.whatsappPhone);
      await this.sendMessageWithRetry(lead.whatsappPhone, message2, conversation.id);
      console.log('[ChatbotService] ✅ MENSAGEM2 enviada com sucesso');
      
      // Store that both messages were sent
      await db.insert(messages).values([
        {
          conversationId: conversation.id,
          content: '[SISTEMA] Fluxo Inicial - MENSAGEM1 e MENSAGEM2 enviadas | Estado: initial → menu_selection',
          isBot: true,
          messageType: 'system'
        }
      ]);

      // Update state to wait for menu selection
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'menu_selection',
        context: { 
          welcomeSent: true,
          welcomeSentAt: Date.now(),
          lastMessageTime: Date.now()
        }
      });
      
      console.log('[ChatbotService] ✅ Transição completada: initial → menu_selection');
      console.log('[ChatbotService] 📍 Aguardando escolha do cliente no Menu Principal');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleInitialState:', error);
      // Try to inform the user about the error
      try {
        await this.sendMessageWithRetry(
          lead.whatsappPhone,
          'Olá! 👋 Estamos com um problema técnico temporário. Por favor, aguarde um momento ou digite "humano" para falar com um atendente.',
          conversation.id
        );
      } catch (sendError) {
        console.error('[ChatbotService] ❌ Não foi possível enviar mensagem de erro:', sendError);
      }
      throw error;
    }
  }

  private async handleMenuSelection(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado Atual: menu_selection | Lead: ${lead.protocol}`);
      
      // Use OpenAI to understand user intent instead of exact matching
      const userIntent = await this.understandMenuIntent(messageContent);
      console.log(`[ChatbotService] 🤖 IA entendeu intenção: ${userIntent}`);
      
      switch(userIntent) {
        case '1':
          // Send ONLY "Como conheceu a Portilho?" question (as per instruções.txt)
          const menu1Message = `Perfeito! 😄 Antes de começarmos, como você conheceu a Portilho?
💚 Será um prazer ajudar você a garantir tranquilidade e segurança.`;
          
          await this.sendMessageWithRetry(lead.whatsappPhone, menu1Message, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu1_como_conheceu',
            menuSelections: { mainMenu: '1' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu1_como_conheceu`);
          break;
        
        case '2':
          // Menu 2 - Autorio: First ask about vehicle status before handoff
          const menu2Message = `Você escolheu Seguros Novos - Autorio. 🚗

O veículo já está com você ou quando você irá pegá-lo?`;
          
          await this.sendMessageWithRetry(lead.whatsappPhone, menu2Message, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu2_autorio_status',
            menuSelections: { mainMenu: '2' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu2_autorio_status`);
          break;
        
        case '3':
          const template3 = await this.getMessageTemplate('MENU3_RENOVACAO_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template3, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu3_renovacao',
            menuSelections: { mainMenu: '3' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu3_renovacao`);
          break;
        
        case '4':
          const template4 = await this.getMessageTemplate('MENU4_ENDOSSO_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template4, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu4_endosso',
            menuSelections: { mainMenu: '4' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu4_endosso`);
          break;
        
        case '5':
          const template5 = await this.getMessageTemplate('MENU5_PARCELAS_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template5, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu5_parcelas',
            menuSelections: { mainMenu: '5' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu5_parcelas`);
          break;
        
        case '6':
          const template6 = await this.getMessageTemplate('MENU6_SINISTROS_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template6, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu6_sinistros',
            menuSelections: { mainMenu: '6' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu6_sinistros`);
          break;
        
        default:
          const menuMsg = await this.getMessageTemplate('MENSAGEM2');
          const helpMsg = `Desculpe, não entendi sua escolha. ${menuMsg}`;
          await this.sendMessageWithRetry(lead.whatsappPhone, helpMsg, conversation.id);
          console.log(`[ChatbotService] ⚠️ Opção não reconhecida, reenviando menu`);
          break;
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenuSelection:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar sua mensagem. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleMenu1ComoConheceu(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu1_como_conheceu | Lead: ${lead.protocol}`);
      
      // Save how the customer found out about Portilho
      const comoConheceu = messageContent;
      console.log(`[ChatbotService] 💚 Cliente conheceu via: ${comoConheceu}`);
      
      // Save to collectedData
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          comoConheceu 
        }
      });
      
      // Use AI to understand if user wants "seguro novo" or "cotação de outra"
      const userIntent = await this.understandMenu1Intent(messageContent);
      console.log(`[ChatbotService] 🤖 IA entendeu intenção em Como Conheceu: ${userIntent}`);

      if (userIntent === 'seguro_novo') {
        // Ask about insurance type
        const tipoSeguroMessage = `Agora me diga, qual tipo de seguro você deseja fazer?
Trabalhamos com:
🚗 Auto
🚙 Frota
🏠 Residencial
🏢 Empresarial
❤️ Vida
✈️ Viagem
💼 RC Profissional
🔑 Seguro Fiança
⚙️ Equipamentos / Máquinas Agrícolas`;

        await this.sendMessageWithRetry(lead.whatsappPhone, tipoSeguroMessage, conversation.id);
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'menu1_tipo_seguro',
          collectedData: { ...(chatbotState.collectedData as ChatbotCollectedData || {}), escolha: 'seguro_novo' }
        });
        console.log(`[ChatbotService] ✅ Transição para: menu1_tipo_seguro`);
        
      } else if (userIntent === 'cotacao_outra') {
        // For quote from another broker
        const cotacaoMessage = `Entendi! 😊 Para que possamos analisar e oferecer a melhor proposta, poderia, por favor, enviar a apólice atual, caso tenha?

📌 Observação: Se você não tiver a apólice, ainda podemos ajudá-lo, mas com menos detalhes iniciais.

Para agilizar, você deseja manter todos os dados da ficha cadastral do item segurado e das coberturas exatamente como estão na apólice enviada?
🔘 Sim, manter os dados
🔘 Não, desejo revisar ou atualizar alguns dados`;

        await this.sendMessageWithRetry(lead.whatsappPhone, cotacaoMessage, conversation.id);
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'aguardando_apolice',
          collectedData: { ...(chatbotState.collectedData as ChatbotCollectedData || {}), escolha: 'cotacao_outra' }
        });
        console.log(`[ChatbotService] ✅ Transição para: aguardando_apolice`);
        
      } else {
        // If not understood, re-ask
        const resendMessage = `Por favor, me informe se você deseja:
🔘 Fazer um seguro novo
🔘 Fazer cotação de um seguro de outra seguradora`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, resendMessage, conversation.id);
        console.log(`[ChatbotService] ⚠️ Intenção não clara, reenviando opções`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu1ComoConheceu:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar sua resposta. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleMenu1SegurosNovos(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu1_seguros_novos | Lead: ${lead.protocol}`);
      
      // Use AI to understand user intent
      const userIntent = await this.understandMenu1Intent(messageContent);
      console.log(`[ChatbotService] 🤖 IA entendeu intenção em Menu1: ${userIntent}`);

      if (userIntent === 'seguro_novo') {
        // According to instructions, ask about insurance type
        const tipoSeguroMessage = `Agora me diga, qual tipo de seguro você deseja fazer?
Trabalhamos com:
🚗 Auto
🚙 Frota
🏠 Residencial
🏢 Empresarial
❤️ Vida
✈️ Viagem
💼 RC Profissional
🔑 Seguro Fiança
⚙️ Equipamentos / Máquinas Agrícolas`;

        await this.sendMessageWithRetry(lead.whatsappPhone, tipoSeguroMessage, conversation.id);
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'menu1_tipo_seguro',
          collectedData: { ...(chatbotState.collectedData as ChatbotCollectedData || {}), escolha: 'seguro_novo' }
        });
        console.log(`[ChatbotService] ✅ Transição para: menu1_tipo_seguro`);
        
      } else if (userIntent === 'cotacao_outra') {
        // According to instructions, for quote from another broker
        const cotacaoMessage = `Entendi! 😊 Para que possamos analisar e oferecer a melhor proposta, poderia, por favor, enviar a apólice atual, caso tenha?

📌 Observação: Se você não tiver a apólice, ainda podemos ajudá-lo, mas com menos detalhes iniciais.

Para agilizar, você deseja manter todos os dados da ficha cadastral do item segurado e das coberturas exatamente como estão na apólice enviada?
🔘 Sim, manter os dados
🔘 Não, desejo revisar ou atualizar alguns dados`;

        await this.sendMessageWithRetry(lead.whatsappPhone, cotacaoMessage, conversation.id);
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'aguardando_apolice',
          collectedData: { ...(chatbotState.collectedData as ChatbotCollectedData || {}), escolha: 'cotacao_outra' }
        });
        console.log(`[ChatbotService] ✅ Transição para: aguardando_apolice`);
        
      } else {
        // Resend the question if not understood
        const resendMessage = `Por favor, me informe se você deseja:
🔘 Fazer um seguro novo
🔘 Fazer cotação de um seguro de outra seguradora`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, resendMessage, conversation.id);
        console.log(`[ChatbotService] ⚠️ Intenção não clara, reenviando opções`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu1SegurosNovos:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar sua resposta. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleMenu1TipoSeguro(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu1_tipo_seguro | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();

      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('carro') || lowercaseMessage.includes('veículo')) {
        // According to instructions, start AUTO insurance flow
        const autoMessage = `Você escolheu Auto. 🚗
💚 Será um prazer ajudar você a garantir tranquilidade e segurança.

O veículo já está com você ou quando você irá pegá-lo?`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, autoMessage, conversation.id);
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'fluxo_auto_status',
          collectedData: { ...(chatbotState.collectedData as ChatbotCollectedData || {}), tipoSeguro: 'auto' }
        });
        console.log(`[ChatbotService] ✅ Transição para: fluxo_auto_status`);
      } else {
        // Other insurance types - transfer to human
        const transferMessage = `Entendi! Vou transferir você para um de nossos especialistas que poderá ajudá-lo da melhor forma. Um momento, por favor... 💚`;
        await this.sendMessageWithRetry(lead.whatsappPhone, transferMessage, conversation.id);
        await this.handleHumanHandoff(lead, conversation, `Tipo de seguro: ${messageContent}`);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Tipo: ${messageContent}`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu1TipoSeguro:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleMenu2AutorioStatus(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu2_autorio_status | Lead: ${lead.protocol}`);
      
      // Use AI to understand if vehicle is already with customer
      const resposta = await this.entenderRespostaBinaria(messageContent, 'O veículo já está com o cliente?');
      
      if (resposta === 'sim') {
        // Vehicle already with customer - URGENT
        console.log('[ChatbotService] 🚨 Autorio: Veículo já está com cliente - COTAÇÃO URGENTE!');
        
        // Update lead priority to urgent and mark as urgent quotation
        await db.update(leads)
          .set({ 
            priority: 'urgente',
            tags: [...(lead.tags || []), 'URGENTE', 'AUTORIO', 'VEÍCULO_COM_CLIENTE', 'COTAÇÃO_URGENTE']
          })
          .where(eq(leads.id, lead.id));
        
        // Send message and transfer to human
        const urgentMessage = `Entendido! Como o veículo já está com você, vou marcar sua solicitação com grau de importância ALTO e COTAÇÃO URGENTE. 🚨

Vou transferir você agora para um de nossos especialistas Autorio que dará prioridade ao seu atendimento. Um momento, por favor... 💚`;
        await this.sendMessageWithRetry(lead.whatsappPhone, urgentMessage, conversation.id);
        
        // Transfer to human (STOP AI flow)
        await this.handleHumanHandoff(lead, conversation, 'Menu 2 - Autorio - COTAÇÃO URGENTE - Veículo já com cliente');
        console.log(`[ChatbotService] ✅ Transferindo para humano - Autorio COTAÇÃO URGENTE`);
        
      } else if (resposta === 'não') {
        // Vehicle not yet with customer - ask when
        console.log('[ChatbotService] ℹ️ Autorio: Veículo ainda não está com cliente - prioridade padrão');
        
        const whenMessage = `Entendi que você ainda não pegou o carro. Para melhor organizarmos o atendimento, quando está previsto para retirar o veículo? 

Por favor, informe a data e hora aproximadas.`;
        await this.sendMessageWithRetry(lead.whatsappPhone, whenMessage, conversation.id);
        
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'menu2_autorio_quando_pega',
          collectedData: { 
            ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
            veiculoComCliente: false,
            prioridade: 'normal'
          }
        });
        console.log(`[ChatbotService] ✅ Transição para: menu2_autorio_quando_pega`);
        
      } else {
        // Not understood - re-ask
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Desculpe, não entendi sua resposta. O veículo já está com você ou você ainda vai retirá-lo?', conversation.id);
        console.log(`[ChatbotService] ⚠️ Resposta não compreendida, reenviando pergunta`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu2AutorioStatus:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleMenu2AutorioQuandoPega(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu2_autorio_quando_pega | Lead: ${lead.protocol}`);
      
      // Save when customer will pick up vehicle
      const quandoPegaVeiculo = messageContent;
      console.log(`[ChatbotService] 📅 Cliente vai pegar veículo em: ${quandoPegaVeiculo}`);
      
      // Update lead with standard priority since vehicle is not yet with customer
      await db.update(leads)
        .set({ 
          priority: 'normal',
          tags: [...(lead.tags || []), 'AUTORIO', 'VEÍCULO_A_RETIRAR']
        })
        .where(eq(leads.id, lead.id));
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          quandoPegaVeiculo,
          prioridade: 'normal'
        }
      });
      
      // Send confirmation and transfer to human (STOP AI flow)
      const confirmMessage = `Perfeito! Anotei que você irá retirar o veículo em: ${quandoPegaVeiculo}. 📅

Como ainda há tempo, defini sua solicitação com prioridade PADRÃO.

Vou transferir você agora para um de nossos especialistas Autorio que irá prosseguir com seu atendimento. Um momento, por favor... 💚`;
      
      await this.sendMessageWithRetry(lead.whatsappPhone, confirmMessage, conversation.id);
      
      // Transfer to human (STOP AI flow as per instructions)
      await this.handleHumanHandoff(lead, conversation, `Menu 2 - Autorio - Prioridade Padrão - Veículo será retirado em: ${quandoPegaVeiculo}`);
      console.log(`[ChatbotService] ✅ Transferindo para humano - Autorio (Prioridade Padrão)`);
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu2AutorioQuandoPega:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleFluxoAutoStatus(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    // Usar IA para entender a resposta do cliente de forma natural
    const resposta = await this.entenderRespostaBinaria(messageContent, 'O veículo já está com o cliente?');
    
    if (resposta === 'sim') {
      // Vehicle already with customer - URGENT
      const urgentMessage = `Entendi! 😟 Vejo que você já está utilizando o veículo sem seguro. 💚
Não se preocupe, vamos agilizar sua cotação.

Agora vou coletar seus dados pessoais. Por favor, informe:

📌 Dados Pessoais do Segurado/Condutor
1️⃣ Nome completo:
2️⃣ CPF:
3️⃣ Data de nascimento:
4️⃣ Estado civil:
5️⃣ Endereço completo:
6️⃣ CEP:
7️⃣ Telefone:
8️⃣ E-mail:
9️⃣ Profissão:
🔟 É o principal condutor do veículo?

💬 Dica: Você pode responder digitando ou enviando áudio, se for mais rápido e prático.`;

      await this.wahaAPI.sendText(lead.whatsappPhone, urgentMessage, conversation.id);
      
      // Update lead priority to urgent
      await db.update(leads)
        .set({ 
          priority: 'urgente',
          tags: [...(lead.tags || []), 'URGENTE', 'AUTO', 'SEM_SEGURO']
        })
        .where(eq(leads.id, lead.id));

      await this.updateChatbotState(chatbotState.id, {
        currentState: 'fluxo_auto_dados_pessoais',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          veiculoComCliente: true,
          prioridade: 'urgente'
        }
      });

    } else if (resposta === 'não') {
      await this.wahaAPI.sendText(lead.whatsappPhone, 'Perfeito! Quando você irá pegar o veículo? (Por favor, informe a data e horário aproximado)', conversation.id);
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'fluxo_auto_quando_pega',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          veiculoComCliente: false,
          prioridade: 'normal'
        }
      });
    } else {
      // Não entendeu - pedir novamente de forma natural (sem "SIM ou NÃO")
      await this.wahaAPI.sendText(lead.whatsappPhone, 'Desculpe, não entendi. O veículo já está com você?', conversation.id);
    }
  }

  private async handleFluxoAutoDadosPessoais(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_dados_pessoais | Lead: ${lead.protocol}`);
      
      // Validar se há conteúdo de mensagem para processar
      if (!messageContent || messageContent.trim() === '') {
        console.log('[ChatbotService] ⚠️ Mensagem vazia recebida, solicitando dados novamente');
        await this.wahaAPI.sendText(
          lead.whatsappPhone, 
          'Não recebi sua mensagem. Por favor, envie seus dados pessoais novamente ou um áudio com as informações.',
          conversation.id
        );
        return;
      }
      
      // 1. Extrair dados usando a nova função
      console.log('[ChatbotService] 🤖 Extraindo dados pessoais da mensagem...');
      const extractedData = await this.extractPersonalDataFromMessage(messageContent, lead);
      console.log('[ChatbotService] 📊 Dados extraídos:', JSON.stringify(extractedData));

      // 2. Check if OpenAI extraction failed (empty object) and show friendly error
      if (Object.keys(extractedData).length === 0) {
        console.log('[ChatbotService] ⚠️ Nenhum dado extraído - OpenAI pode estar indisponível');
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          '⚠️ Desculpe, nosso sistema de IA está temporariamente indisponível.\n\n' +
          'Por favor, digite "humano" para falar com um atendente que vai te ajudar pessoalmente.',
          conversation.id
        );
        return;
      }

      // 3. Atualizar lead com TODOS os campos extraídos
      console.log('[ChatbotService] 💾 Atualizando lead no banco de dados...');
      await db.update(leads).set(extractedData).where(eq(leads.id, lead.id));
      console.log('[ChatbotService] ✅ Lead atualizado com sucesso');

      // 4. Buscar lead atualizado do banco para validação
      console.log('[ChatbotService] 🔄 Buscando lead atualizado do banco...');
      const updatedLead = await db.query.leads.findFirst({
        where: eq(leads.id, lead.id)
      });

      if (!updatedLead) {
        throw new Error('Lead não encontrado após atualização');
      }

      // 5. Validar completude dos dados
      console.log('[ChatbotService] 🔍 Validando completude dos dados pessoais...');
      const validation = await this.isStateDataComplete('dados_pessoais', updatedLead);
      
      console.log(`[ChatbotService] 📊 Resultado validação: ${validation.isComplete ? 'COMPLETO ✅' : 'INCOMPLETO ❌'}`);
      
      // 6. Se incompleto: pedir o que falta e NÃO avançar
      if (!validation.isComplete) {
        console.log(`[ChatbotService] ⚠️ Dados incompletos. Campos faltantes (${validation.missingFields.length}):`, validation.missingFields.join(', '));
        
        const missingMessage = await this.generateMissingFieldsMessage(validation.missingFieldsPortuguese);
        await this.wahaAPI.sendText(lead.whatsappPhone, missingMessage, conversation.id);
        
        console.log('[ChatbotService] 📤 Mensagem solicitando campos faltantes enviada');
        console.log('[ChatbotService] ⏸️ Mantendo estado em fluxo_auto_dados_pessoais (aguardando dados completos)');
        
        // NÃO atualizar o estado - manter em fluxo_auto_dados_pessoais
        return;
      }

      // 7. Se completo: gerar resumo e pedir confirmação
      console.log('[ChatbotService] ✅ Todos os dados pessoais foram coletados!');
      console.log('[ChatbotService] 📝 Gerando resumo para confirmação...');
      
      // Gerar resumo formatado dos dados
      const summary = this.generatePersonalDataSummary(updatedLead);
      
      // Enviar resumo
      await this.wahaAPI.sendText(lead.whatsappPhone, summary, conversation.id);
      
      // Delay entre mensagens
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Pedir confirmação
      const confirmationMessage = 'Confira os dados acima. Está tudo correto ou deseja alterar algo?';
      await this.wahaAPI.sendText(lead.whatsappPhone, confirmationMessage, conversation.id);

      // Atualizar estado para confirmação
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'fluxo_auto_dados_pessoais_confirmacao',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          dadosPessoais: extractedData 
        }
      });
      
      console.log('[ChatbotService] ✅ Transição completada: fluxo_auto_dados_pessoais → fluxo_auto_dados_pessoais_confirmacao');
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleFluxoAutoDadosPessoais:', error);
      await this.wahaAPI.sendText(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar seus dados. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleFluxoAutoDadosPessoaisConfirmacao(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_dados_pessoais_confirmacao | Lead: ${lead.protocol}`);
      console.log('[ChatbotService] 💬 Mensagem do usuário:', messageContent);
      console.log('[ChatbotService] 🔍 Estado atual do chatbot:', JSON.stringify({
        id: chatbotState.id,
        currentState: chatbotState.currentState,
        hasContext: !!chatbotState.context,
        hasCollectedData: !!chatbotState.collectedData,
        collectedDataKeys: chatbotState.collectedData ? Object.keys(chatbotState.collectedData) : []
      }));
      
      // PROTEÇÃO CRÍTICA: Verificar se realmente estamos no estado correto
      if (chatbotState.currentState !== 'fluxo_auto_dados_pessoais_confirmacao') {
        console.log(`[ChatbotService] ⚠️ ALERTA: handleFluxoAutoDadosPessoaisConfirmacao chamado mas estado atual é '${chatbotState.currentState}'!`);
        console.log('[ChatbotService] 🛡️ Abortando processamento para evitar comportamento inesperado');
        return;
      }
      
      // PROTEÇÃO: Verificar se temos dados coletados
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      if (!collectedData || Object.keys(collectedData).length === 0) {
        console.log('[ChatbotService] ⚠️ ALERTA: Nenhum dado coletado encontrado no estado de confirmação!');
        console.log('[ChatbotService] 🔄 Redirecionando para coleta de dados pessoais');
        
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Parece que ainda não tenho seus dados pessoais. Por favor, informe seus dados conforme solicitado anteriormente.',
          conversation.id
        );
        
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'fluxo_auto_dados_pessoais'
        });
        return;
      }
      
      // VERIFICAR SE ESTÁ AGUARDANDO VALOR DE CAMPO ESPECÍFICO
      const context = chatbotState.context as any;
      const waitingFieldUpdate = context?.waitingFieldUpdate;
      if (waitingFieldUpdate) {
        console.log('[ChatbotService] 📝 Contexto: Aguardando novo valor para campo:', waitingFieldUpdate);
        console.log('[ChatbotService] 💬 Valor fornecido pelo usuário:', messageContent);
        
        // Limpar prefixo "Mensagem N:" se existir
        const cleanValue = this.cleanMessagePrefix(messageContent).trim();
        console.log('[ChatbotService] 🧹 Valor limpo:', cleanValue);
        
        // Criar objeto com o campo e valor
        const updatedFields: any = {};
        updatedFields[waitingFieldUpdate] = cleanValue;
        
        // Processar campos extraídos com formatação automática
        const cleanedUpdates: any = {};

        if (updatedFields.cpf) {
          // Formatar CPF automaticamente
          cleanedUpdates.cpf = this.formatCPF(updatedFields.cpf);
          console.log('[ChatbotService] 🎯 CPF formatado:', cleanedUpdates.cpf);
        }

        if (updatedFields.cnpj) {
          // Formatar CNPJ automaticamente
          cleanedUpdates.cnpj = this.formatCNPJ(updatedFields.cnpj);
          console.log('[ChatbotService] 🎯 CNPJ formatado:', cleanedUpdates.cnpj);
        }

        if (updatedFields.cep) {
          // Formatar CEP automaticamente
          cleanedUpdates.cep = this.formatCEP(updatedFields.cep);
          console.log('[ChatbotService] 🎯 CEP formatado:', cleanedUpdates.cep);
        }

        if (updatedFields.phone) {
          // Formatar telefone automaticamente
          cleanedUpdates.phone = this.formatPhone(updatedFields.phone);
          console.log('[ChatbotService] 🎯 Telefone formatado:', cleanedUpdates.phone);
        }

        if (updatedFields.birthDate) {
          // Aceitar qualquer valor de data sem validação
          cleanedUpdates.birthDate = updatedFields.birthDate.trim();
        }

        if (updatedFields.maritalStatus) {
          // Aceitar qualquer valor de estado civil sem validação
          cleanedUpdates.maritalStatus = updatedFields.maritalStatus.trim();
        }

        if (updatedFields.name && updatedFields.name.trim().length > 0) {
          cleanedUpdates.name = updatedFields.name.trim();
        }

        if (updatedFields.address && updatedFields.address.trim().length > 0) {
          cleanedUpdates.address = updatedFields.address.trim();
        }

        if (updatedFields.email && updatedFields.email.trim().length > 0) {
          cleanedUpdates.email = updatedFields.email.trim();
        }

        if (updatedFields.profession && updatedFields.profession.trim().length > 0) {
          cleanedUpdates.profession = updatedFields.profession.trim();
        }

        if (updatedFields.isPrincipalDriver !== undefined) {
          // Aceitar qualquer valor de condutor principal sem validação
          cleanedUpdates.isPrincipalDriver = updatedFields.isPrincipalDriver;
        }

        console.log('[ChatbotService] 📝 Campos a atualizar:', Object.keys(cleanedUpdates).join(', '));
        
        // Atualizar lead no banco
        if (Object.keys(cleanedUpdates).length > 0) {
          console.log('[ChatbotService] 🔄 Atualizando lead no banco de dados...');
          await db.update(leads)
            .set(cleanedUpdates)
            .where(eq(leads.id, lead.id));
          
          console.log('[ChatbotService] ✅ Lead atualizado com sucesso');
        }

        // Buscar lead atualizado
        const updatedLead = await db.query.leads.findFirst({
          where: eq(leads.id, lead.id)
        });

        if (!updatedLead) {
          throw new Error('Lead não encontrado após atualização');
        }

        // Gerar novo resumo com dados atualizados
        const newSummary = this.generatePersonalDataSummary(updatedLead);
        
        // Enviar novo resumo
        await this.wahaAPI.sendText(lead.whatsappPhone, newSummary, conversation.id);
        
        // Delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Perguntar novamente
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Confira os dados atualizados. Está tudo correto agora?',
          conversation.id
        );

        // Limpar contexto de atualização (setar como null para que o deepMerge processe)
        await this.updateChatbotState(chatbotState.id, {
          context: {
            waitingFieldUpdate: null,
            waitingFieldLabel: null
          }
        });
        
        console.log('[ChatbotService] ✅ Campo atualizado, contexto limpo e novo resumo enviado');
        return;
      }
      
      // Usar GPT-4o-mini para entender a intenção (confirmação ou alteração)
      console.log('[ChatbotService] 🤖 Usando GPT-4o-mini para entender intenção...');
      
      let intent: string | undefined;
      
      try {
        const intentPrompt = `CONTEXTO: O chatbot acabou de mostrar os dados pessoais do usuário e perguntou se está tudo correto ou se ele deseja alterar algo.

TAREFA: Analise a INTENÇÃO da mensagem do usuário e classifique em uma das categorias:

A) CONFIRMAR - O usuário está dando uma resposta AFIRMATIVA/POSITIVA, indicando que os dados estão corretos e pode prosseguir. Isso inclui:
   - Qualquer expressão de concordância, aprovação ou confirmação
   - Tom positivo ou satisfeito com os dados apresentados
   - Sinal de que pode avançar para a próxima etapa

B) ALTERAR - O usuário está indicando que algo está ERRADO ou que deseja MUDAR algum dado. Isso inclui:
   - Mencionar erros, incorreções ou necessidade de mudança
   - Indicar campos específicos que precisam ser corrigidos
   - Tom de insatisfação ou correção

REGRA IMPORTANTE: Foque na INTENÇÃO e no TOM da mensagem, não apenas em palavras específicas. Se o usuário está satisfeito e pronto para continuar = CONFIRMAR. Se quer corrigir algo = ALTERAR.

Mensagem do usuário: "${messageContent}"

Responda APENAS com "CONFIRMAR" ou "ALTERAR".`;

        const intentResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você é um assistente especializado em análise de intenção em conversas em português. Você entende contexto, tom e significado implícito, não apenas palavras-chave.' },
            { role: 'user', content: intentPrompt }
          ],
          temperature: 0.3,
          max_tokens: 10
        });

        intent = intentResponse.choices[0]?.message?.content?.trim().toUpperCase();
        console.log('[ChatbotService] 🎯 Intenção identificada:', intent);
        
      } catch (gptError) {
        console.error('[ChatbotService] ❌ Erro ao chamar GPT-4o-mini:', gptError);
        intent = undefined;
      }

      if (intent === 'CONFIRMAR') {
        // Usuário confirmou - avançar para dados do veículo
        console.log('[ChatbotService] ✅ Dados confirmados pelo usuário!');
        console.log('[ChatbotService] 📊 Estado anterior:', chatbotState.currentState);
        console.log('[ChatbotService] 📊 Novo estado: fluxo_auto_dados_veiculo');
        console.log('[ChatbotService] 📊 Dados mantidos:', Object.keys(chatbotState.collectedData || {}).join(', '));
        
        // Atualizar estado para próxima etapa (handleFluxoAutoDadosVeiculo enviará a primeira pergunta)
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'fluxo_auto_dados_veiculo',
          collectedData: chatbotState.collectedData,
          context: {
            ...(chatbotState.context || {}),
            dataConfirmedAt: Date.now(),
            previousState: 'fluxo_auto_dados_pessoais_confirmacao'
          }
        });
        
        console.log('[ChatbotService] ✅ Transição completada: fluxo_auto_dados_pessoais_confirmacao → fluxo_auto_dados_veiculo');
        console.log('[ChatbotService] 🎯 Motivo: Usuário confirmou todos os dados pessoais');
        
        // Registrar no banco a transição
        await db.insert(messages).values({
          conversationId: conversation.id,
          content: `[SISTEMA] Transição de estado: fluxo_auto_dados_pessoais_confirmacao → fluxo_auto_dados_veiculo | Motivo: Dados pessoais confirmados`,
          isBot: true,
          messageType: 'system',
          metadata: { 
            previousState: 'fluxo_auto_dados_pessoais_confirmacao',
            newState: 'fluxo_auto_dados_veiculo',
            reason: 'data_confirmed'
          }
        });
        
        // Buscar estado atualizado e chamar o handler do novo estado
        const updatedState = await db.query.chatbotStates.findFirst({
          where: eq(chatbotStates.id, chatbotState.id)
        });
        
        if (updatedState) {
          console.log('[ChatbotService] 🚀 Chamando handler do novo estado: fluxo_auto_dados_veiculo');
          await this.handleFluxoAutoDadosVeiculo(lead, conversation, updatedState, messageContent);
        }
        
        return;
        
      } else if (intent === 'ALTERAR') {
        // Usuário quer alterar - usar GPT-4 para extrair qual campo e novo valor
        console.log('[ChatbotService] ✏️ Usuário quer alterar dados. Usando GPT-4 para extrair alterações...');
        
        const extractionPrompt = `Analise a mensagem do usuário que deseja alterar seus dados pessoais.
Identifique QUAL campo ele quer alterar e, SE FORNECIDO, QUAL é o NOVO valor.

IMPORTANTE: Retorne o campo mesmo que o usuário NÃO tenha fornecido o novo valor ainda.

CAMPOS POSSÍVEIS:
- name: Nome completo
- cpf: CPF (apenas números)
- birthDate: Data de nascimento (formato ISO: YYYY-MM-DD)
- maritalStatus: Estado civil ("solteiro", "casado", "divorciado", "viúvo", "união estável")
- address: Endereço completo
- cep: CEP (apenas números)
- phone: Telefone (apenas números com DDD)
- email: Email
- profession: Profissão
- isPrincipalDriver: Se é condutor principal (boolean)

FORMATOS DE RESPOSTA:
1. Se o usuário menciona campo E valor: {"field": "cpf", "value": "12345678900"}
2. Se o usuário menciona APENAS o campo: {"field": "cpf", "value": null}
3. Se não conseguir identificar nenhum campo: {}

EXEMPLOS:
- "o cpf preciso alterar" → {"field": "cpf", "value": null}
- "quero alterar meu email para novo@email.com" → {"field": "email", "value": "novo@email.com"}
- "meu nome está errado" → {"field": "name", "value": null}
- "alterar" → {}

REGRAS:
1. Identifique o campo mesmo sem valor
2. Normalize os valores quando fornecidos
3. Retorne APENAS um objeto JSON válido

Mensagem do usuário: ${messageContent}`;

        const extractionResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'Você é um assistente que extrai campos e valores de alteração de dados em mensagens em português. Retorne sempre JSON válido.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 300
        });

        const extractedText = extractionResponse.choices[0]?.message?.content?.trim();
        console.log('[ChatbotService] 📤 Resposta GPT-4:', extractedText);

        let extractedData: any = {};
        try {
          const cleanedText = extractedText?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          extractedData = cleanedText ? JSON.parse(cleanedText) : {};
        } catch (parseError) {
          console.error('[ChatbotService] ❌ Erro ao fazer parse da resposta GPT-4:', parseError);
          await this.wahaAPI.sendText(
            lead.whatsappPhone,
            'Desculpe, não consegui entender qual dado você quer alterar. Qual informação você gostaria de atualizar?',
            conversation.id
          );
          return;
        }

        // Verificar se conseguiu identificar algum campo
        if (!extractedData.field) {
          console.log('[ChatbotService] ⚠️ Nenhum campo identificado para alteração');
          await this.wahaAPI.sendText(
            lead.whatsappPhone,
            'Qual informação você gostaria de alterar? Por exemplo: CPF, nome, email, endereço, etc.',
            conversation.id
          );
          return;
        }

        // Campo identificado, mas valor não fornecido - perguntar o novo valor
        if (extractedData.value === null || extractedData.value === undefined) {
          console.log('[ChatbotService] 📝 Campo identificado:', extractedData.field);
          console.log('[ChatbotService] ❓ Valor não fornecido, perguntando ao usuário');
          
          const fieldLabels: Record<string, string> = {
            name: 'nome completo',
            cpf: 'CPF',
            birthDate: 'data de nascimento',
            maritalStatus: 'estado civil',
            address: 'endereço',
            cep: 'CEP',
            phone: 'telefone',
            email: 'e-mail',
            profession: 'profissão',
            isPrincipalDriver: 'se você é o condutor principal'
          };
          
          const fieldLabel = fieldLabels[extractedData.field] || extractedData.field;
          
          await this.wahaAPI.sendText(
            lead.whatsappPhone,
            `Qual é o novo ${fieldLabel}?`,
            conversation.id
          );
          
          // Salvar no contexto qual campo está sendo alterado
          await this.updateChatbotState(chatbotState.id, {
            context: {
              ...(chatbotState.context || {}),
              waitingFieldUpdate: extractedData.field,
              waitingFieldLabel: fieldLabel
            }
          });
          
          return;
        }

        // Converter o formato do GPT para o formato esperado pelo código existente
        const updatedFields: any = {};
        updatedFields[extractedData.field] = extractedData.value;

        // Processar campos extraídos com formatação automática
        const cleanedUpdates: any = {};

        if (updatedFields.cpf) {
          // Formatar CPF automaticamente
          cleanedUpdates.cpf = this.formatCPF(updatedFields.cpf);
          console.log('[ChatbotService] 🎯 CPF formatado:', cleanedUpdates.cpf);
        }

        if (updatedFields.cnpj) {
          // Formatar CNPJ automaticamente
          cleanedUpdates.cnpj = this.formatCNPJ(updatedFields.cnpj);
          console.log('[ChatbotService] 🎯 CNPJ formatado:', cleanedUpdates.cnpj);
        }

        if (updatedFields.cep) {
          // Formatar CEP automaticamente
          cleanedUpdates.cep = this.formatCEP(updatedFields.cep);
          console.log('[ChatbotService] 🎯 CEP formatado:', cleanedUpdates.cep);
        }

        if (updatedFields.phone) {
          // Formatar telefone automaticamente
          cleanedUpdates.phone = this.formatPhone(updatedFields.phone);
          console.log('[ChatbotService] 🎯 Telefone formatado:', cleanedUpdates.phone);
        }

        if (updatedFields.birthDate) {
          try {
            cleanedUpdates.birthDate = new Date(updatedFields.birthDate);
            console.log('[ChatbotService] 🎯 Data convertida:', cleanedUpdates.birthDate);
          } catch (dateError) {
            console.error('[ChatbotService] ⚠️ Erro ao converter data:', dateError);
          }
        }

        if (updatedFields.maritalStatus && updatedFields.maritalStatus.trim().length > 0) {
          cleanedUpdates.maritalStatus = updatedFields.maritalStatus.trim().toLowerCase();
        }

        if (updatedFields.name && updatedFields.name.trim().length > 0) {
          cleanedUpdates.name = updatedFields.name.trim();
        }

        if (updatedFields.address && updatedFields.address.trim().length > 0) {
          cleanedUpdates.address = updatedFields.address.trim();
        }

        if (updatedFields.email && updatedFields.email.trim().length > 0) {
          cleanedUpdates.email = updatedFields.email.trim();
        }

        if (updatedFields.profession && updatedFields.profession.trim().length > 0) {
          cleanedUpdates.profession = updatedFields.profession.trim();
        }

        if (typeof updatedFields.isPrincipalDriver === 'boolean') {
          cleanedUpdates.isPrincipalDriver = updatedFields.isPrincipalDriver;
        }

        console.log('[ChatbotService] 📝 Campos a atualizar:', Object.keys(cleanedUpdates).join(', '));
        console.log('[ChatbotService] 📊 Valores atualizados:', JSON.stringify(cleanedUpdates));

        // Atualizar lead no banco
        if (Object.keys(cleanedUpdates).length > 0) {
          console.log('[ChatbotService] 🔄 Atualizando lead no banco de dados...');
          await db.update(leads)
            .set(cleanedUpdates)
            .where(eq(leads.id, lead.id));
          
          console.log('[ChatbotService] ✅ Lead atualizado no banco de dados com sucesso');
          console.log('[ChatbotService] 📊 Estado mantido:', chatbotState.currentState);
          console.log('[ChatbotService] 📊 Dados coletados mantidos:', Object.keys(chatbotState.collectedData || {}).join(', '));
        }

        // Buscar lead atualizado
        const updatedLead = await db.query.leads.findFirst({
          where: eq(leads.id, lead.id)
        });

        if (!updatedLead) {
          throw new Error('Lead não encontrado após atualização');
        }

        // Gerar novo resumo com dados atualizados
        const newSummary = this.generatePersonalDataSummary(updatedLead);
        
        // Enviar novo resumo
        await this.wahaAPI.sendText(lead.whatsappPhone, newSummary, conversation.id);
        
        // Delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Perguntar novamente
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Confira os dados atualizados. Está tudo correto agora?',
          conversation.id
        );

        console.log('[ChatbotService] ✅ Dados atualizados e novo resumo enviado');
        console.log('[ChatbotService] 🔄 Estado MANTIDO em fluxo_auto_dados_pessoais_confirmacao para nova confirmação');
        console.log('[ChatbotService] 🎯 Motivo: Aguardando confirmação após alteração de campos específicos');
        
        // Registrar no banco a alteração sem mudança de estado
        await db.insert(messages).values({
          conversationId: conversation.id,
          content: `[SISTEMA] Campos alterados: ${Object.keys(cleanedUpdates).join(', ')} | Estado mantido: fluxo_auto_dados_pessoais_confirmacao`,
          isBot: true,
          messageType: 'system',
          metadata: { 
            currentState: 'fluxo_auto_dados_pessoais_confirmacao',
            fieldsAltered: Object.keys(cleanedUpdates),
            reason: 'specific_fields_altered'
          }
        });
        
        // Manter no mesmo estado para nova confirmação
        // Não precisa atualizar o estado, apenas o lead foi atualizado
        
      } else {
        // Não conseguiu entender - pedir esclarecimento
        console.log('[ChatbotService] ❓ Intenção não identificada:', intent);
        console.log('[ChatbotService] 💭 Resposta do usuário não compreendida:', messageContent);
        console.log('[ChatbotService] 🛡️ PROTEÇÃO: Mantendo estado atual e pedindo esclarecimento');
        console.log('[ChatbotService] 📊 Estado mantido:', chatbotState.currentState);
        console.log('[ChatbotService] 📊 Dados mantidos:', JSON.stringify(chatbotState.collectedData));
        
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Desculpe, não entendi sua resposta. Por favor, me informe:\n\n✅ Os dados estão **corretos** e podemos prosseguir?\n✏️ Ou você deseja **alterar** algum dado?\n\nResponda com "confirmar" para prosseguir ou "alterar" seguido do que deseja mudar.',
          conversation.id
        );
        
        // CRÍTICO: NÃO mudar o estado - manter em fluxo_auto_dados_pessoais_confirmacao
        console.log('[ChatbotService] ✅ Estado mantido em:', chatbotState.currentState);
        
        // Registrar no banco que o estado foi mantido
        await db.insert(messages).values({
          conversationId: conversation.id,
          content: `[SISTEMA] Estado mantido em ${chatbotState.currentState} após resposta não compreendida: "${messageContent}"`,
          isBot: true,
          messageType: 'system',
          metadata: { 
            previousState: chatbotState.currentState,
            maintainedState: true,
            userMessage: messageContent
          }
        });
      }
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleFluxoAutoDadosPessoaisConfirmacao:', error);
      console.error('[ChatbotService] 📊 Stack trace:', error instanceof Error ? error.stack : 'N/A');
      console.log('[ChatbotService] 🛡️ PROTEÇÃO: Mantendo estado atual mesmo com erro');
      console.log('[ChatbotService] 📊 Estado atual:', chatbotState.currentState);
      console.log('[ChatbotService] 📊 Dados coletados:', JSON.stringify(chatbotState.collectedData));
      
      // NUNCA resetar - tentar pedir esclarecimento ou transferir para humano
      const hasAttemptedMultipleTimes = (chatbotState.context as any)?.errorAttempts > 2;
      
      if (hasAttemptedMultipleTimes) {
        console.log('[ChatbotService] ⚠️ Múltiplas tentativas falhadas - transferindo para humano');
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Estou com dificuldades para processar sua resposta. Vou transferir você para um atendente humano que poderá ajudá-lo melhor.',
          conversation.id
        );
        await this.handleHumanHandoff(lead, conversation, 'Erro repetido ao processar confirmação de dados');
      } else {
        // Incrementar contador de tentativas
        const errorAttempts = ((chatbotState.context as any)?.errorAttempts || 0) + 1;
        await this.updateChatbotState(chatbotState.id, {
          context: { ...(chatbotState.context || {}), errorAttempts }
        });
        
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Desculpe, houve um problema ao processar sua resposta. Por favor, responda apenas:\n\n✅ "Confirmar" se os dados estão corretos\n✏️ "Alterar" se deseja modificar algo\n\nOu digite "humano" para falar com um atendente.',
          conversation.id
        );
        
        console.log('[ChatbotService] ✅ Estado mantido após erro. Tentativa:', errorAttempts);
      }
    }
  }

  private async handleFluxoAutoDadosVeiculo(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_dados_veiculo | Lead: ${lead.protocol}`);
      
      // Send first question directly without intro message
      const firstQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_ESTACIONAMENTO');
      await this.sendMessageWithRetry(lead.whatsappPhone, firstQuestion, conversation.id);
      
      // Transition to first question state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_estacionamento',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}),
          dadosVeiculo: {} // Initialize vehicle data object
        }
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_estacionamento');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleFluxoAutoDadosVeiculo:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  // ========== VEHICLE DATA COLLECTION HANDLERS (SEQUENTIAL) ==========
  
  private async handleDadosVeiculoEstacionamento(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_estacionamento | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderResposta(
        messageContent,
        ['garagem', 'estacionamento', 'rua']
      );
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.estacionamento = resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_PORTAO');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_portao'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_portao');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoEstacionamento:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. Onde o veículo fica estacionado? (Garagem, Estacionamento ou Rua)',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoPortao(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_portao | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderResposta(
        messageContent,
        ['manual', 'automático', 'automatico']
      );
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.tipoPortao = resposta === 'automatico' ? 'automático' : resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_TRABALHO_ESTUDO');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_trabalho_estudo'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_trabalho_estudo');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoPortao:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. A garagem tem portão manual ou automático?',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoTrabalhoEstudo(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_trabalho_estudo | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderResposta(
        messageContent,
        ['trabalho', 'estudo', 'ambos', 'nenhum']
      );
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.usoTrabalhoEstudo = resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_MORADIA');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_moradia'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_moradia');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoTrabalhoEstudo:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. Você usa o veículo para ir ao trabalho e/ou estudo? (Trabalho, Estudo, Ambos ou Nenhum)',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoMoradia(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_moradia | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderResposta(
        messageContent,
        ['casa', 'apartamento']
      );
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.tipoResidencia = resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_CARRO_RESERVA');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_carro_reserva'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_carro_reserva');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoMoradia:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. Mora em casa ou apartamento?',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoCarroReserva(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_carro_reserva | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderResposta(
        messageContent,
        ['7', '15', '30', 'não', 'nao', 'não desejo', 'nao desejo']
      );
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.carroReserva = resposta.includes('não') || resposta.includes('nao') ? 'não desejo' : resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_REBOQUE');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_reboque'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_reboque');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoCarroReserva:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. Deseja carro reserva? Se sim, por quantos dias? (7, 15, 30 dias ou Não desejo)',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoReboque(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_reboque | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderRespostaBinaria(messageContent, 'Cliente deseja reboque?');
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.reboque = resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_CONDUTOR_MENOR_25');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_condutor_menor_25'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_condutor_menor_25');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoReboque:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. Deseja reboque? (Sim ou Não)',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoCondutorMenor25(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_condutor_menor_25 | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderRespostaBinaria(messageContent, 'Tem algum condutor menor de 25 anos?');
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.condutorMenor25 = resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // Send next question
      const nextQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_TIPO_USO');
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, conversation.id);
      
      // Transition to next state
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'dados_veiculo_tipo_uso'
      });
      
      console.log('[ChatbotService] ✅ Transição para: dados_veiculo_tipo_uso');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoCondutorMenor25:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, não entendi. Tem algum condutor menor de 25 anos? (Sim ou Não)',
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoTipoUso(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: dados_veiculo_tipo_uso | Lead: ${lead.protocol}`);
      
      // Use AI to understand the response
      const resposta = await this.entenderResposta(
        messageContent,
        ['particular', 'comercial', 'motorista de app', 'motorista app', 'app', 'autoescola', 'locadora', 'test drive', 'outro']
      );
      
      // Save the answer
      const collectedData = chatbotState.collectedData as ChatbotCollectedData;
      const dadosVeiculo = (collectedData?.dadosVeiculo as any) || {};
      dadosVeiculo.tipoUso = resposta;
      
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { ...collectedData, dadosVeiculo }
      });
      
      // All vehicle questions answered - create vehicle record and quote
      await this.createVehicleAndQuote(lead, chatbotState, dadosVeiculo);
      
      // Send final message and ask for documents
      const documentsMessage = `Perfeito! Agora preciso dos seguintes documentos:

📄 Documentação necessária:
- CNH do principal condutor
- Nota fiscal ou chassi ou CRLV do veículo
(Se enviar chassi ou placa, confirmar modelo e ano)

Por favor, envie os documentos quando possível. Nossa equipe está analisando sua cotação e entraremos em contato em breve.

Obrigado por escolher a Portilho Corretora! 💚`;

      await this.sendMessageWithRetry(lead.whatsappPhone, documentsMessage, conversation.id);
      
      // Mark lead as completed and finalize conversation
      await db.update(leads)
        .set({ 
          status: 'aguardando_documentos',
          tags: [...(lead.tags || []), 'AGUARDANDO_DOCUMENTOS']
        })
        .where(eq(leads.id, lead.id));
      
      // Transition to finalized state - no more automatic responses
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'conversa_finalizada',
        context: {
          ...(chatbotState.context || {}),
          finalizedAt: Date.now(),
          finalReason: 'solicitacao_documentos_enviada'
        }
      });
      
      console.log('[ChatbotService] ✅ Conversa finalizada - aguardando documentos, não responder mais automaticamente');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleDadosVeiculoTipoUso:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone,
        'Desculpe, houve um erro ao processar sua resposta. Por favor, digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }
  
  // Helper function to create vehicle and quote records
  private async createVehicleAndQuote(
    lead: Lead,
    chatbotState: ChatbotState,
    dadosVeiculo: any
  ) {
    try {
      console.log('[ChatbotService] 💾 Criando registro de veículo e cotação...');
      
      // Create vehicle record
      await db.insert(vehicles).values({
        leadId: lead.id,
        parkingType: dadosVeiculo.estacionamento as any,
        gateType: dadosVeiculo.tipoPortao === 'automático' ? 'automatico' : 'manual',
        workStudyUse: dadosVeiculo.usoTrabalhoEstudo,
        residenceType: dadosVeiculo.tipoResidencia,
        reserveCar: dadosVeiculo.carroReserva,
        towing: dadosVeiculo.reboque === 'sim',
        hasDriverUnder25: dadosVeiculo.condutorMenor25 === 'sim',
        useType: this.mapTipoUsoToEnum(dadosVeiculo.tipoUso),
        hasWithCustomer: (chatbotState.collectedData as ChatbotCollectedData)?.veiculoComCliente || false
      });
      
      // Create quote record
      await db.insert(quotes).values({
        leadId: lead.id,
        insuranceType: 'auto',
        status: 'em_analise',
        details: {
          dadosPessoais: (chatbotState.collectedData as ChatbotCollectedData)?.dadosPessoais,
          dadosVeiculo
        }
      });
      
      console.log('[ChatbotService] ✅ Veículo e cotação criados com sucesso');
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro ao criar veículo e cotação:', error);
      throw error;
    }
  }
  
  // Helper function to map tipo de uso to enum
  private mapTipoUsoToEnum(tipoUso: string): any {
    const lowercaseTipo = tipoUso.toLowerCase();
    
    if (lowercaseTipo.includes('particular')) return 'particular';
    if (lowercaseTipo.includes('comercial')) return 'comercial';
    if (lowercaseTipo.includes('motorista') || lowercaseTipo.includes('app')) return 'motorista_app';
    if (lowercaseTipo.includes('autoescola')) return 'autoescola';
    if (lowercaseTipo.includes('locadora')) return 'locadora';
    if (lowercaseTipo.includes('test drive')) return 'test_drive';
    
    return 'outro';
  }
  
  // Helper function to understand multiple choice responses
  private async entenderResposta(
    message: string,
    options: string[]
  ): Promise<string> {
    try {
      const prompt = `Analise a mensagem do usuário e identifique qual opção ele escolheu.

OPÇÕES VÁLIDAS: ${options.join(', ')}

MENSAGEM: "${message}"

REGRAS:
1. Retorne APENAS uma das opções válidas (exatamente como está na lista)
2. Se a resposta mencionar claramente uma opção, retorne essa opção
3. Se não conseguir identificar, retorne a opção mais próxima
4. Retorne apenas a opção, sem explicações

RESPOSTA:`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você identifica a opção escolhida pelo usuário. Retorne apenas a opção escolhida.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 50
      });

      const resposta = completion.choices[0].message.content?.trim().toLowerCase() || options[0];
      
      // Find the matching option
      const matchedOption = options.find(opt => 
        resposta.includes(opt.toLowerCase()) || opt.toLowerCase().includes(resposta)
      );
      
      return matchedOption || options[0];
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro ao entender resposta:', error);
      return options[0]; // Return first option as fallback
    }
  }

  private async handleMenu3Renovacao(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu3_renovacao | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();
      let tipoIdentificador = '';
      let tipoSeguro = '';

      // Identificar o tipo de seguro escolhido
      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('frota') || lowercaseMessage.includes('🚗')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é a placa do veículo?', conversation.id);
        tipoIdentificador = 'placa';
        tipoSeguro = 'Auto/Frota';
      } else if (lowercaseMessage.includes('empresarial') || lowercaseMessage.includes('🏢')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CNPJ da empresa?', conversation.id);
        tipoIdentificador = 'cnpj';
        tipoSeguro = 'Empresarial';
      } else if (lowercaseMessage.includes('vida') || lowercaseMessage.includes('💚')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Vida';
      } else if (lowercaseMessage.includes('residencial') || lowercaseMessage.includes('🏠')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Residencial';
      } else if (lowercaseMessage.includes('viagem') || lowercaseMessage.includes('✈️')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Viagem';
      } else if (lowercaseMessage.includes('equipamento') || lowercaseMessage.includes('máquina') || lowercaseMessage.includes('agrícola') || lowercaseMessage.includes('⚙️')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF ou CNPJ do segurado?', conversation.id);
        tipoIdentificador = 'cpf_cnpj';
        tipoSeguro = 'Equipamentos/Máquinas Agrícolas';
      } else if (lowercaseMessage.includes('rc profissional') || lowercaseMessage.includes('profissional') || lowercaseMessage.includes('💼')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF ou CNPJ do segurado?', conversation.id);
        tipoIdentificador = 'cpf_cnpj';
        tipoSeguro = 'RC Profissional';
      } else if (lowercaseMessage.includes('fiança') || lowercaseMessage.includes('🏘️')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Seguro Fiança';
      } else {
        // Se não identificou o tipo, perguntar novamente
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          'Por favor, me informe qual tipo de seguro você deseja renovar escolhendo uma das opções:\n🚗 Auto / Frota\n🏢 Empresarial\n🏠 Residencial\n💚 Vida\n✈️ Viagem\n⚙️ Equipamentos / Máquinas agrícolas\n💼 RC Profissional\n🏘️ Seguro Fiança',
          conversation.id
        );
        console.log(`[ChatbotService] ⚠️ Tipo de seguro não identificado, solicitando novamente`);
        return;
      }

      // Atualizar o estado para aguardar o identificador
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'aguardando_identificador',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          tipoRenovacao: tipoSeguro,
          tipoIdentificador 
        }
      });
      
      console.log(`[ChatbotService] ✅ Transição para: aguardando_identificador | Tipo: ${tipoSeguro} | Identificador: ${tipoIdentificador}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu3Renovacao:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        conversation.id
      );
    }
  }

  private async handleMenu4Endosso(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu4_endosso | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();

      // Identificar o tipo de alteração escolhida
      if (lowercaseMessage.includes('item segurado') || lowercaseMessage.includes('item')) {
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          `Perfeito! Por favor, me informe qual item deseja alterar:
🔘 Veículo
🔘 Outros`, 
          conversation.id
        );
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'endosso_item',
          collectedData: { 
            ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
            tipoEndosso: 'item_segurado' 
          }
        });
        console.log(`[ChatbotService] ✅ Transição para: endosso_item`);
        
      } else if (lowercaseMessage.includes('cadastral')) {
        // Alteração cadastral - transferir direto para humano
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          'Entendi! Para alterações cadastrais, vou transferir você para nosso setor de atendimento. Em breve entrarão em contato. 💚', 
          conversation.id
        );
        await this.handleHumanHandoff(lead, conversation, 'Endosso - Alteração Cadastral');
        console.log(`[ChatbotService] ✅ Transferindo para humano - Alteração Cadastral`);
        
      } else if (lowercaseMessage.includes('cobertura')) {
        // Alteração de cobertura - transferir direto para humano
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          'Entendi! Para alterações de cobertura, vou transferir você para nosso setor especializado. Em breve entrarão em contato. 💚', 
          conversation.id
        );
        await this.handleHumanHandoff(lead, conversation, 'Endosso - Alteração de Cobertura');
        console.log(`[ChatbotService] ✅ Transferindo para humano - Alteração de Cobertura`);
        
      } else {
        // Se não identificou o tipo, perguntar novamente
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          `Por favor, escolha uma das opções abaixo:
🔘 Alteração cadastral
🔘 Alteração de cobertura
🔘 Alteração no item segurado`, 
          conversation.id
        );
        console.log(`[ChatbotService] ⚠️ Tipo de endosso não identificado, solicitando novamente`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu4Endosso:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleMenu5Parcelas(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu5_parcelas | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();
      let tipoIdentificador = '';
      let tipoSeguro = '';

      // Identificar o tipo de seguro escolhido (similar ao Menu 3)
      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('frota') || lowercaseMessage.includes('🚗')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é a placa do veículo?', conversation.id);
        tipoIdentificador = 'placa';
        tipoSeguro = 'Auto/Frota';
      } else if (lowercaseMessage.includes('empresarial') || lowercaseMessage.includes('🏢')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CNPJ da empresa?', conversation.id);
        tipoIdentificador = 'cnpj';
        tipoSeguro = 'Empresarial';
      } else if (lowercaseMessage.includes('vida') || lowercaseMessage.includes('💚') || 
                 lowercaseMessage.includes('residencial') || lowercaseMessage.includes('🏠')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = lowercaseMessage.includes('vida') ? 'Vida' : 'Residencial';
      } else {
        // Para outros tipos, pedir CPF
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = messageContent;
      }

      await this.updateChatbotState(chatbotState.id, {
        currentState: 'aguardando_identificador_parcelas',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          tipoSeguroParcelas: tipoSeguro,
          tipoIdentificador 
        }
      });
      
      console.log(`[ChatbotService] ✅ Transição para: aguardando_identificador_parcelas | Tipo: ${tipoSeguro}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu5Parcelas:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleMenu6Sinistros(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu6_sinistros | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();
      let tipoIdentificador = '';
      let tipoSeguro = '';

      // Identificar o tipo de seguro escolhido (similar ao Menu 3)
      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('frota') || lowercaseMessage.includes('🚗')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é a placa do veículo?', conversation.id);
        tipoIdentificador = 'placa';
        tipoSeguro = 'Auto/Frota';
      } else if (lowercaseMessage.includes('empresarial') || lowercaseMessage.includes('🏢')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CNPJ da empresa?', conversation.id);
        tipoIdentificador = 'cnpj';
        tipoSeguro = 'Empresarial';
      } else if (lowercaseMessage.includes('vida') || lowercaseMessage.includes('💚') || 
                 lowercaseMessage.includes('residencial') || lowercaseMessage.includes('🏠')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = lowercaseMessage.includes('vida') ? 'Vida' : 'Residencial';
      } else {
        // Para outros tipos, pedir CPF
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = messageContent;
      }

      await this.updateChatbotState(chatbotState.id, {
        currentState: 'aguardando_identificador_sinistros',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          tipoSeguroSinistros: tipoSeguro,
          tipoIdentificador 
        }
      });
      
      console.log(`[ChatbotService] ✅ Transição para: aguardando_identificador_sinistros | Tipo: ${tipoSeguro}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu6Sinistros:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleAguardandoApolice(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: aguardando_apolice | Lead: ${lead.protocol}`);
      
      // Check if client wants to keep current data or review
      const lowercaseMessage = messageContent.toLowerCase();
      
      if (lowercaseMessage.includes('sim') || lowercaseMessage.includes('manter')) {
        const confirmMessage = `Perfeito! Vou processar sua cotação mantendo os dados atuais da apólice.
Nossa equipe irá analisar e entrar em contato em breve com as melhores opções. 💚

Obrigado por escolher a Portilho Corretora!`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, confirmMessage, conversation.id);
        await this.handleHumanHandoff(lead, conversation, 'Cotação de apólice - mantém dados atuais');
      } else if (lowercaseMessage.includes('não') || lowercaseMessage.includes('revisar') || lowercaseMessage.includes('atualizar')) {
        const reviewMessage = `Entendi! Para revisar os dados, vou transferir você para um especialista que poderá ajudá-lo com todas as alterações necessárias. 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, reviewMessage, conversation.id);
        await this.handleHumanHandoff(lead, conversation, 'Cotação de apólice - deseja revisar dados');
      } else {
        // Client sent something else - could be the policy document
        const receivedMessage = `Recebi seu envio! Nossa equipe irá analisar e entrar em contato em breve com a melhor proposta. 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, receivedMessage, conversation.id);
        await this.handleHumanHandoff(lead, conversation, 'Apólice recebida para análise');
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoApolice:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Um especialista entrará em contato em breve.',
        conversation.id
      );
    }
  }

  private async handleFluxoAutoQuandoPega(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_quando_pega | Lead: ${lead.protocol}`);
      
      // Store the date when client will pick up vehicle
      const confirmMessage = `Perfeito! Anotei que você irá pegar o veículo em ${messageContent}.

Agora preciso coletar alguns dados pessoais. Você pode enviar tudo de uma vez ou por áudio, como preferir:

Nome completo, CPF, data de nascimento, estado civil, endereço completo com CEP, telefone, e-mail, profissão e se você é o principal condutor do veículo.`;

      await this.sendMessageWithRetry(lead.whatsappPhone, confirmMessage, conversation.id);
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'fluxo_auto_dados_pessoais',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          dataRetirada: messageContent 
        }
      });
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleFluxoAutoQuandoPega:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleAguardandoIdentificador(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: aguardando_identificador | Lead: ${lead.protocol}`);
      
      const collectedData = chatbotState.collectedData as ChatbotCollectedData || {};
      const tipoIdentificador = collectedData.tipoIdentificador;
      const tipoRenovacao = collectedData.tipoRenovacao || '';
      
      // Aceitar qualquer valor sem validação
      let isValid = true; // Sempre aceitar qualquer valor inserido
      const identificador = messageContent.trim();

      if (isValid) {
        // Criar mensagem detalhada sobre o que foi coletado
        let tipoIdentificadorDescricao = '';
        switch(tipoIdentificador) {
          case 'placa':
            tipoIdentificadorDescricao = 'Placa do veículo';
            break;
          case 'cnpj':
            tipoIdentificadorDescricao = 'CNPJ';
            break;
          case 'cpf':
            tipoIdentificadorDescricao = 'CPF';
            break;
          case 'cpf_cnpj':
            tipoIdentificadorDescricao = 'CPF/CNPJ';
            break;
          default:
            tipoIdentificadorDescricao = 'Identificador';
        }

        // Salvar o identificador nos dados coletados
        await this.updateChatbotState(chatbotState.id, {
          collectedData: { 
            ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
            identificador
          }
        });

        const successMessage = `Perfeito! Anotei os dados:
▫️ Tipo de seguro: ${tipoRenovacao}
▫️ ${tipoIdentificadorDescricao}: ${identificador}

Vou encaminhar seu atendimento para o setor responsável. Em breve entrarão em contato. 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, successMessage, conversation.id);
        
        // Transferir para humano com informações completas
        const handoffInfo = `Renovação de Seguro
Tipo: ${tipoRenovacao}
${tipoIdentificadorDescricao}: ${identificador}`;
        
        await this.handleHumanHandoff(lead, conversation, handoffInfo);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Renovação de ${tipoRenovacao}`);
      } else {
        const errorMessage = `Desculpe, o ${tipoIdentificador} informado parece estar incorreto.
Por favor, verifique e envie novamente.`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, errorMessage, conversation.id);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoIdentificador:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleAguardandoIdentificadorParcelas(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: aguardando_identificador_parcelas | Lead: ${lead.protocol}`);
      
      const collectedData = chatbotState.collectedData as ChatbotCollectedData || {};
      const tipoIdentificador = collectedData.tipoIdentificador;
      const tipoSeguroParcelas = collectedData.tipoSeguroParcelas || '';
      
      // Aceitar qualquer valor sem validação
      const identificador = messageContent.trim();

      // Criar mensagem detalhada sobre o que foi coletado
      let tipoIdentificadorDescricao = '';
      switch(tipoIdentificador) {
        case 'placa':
          tipoIdentificadorDescricao = 'Placa do veículo';
          break;
        case 'cnpj':
          tipoIdentificadorDescricao = 'CNPJ';
          break;
        case 'cpf':
          tipoIdentificadorDescricao = 'CPF';
          break;
        default:
          tipoIdentificadorDescricao = 'Identificador';
      }

      // Salvar o identificador nos dados coletados
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          identificador
        }
      });

      const successMessage = `Obrigado! Localizei suas informações:
▫️ Tipo de seguro: ${tipoSeguroParcelas}
▫️ ${tipoIdentificadorDescricao}: ${identificador}

Vou verificar suas parcelas e boletos. Um especialista entrará em contato em breve. 💚`;
      
      await this.sendMessageWithRetry(lead.whatsappPhone, successMessage, conversation.id);
      
      // Transferir para humano com informações completas
      const handoffInfo = `Parcelas/Boletos
Tipo de Seguro: ${tipoSeguroParcelas}
${tipoIdentificadorDescricao}: ${identificador}`;
      
      await this.handleHumanHandoff(lead, conversation, handoffInfo);
      console.log(`[ChatbotService] ✅ Transferindo para humano - Parcelas de ${tipoSeguroParcelas}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoIdentificadorParcelas:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleAguardandoIdentificadorSinistros(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: aguardando_identificador_sinistros | Lead: ${lead.protocol}`);
      
      const collectedData = chatbotState.collectedData as ChatbotCollectedData || {};
      const tipoIdentificador = collectedData.tipoIdentificador;
      const tipoSeguroSinistros = collectedData.tipoSeguroSinistros || '';
      
      // Aceitar qualquer valor sem validação
      const identificador = messageContent.trim();

      // Criar mensagem detalhada sobre o que foi coletado
      let tipoIdentificadorDescricao = '';
      switch(tipoIdentificador) {
        case 'placa':
          tipoIdentificadorDescricao = 'Placa do veículo';
          break;
        case 'cnpj':
          tipoIdentificadorDescricao = 'CNPJ';
          break;
        case 'cpf':
          tipoIdentificadorDescricao = 'CPF';
          break;
        default:
          tipoIdentificadorDescricao = 'Identificador';
      }

      // Salvar o identificador nos dados coletados
      await this.updateChatbotState(chatbotState.id, {
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          identificador
        }
      });

      const successMessage = `Obrigado! Localizei suas informações:
▫️ Tipo de seguro: ${tipoSeguroSinistros}
▫️ ${tipoIdentificadorDescricao}: ${identificador}

🚨 SINISTRO/ASSISTÊNCIA - Vou transferir você imediatamente para nossa equipe especializada. Em instantes será atendido. 💚`;
      
      await this.sendMessageWithRetry(lead.whatsappPhone, successMessage, conversation.id);
      
      // Transferir para humano com informações completas - PRIORIDADE ALTA
      const handoffInfo = `🚨 SINISTRO/ASSISTÊNCIA - PRIORIDADE ALTA
Tipo de Seguro: ${tipoSeguroSinistros}
${tipoIdentificadorDescricao}: ${identificador}`;
      
      await this.handleHumanHandoff(lead, conversation, handoffInfo);
      console.log(`[ChatbotService] 🚨 Transferindo para humano - SINISTRO de ${tipoSeguroSinistros}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoIdentificadorSinistros:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleEndossoItem(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: endosso_item | Lead: ${lead.protocol}`);
      
      const lowercaseMessage = messageContent.toLowerCase();
      
      if (lowercaseMessage.includes('veículo') || lowercaseMessage.includes('veiculo') || lowercaseMessage.includes('carro')) {
        // Veículo selecionado - solicitar CRLV ou nota fiscal
        const veiculoMessage = `Para prosseguir, envie o documento necessário para a alteração do veículo: CRLV ou nota fiscal.`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, veiculoMessage, conversation.id);
        
        // Atualizar estado para aguardar documento
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'aguardando_documentos',
          collectedData: { 
            ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
            tipoEndosso: 'item_segurado',
            itemAlterado: 'veiculo' 
          }
        });
        console.log(`[ChatbotService] ✅ Transição para: aguardando_documentos | Item: Veículo`);
        
      } else if (lowercaseMessage.includes('outro')) {
        // Outros itens - solicitar nota fiscal ou documento equivalente
        const outrosMessage = `Para prosseguir, envie a nota fiscal ou documento equivalente do item.`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, outrosMessage, conversation.id);
        
        // Atualizar estado para aguardar documento
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'aguardando_documentos',
          collectedData: { 
            ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
            tipoEndosso: 'item_segurado',
            itemAlterado: 'outros' 
          }
        });
        console.log(`[ChatbotService] ✅ Transição para: aguardando_documentos | Item: Outros`);
        
      } else {
        // Se não identificou o tipo, perguntar novamente
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          `Por favor, me informe qual item deseja alterar:
🔘 Veículo
🔘 Outros`, 
          conversation.id
        );
        console.log(`[ChatbotService] ⚠️ Item não identificado, solicitando novamente`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleEndossoItem:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        conversation.id
      );
    }
  }

  private async handleAguardandoDocumentos(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: aguardando_documentos | Lead: ${lead.protocol}`);
      
      const collectedData = chatbotState.collectedData as ChatbotCollectedData || {};
      const tipoEndosso = collectedData.tipoEndosso;
      const itemAlterado = collectedData.itemAlterado;
      
      // Verificar se é um documento de endosso
      if (tipoEndosso === 'item_segurado' && itemAlterado) {
        // Endosso - Item Segurado
        const itemDescricao = itemAlterado === 'veiculo' ? 'Veículo' : 'Outros';
        
        const thankYouMessage = `Perfeito! Recebi o documento para alteração de ${itemDescricao}. 📄
        
Vou encaminhar seu atendimento para o setor responsável. Em breve entrarão em contato. 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, thankYouMessage, conversation.id);
        
        // Transferir para humano com informações detalhadas
        const handoffInfo = `Endosso - Alteração no Item Segurado
Item: ${itemDescricao}
Documento: Recebido`;
        
        await this.handleHumanHandoff(lead, conversation, handoffInfo);
        console.log(`[ChatbotService] ✅ Documento de endosso recebido - Transferindo para humano`);
        
      } else {
        // Outros tipos de documento (mantém comportamento original)
        const thankYouMessage = `Obrigado por enviar os documentos! 📄
Nossa equipe irá analisar e entrar em contato em breve com sua cotação.

Fique à vontade para enviar mais informações ou documentos se desejar.

Agradecemos por escolher a Portilho Corretora! 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, thankYouMessage, conversation.id);
        
        // Update lead to indicate documents were received and mark as completed
        await db.update(leads)
          .set({ 
            tags: [...(lead.tags || []), 'DOCUMENTOS_RECEBIDOS'],
            status: 'concluido'
          })
          .where(eq(leads.id, lead.id));
        
        // Mark conversation as finalized - no more automatic responses
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'conversa_finalizada',
          context: {
            ...(chatbotState.context || {}),
            finalizedAt: Date.now(),
            finalReason: 'documentos_recebidos'
          }
        });
        
        console.log('[ChatbotService] ✅ Documentos recebidos, conversa finalizada - não responder mais automaticamente');
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoDocumentos:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Obrigado pelo envio! Nossa equipe entrará em contato em breve.',
        conversation.id
      );
    }
  }

  private async extractDataWithAI(message: string, dataType: string): Promise<any> {
    try {
      const prompt = dataType === 'personal_data' 
        ? 'Extract personal data (name, CPF, email, birth date, marital status, profession, address, CEP) from the following message. Return as JSON.'
        : 'Extract vehicle data (parking type, gate type, work/study use, residence type, reserve car days, towing, driver under 25, use type) from the following message. Return as JSON.';

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: prompt + ' If data is not found, use null. Always return valid JSON.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        response_format: { type: 'json_object' }
      });

      return JSON.parse(completion.choices[0].message.content || '{}');
    } catch (error) {
      console.error('Error extracting data with AI:', error);
      return {};
    }
  }

  private async generateAIResponse(context: string, userMessage: string): Promise<string | null> {
    try {
      console.log('[ChatbotService] Generating AI response for context:', context);
      
      const systemPrompt = `Você é Serena, assistente virtual da Portilho Corretora de Seguros.
      Seja sempre amigável, profissional e use emojis moderadamente (💚 é o emoji da empresa).
      Mantenha as respostas curtas e diretas, sempre em português brasileiro.
      Contexto: ${context}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 150,
        temperature: 0.7
      });

      const response = completion.choices[0].message.content;
      console.log('[ChatbotService] AI response generated:', response);
      return response;
    } catch (error) {
      console.error('[ChatbotService] Error generating AI response:', error);
      return null;
    }
  }

  private async handleHumanHandoff(lead: Lead, conversation: Conversation, reason: string) {
    // Update lead status
    await db.update(leads)
      .set({ 
        status: 'transferido_humano',
        assignedTo: 'pending'
      })
      .where(eq(leads.id, lead.id));

    // Update conversation
    await db.update(conversations)
      .set({ 
        status: 'transferred',
        endedAt: new Date()
      })
      .where(eq(conversations.id, conversation.id));

    // Update chatbot state to PERMANENTLY stop automatic responses
    const [chatbotState] = await db.select()
      .from(chatbotStates)
      .where(eq(chatbotStates.conversationId, conversation.id))
      .limit(1);

    if (chatbotState) {
      await db.update(chatbotStates)
        .set({ 
          isPermanentHandoff: true,
          handoffUntil: null  // Clear any temporary handoff
        })
        .where(eq(chatbotStates.id, chatbotState.id));
      
      console.log(`[ChatbotService] 🔇 Respostas automáticas DESATIVADAS PERMANENTEMENTE para lead ${lead.protocol}`);
    }

    // Send notification message
    await this.wahaAPI.sendText(
      lead.whatsappPhone,
      'Estou transferindo você para um de nossos especialistas. Em breve você será atendido. Obrigado pela paciência! 💚',
      conversation.id
    );

    // Log the handoff
    await db.insert(messages).values({
      conversationId: conversation.id,
      content: `[SISTEMA] Transferido para atendimento humano. Motivo: ${reason}. Bot desativado permanentemente - apenas atendentes poderão responder.`,
      isBot: true,
      messageType: 'system'
    });
  }

  private async updateChatbotState(stateId: string, updates: any) {
    console.log(`[ChatbotService] 🔄 updateChatbotState - stateId: ${stateId}`);
    console.log(`[ChatbotService] 🔄 Updates:`, JSON.stringify(updates));
    
    // Buscar estado atual para fazer merge de objetos aninhados
    const currentState = await db.query.chatbotStates.findFirst({
      where: eq(chatbotStates.id, stateId)
    });
    
    if (!currentState) {
      throw new Error(`ChatbotState ${stateId} not found`);
    }
    
    // 🛡️🛡️🛡️ PROTEÇÃO ABSOLUTA CONTRA RESET - NUNCA PERMITIR VOLTAR PARA INITIAL SE HÁ DADOS
    const currentCollectedData = currentState.collectedData as ChatbotCollectedData;
    const hasCollectedData = currentCollectedData && (
      currentCollectedData.dadosPessoais || 
      currentCollectedData.dadosVeiculo || 
      currentCollectedData.tipoSeguro || 
      currentCollectedData.escolha ||
      currentCollectedData.mainMenu ||
      Object.keys(currentCollectedData).length > 0
    );
    
    // BLOQUEAR reset para 'initial' se há dados coletados
    if (hasCollectedData && updates.currentState === 'initial') {
      console.log('[ChatbotService] 🛡️🛡️🛡️ PROTEÇÃO ABSOLUTA: Tentativa de reset para "initial" BLOQUEADA!');
      console.log('[ChatbotService] 🛡️ Dados presentes:', Object.keys(currentCollectedData));
      console.log('[ChatbotService] 🛡️ Estado atual mantido:', currentState.currentState);
      console.log('[ChatbotService] 🛡️ Stack trace da tentativa de reset:', new Error().stack);
      
      // NÃO permitir mudança para initial
      delete updates.currentState;
    }
    
    // Preparar dados para atualização com merge profundo
    const updateData: any = {
      updatedAt: new Date()
    };
    
    // Atualizar currentState se fornecido
    if (updates.currentState !== undefined) {
      updateData.currentState = updates.currentState;
    }
    
    // Deep merge function para preservar dados aninhados
    function deepMerge(target: any, source: any): any {
      if (!source) return target;
      if (!target) return source;
      
      const result = { ...target };
      
      for (const key in source) {
        if (source.hasOwnProperty(key)) {
          if (source[key] === null || source[key] === undefined) {
            // Permitir null/undefined apenas se não for campo crítico
            if (key !== 'dadosPessoais' && key !== 'dadosVeiculo') {
              result[key] = source[key];
            }
          } else if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
          } else {
            result[key] = source[key];
          }
        }
      }
      
      return result;
    }
    
    // Fazer merge de objetos aninhados preservando dados existentes
    if (updates.context !== undefined) {
      updateData.context = deepMerge(currentState.context, updates.context);
    }
    
    if (updates.menuSelections !== undefined) {
      updateData.menuSelections = deepMerge(currentState.menuSelections, updates.menuSelections);
    }
    
    if (updates.collectedData !== undefined) {
      // PROTEÇÃO ESPECIAL para collectedData - NUNCA perder dados já coletados
      updateData.collectedData = deepMerge(currentState.collectedData, updates.collectedData);
      console.log(`[ChatbotService] 🛡️ CollectedData após merge:`, JSON.stringify(updateData.collectedData));
    }
    
    if (updates.pendingActions !== undefined) {
      updateData.pendingActions = updates.pendingActions;
    }
    
    console.log(`[ChatbotService] 💾 Atualizando no banco:`, JSON.stringify(updateData));
    if (updates.currentState) {
      console.log(`[ChatbotService] ⚠️ MUDANDO ESTADO: ${currentState.currentState} → ${updates.currentState}`);
    }
    
    // Atualizar no banco
    await db.update(chatbotStates)
      .set(updateData)
      .where(eq(chatbotStates.id, stateId));
      
    console.log(`[ChatbotService] ✅ Estado ${stateId} atualizado. Novo state: ${updateData.currentState || currentState.currentState}`);
  }

  private async fillTemplate(templateKey: string, replacements: Record<string, string>): Promise<string> {
    let template = await this.getMessageTemplate(templateKey);
    
    for (const [key, value] of Object.entries(replacements)) {
      // Escape special regex characters in the key before using it in RegExp
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      template = template.replace(new RegExp(escapedKey, 'g'), value);
    }
    
    return template;
  }

  // NEW: Intelligent workflow analyzer using OpenAI
  private async analyzeWorkflowState(
    currentState: string,
    userMessage: string,
    conversationHistory: string[] = [],
    collectedData: any = {}
  ): Promise<{
    nextState: string;
    responseMessages: string[];
    shouldHandoff: boolean;
    extractedData?: any;
    confidence: string;
  }> {
    try {
      const systemPrompt = `Você é Serena, assistente virtual especializada em seguros da Portilho Corretora.
Sua tarefa é analisar a conversa e determinar o próximo passo correto no workflow de atendimento.

WORKFLOW COMPLETO:
1. INICIAL → Enviar MENSAGEM1 (boas-vindas) e MENSAGEM2 (menu principal)
2. MENU_SELECTION → Cliente escolhe uma das 6 opções:
   - Opção 1: Seguros Novos (vai para MENU1_SEGUROS_NOVOS)
   - Opção 2: Seguros Novos Autorio (transfere para humano)
   - Opção 3: Renovação (vai para MENU3_RENOVACAO)
   - Opção 4: Endosso/Alteração (vai para MENU4_ENDOSSO)
   - Opção 5: Parcelas/Boletos (vai para MENU5_PARCELAS)
   - Opção 6: Sinistros/Assistências (vai para MENU6_SINISTROS)

3. MENU1_SEGUROS_NOVOS → Perguntar:
   - "Como conheceu a Portilho?"
   - "Deseja fazer seguro novo ou cotação de outra seguradora?"
   
4. MENU1_TIPO_SEGURO → Cliente escolhe tipo:
   - Auto → vai para FLUXO_AUTO_STATUS
   - Outros (Frota, Residencial, etc.) → transfere para humano

5. FLUXO_AUTO_STATUS → Perguntar:
   - "O veículo já está com você ou quando irá pegá-lo?"
   - Se já está: prioridade URGENTE, vai para FLUXO_AUTO_DADOS_PESSOAIS
   - Se não está: pergunta data, prioridade NORMAL

6. FLUXO_AUTO_DADOS_PESSOAIS → Coletar dados pessoais
7. FLUXO_AUTO_DADOS_VEICULO → Coletar dados do veículo

ESTADO ATUAL: ${currentState}
DADOS JÁ COLETADOS: ${JSON.stringify(collectedData)}
HISTÓRICO: ${conversationHistory.join(' | ')}
MENSAGEM DO CLIENTE: ${userMessage}

ANÁLISE REQUERIDA:
1. O cliente está respondendo à pergunta correta para o estado atual?
2. Qual é a intenção do cliente nesta mensagem?
3. Qual deve ser o próximo estado do workflow?
4. Que mensagens devem ser enviadas?
5. Algum dado pode ser extraído desta mensagem?

Retorne um JSON com:
{
  "nextState": "estado_do_workflow",
  "responseMessages": ["mensagem1", "mensagem2"],
  "shouldHandoff": false,
  "extractedData": {},
  "confidence": "high|medium|low",
  "reasoning": "explicação da decisão"
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analise esta interação e determine o próximo passo.` }
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });

      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');
      console.log('[ChatbotService] 🤖 Análise do Workflow:', analysis);
      
      return {
        nextState: analysis.nextState || currentState,
        responseMessages: analysis.responseMessages || [],
        shouldHandoff: analysis.shouldHandoff || false,
        extractedData: analysis.extractedData || {},
        confidence: analysis.confidence || 'low'
      };
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro ao analisar workflow:', error);
      // Fallback to simple analysis
      return {
        nextState: currentState,
        responseMessages: [],
        shouldHandoff: false,
        confidence: 'low'
      };
    }
  }

  // Understand user intent using intelligent local pattern matching (no OpenAI needed)
  private async understandMenuIntent(userMessage: string): Promise<string> {
    console.log(`[ChatbotService] 🔍 Analisando intenção do menu para: "${userMessage}"`);
    
    // CRITICAL: Clean message prefix first (removes "Mensagem N:" pattern)
    const cleanedMessage = this.cleanMessagePrefix(userMessage);
    console.log(`[ChatbotService] 🧹 Mensagem limpa: "${cleanedMessage}"`);
    
    const msg = cleanedMessage.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove accents
    
    // 1. Check for direct number input (most common)
    const directNumber = msg.match(/^(\d+)$/);
    if (directNumber) {
      const num = directNumber[1];
      if (['1', '2', '3', '4', '5', '6'].includes(num)) {
        console.log(`[ChatbotService] ✅ Número direto detectado: ${num}`);
        return num;
      }
    }
    
    // 2. Check for written numbers in Portuguese
    const writtenNumbers: Record<string, string> = {
      'um': '1', 'uma': '1', 'primeiro': '1', 'primeira': '1',
      'dois': '2', 'duas': '2', 'segundo': '2', 'segunda': '2',
      'tres': '3', 'terceiro': '3', 'terceira': '3',
      'quatro': '4', 'quarto': '4', 'quarta': '4',
      'cinco': '5', 'quinto': '5', 'quinta': '5',
      'seis': '6', 'sexto': '6', 'sexta': '6'
    };
    
    for (const [word, number] of Object.entries(writtenNumbers)) {
      if (msg === word || msg === `opcao ${word}` || msg === `opcao numero ${word}`) {
        console.log(`[ChatbotService] ✅ Número por extenso detectado: ${word} → ${number}`);
        return number;
      }
    }
    
    // 3. Check for emoji numbers (1️⃣, 2️⃣, etc.)
    const emojiMatch = userMessage.match(/[1-6]️⃣/);
    if (emojiMatch) {
      const num = emojiMatch[0].charAt(0);
      console.log(`[ChatbotService] ✅ Emoji número detectado: ${num}`);
      return num;
    }
    
    // 4. Check for greetings (default to option 1 - most common for new customers)
    const greetings = [
      'oi', 'ola', 'opa', 'hey', 'e ai', 'eai', 'oii', 'oie',
      'bom dia', 'boa tarde', 'boa noite', 'bomdia', 'boatarde', 'boanoite'
    ];
    
    for (const greeting of greetings) {
      if (msg === greeting || msg.startsWith(greeting + ' ') || msg.startsWith(greeting + '!')) {
        console.log(`[ChatbotService] ✅ Saudação detectada: "${greeting}" → opção 1 (padrão para novos clientes)`);
        return '1';
      }
    }
    
    // 5. Check for keywords related to each option
    
    // OPTION 1: Seguros Novos - Geral
    const option1Keywords = [
      'seguro novo', 'seguro geral', 'cotacao', 'quero fazer', 'preciso de',
      'contratar', 'informacoes', 'gostaria', 'fazer seguro', 'novo seguro',
      'produtos diversos', 'geral'
    ];
    
    for (const keyword of option1Keywords) {
      if (msg.includes(keyword)) {
        console.log(`[ChatbotService] ✅ Palavra-chave opção 1 detectada: "${keyword}"`);
        return '1';
      }
    }
    
    // OPTION 2: Seguros Novos - Autorio
    const option2Keywords = [
      'autorio', 'auto rio', 'seguro autorio', 'cotacao autorio'
    ];
    
    for (const keyword of option2Keywords) {
      if (msg.includes(keyword)) {
        console.log(`[ChatbotService] ✅ Palavra-chave opção 2 detectada: "${keyword}"`);
        return '2';
      }
    }
    
    // OPTION 3: Renovação
    const option3Keywords = [
      'renovar', 'renovacao', 'venceu', 'vencendo', 'renovar seguro',
      'atualizar', 'apolice vencendo', 'vence', 'vencida'
    ];
    
    for (const keyword of option3Keywords) {
      if (msg.includes(keyword)) {
        console.log(`[ChatbotService] ✅ Palavra-chave opção 3 detectada: "${keyword}"`);
        return '3';
      }
    }
    
    // OPTION 4: Endosso / Alteração
    const option4Keywords = [
      'endosso', 'alterar', 'alteracao', 'mudanca', 'mudar',
      'correcao', 'corrigir', 'modificar', 'trocar dados'
    ];
    
    for (const keyword of option4Keywords) {
      if (msg.includes(keyword)) {
        console.log(`[ChatbotService] ✅ Palavra-chave opção 4 detectada: "${keyword}"`);
        return '4';
      }
    }
    
    // OPTION 5: Parcelas, Boletos
    const option5Keywords = [
      'boleto', 'parcela', '2a via', 'segunda via', 'pagamento',
      'pagar', 'fatura', 'cobranca', 'mensalidade', 'vencimento'
    ];
    
    for (const keyword of option5Keywords) {
      if (msg.includes(keyword)) {
        console.log(`[ChatbotService] ✅ Palavra-chave opção 5 detectada: "${keyword}"`);
        return '5';
      }
    }
    
    // OPTION 6: Sinistros / Assistências
    const option6Keywords = [
      'sinistro', 'acidente', 'batida', 'assistencia', 'guincho',
      'socorro', 'ajuda urgente', 'reboque', 'pane', 'quebrou'
    ];
    
    for (const keyword of option6Keywords) {
      if (msg.includes(keyword)) {
        console.log(`[ChatbotService] ✅ Palavra-chave opção 6 detectada: "${keyword}"`);
        return '6';
      }
    }
    
    // 6. If nothing matched, return 0 (not understood)
    console.log(`[ChatbotService] ⚠️ Não foi possível identificar a intenção para: "${userMessage}"`);
    return '0';
  }

  // Understand Menu 1 intent using OpenAI
  private async understandMenu1Intent(userMessage: string): Promise<string> {
    try {
      console.log('[ChatbotService] 🔍 Iniciando análise de intenção Menu1 para:', userMessage);
      
      const systemPrompt = `Você é um assistente que entende a intenção do usuário sobre seguros.
      
O usuário está respondendo à pergunta: "Você deseja fazer um seguro novo ou fazer cotação de um seguro de outra seguradora?"

Analise a mensagem e retorne:
- "seguro_novo" se o usuário quer fazer um seguro novo/primeiro seguro
- "cotacao_outra" se quer fazer cotação/comparar com outra seguradora
- "unclear" se não conseguir identificar

Se o usuário mencionar:
- "novo", "primeiro", "não tenho", "quero fazer" → "seguro_novo"
- "cotação", "comparar", "já tenho", "outra seguradora", "trocar" → "cotacao_outra"

Retorne APENAS uma das três opções, sem explicações.`;

      console.log('[ChatbotService] 📡 Chamando OpenAI GPT-4o-mini...');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 20
      });

      const intent = response.choices[0]?.message?.content?.trim() || 'unclear';
      console.log('[ChatbotService] ✅ Resposta OpenAI recebida:', intent);
      return intent;
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro ao entender intenção do Menu1:', error);
      // Fallback to keyword matching if OpenAI fails
      const lowercaseMessage = userMessage.toLowerCase();
      if (lowercaseMessage.includes('novo') || lowercaseMessage.includes('seguro novo') || lowercaseMessage.includes('fazer um seguro')) {
        console.log('[ChatbotService] 🔄 Fallback: detectado "seguro_novo"');
        return 'seguro_novo';
      } else if (lowercaseMessage.includes('cotação') || lowercaseMessage.includes('cotacao') || lowercaseMessage.includes('outra seguradora')) {
        console.log('[ChatbotService] 🔄 Fallback: detectado "cotacao_outra"');
        return 'cotacao_outra';
      }
      console.log('[ChatbotService] 🔄 Fallback: unclear');
      return 'unclear';
    }
  }

  // Entender resposta binária (sim/não) usando IA de forma natural
  private async entenderRespostaBinaria(userMessage: string, contextQuestion: string): Promise<'sim' | 'não' | 'unclear'> {
    try {
      const systemPrompt = `Você é um assistente que entende se a resposta do usuário é positiva ou negativa.

Pergunta ao usuário: "${contextQuestion}"

Analise a mensagem do usuário e retorne:
- "sim" se a resposta é positiva/afirmativa
- "não" se a resposta é negativa
- "unclear" se não conseguir identificar claramente

Exemplos de respostas POSITIVAS (retorne "sim"):
- "sim", "yeah", "yep", "claro", "com certeza"
- "já tenho", "já está comigo", "já peguei", "está aqui"
- "já comprei", "sim, já está", "está sim"

Exemplos de respostas NEGATIVAS (retorne "não"):
- "não", "nope", "ainda não", "não ainda"
- "vou pegar", "ainda vou buscar", "vou buscar amanhã"
- "não tenho ainda", "compro semana que vem"

Retorne APENAS uma palavra: "sim", "não" ou "unclear".`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 10
      });

      const intent = response.choices[0]?.message?.content?.trim().toLowerCase() || 'unclear';
      console.log(`[ChatbotService] 🤖 Entendimento de resposta: "${userMessage}" → "${intent}"`);
      
      if (intent.includes('sim')) return 'sim';
      if (intent.includes('não') || intent.includes('nao')) return 'não';
      return 'unclear';
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro ao entender resposta binária:', error);
      // Fallback to simple keyword matching if OpenAI fails
      const lowercaseMessage = userMessage.toLowerCase();
      if (lowercaseMessage.includes('sim') || lowercaseMessage.includes('já') || lowercaseMessage.includes('comigo')) {
        return 'sim';
      } else if (lowercaseMessage.includes('não') || lowercaseMessage.includes('nao') || lowercaseMessage.includes('ainda')) {
        return 'não';
      }
      return 'unclear';
    }
  }

  // Send message with retry logic
  private async sendMessageWithRetry(phone: string, text: string, conversationId?: string, maxRetries: number = 3): Promise<any> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ChatbotService] 📤 Tentativa ${attempt}/${maxRetries} de enviar mensagem para ${phone}`);
        const result = await this.wahaAPI.sendText(phone, text, conversationId);
        console.log(`[ChatbotService] ✅ Mensagem enviada com sucesso na tentativa ${attempt}`);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[ChatbotService] ❌ Erro na tentativa ${attempt}:`, error);
        
        if (attempt < maxRetries) {
          const delay = attempt * 1000; // Progressive delay: 1s, 2s, 3s
          console.log(`[ChatbotService] ⏳ Aguardando ${delay}ms antes de tentar novamente...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error(`[ChatbotService] ❌ Falhou após ${maxRetries} tentativas de enviar mensagem`);
    throw lastError;
  }

  // Generate AI-powered contextual messages
  private async generateAIMessage(context: string, userMessage: string, instructions?: string): Promise<string> {
    try {
      const systemPrompt = `Você é Serena, assistente virtual da Portilho Corretora de Seguros. 
Você é amigável, profissional e sempre usa emojis apropriados.
Contexto atual: ${context}
${instructions ? `Instruções específicas: ${instructions}` : ''}

Responda de forma natural e humanizada, sempre mantendo o tom profissional.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 300
      });

      return response.choices[0]?.message?.content || 'Desculpe, não consegui processar sua mensagem. Por favor, tente novamente.';
    } catch (error) {
      console.error('[ChatbotService] Error generating AI message:', error);
      return 'Estou com dificuldades para processar sua mensagem. Um atendente humano irá ajudá-lo em breve.';
    }
  }

  // Generate AI response for Menu 1 (Seguros Novos)
  private async generateMenu1Response(messageContent: string): Promise<string> {
    const instructions = `O cliente está interessado em seguros novos. 
Pergunte primeiro como conheceu a Portilho, depois se deseja:
1. Fazer um seguro novo
2. Fazer cotação de um seguro de outra seguradora
Use emojis e seja acolhedora.`;
    
    return this.generateAIMessage('Menu de Seguros Novos', messageContent, instructions);
  }

  private isHumanHandoffRequest(message: string): boolean {
    const triggers = ['humano', 'atendente', 'falar com alguém', 'pessoa real', 'atendimento humano'];
    const lowercaseMessage = message.toLowerCase();
    return triggers.some(trigger => lowercaseMessage.includes(trigger));
  }

  private generateProtocol(): string {
    const year = new Date().getFullYear();
    const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${year}-${randomNum}`;
  }

  // Validation methods - REMOVIDAS POR REQUISITO DO USUÁRIO
  // A função validateCPF foi comentada pois o usuário solicitou aceitar qualquer valor sem validação
  /*
  validateCPF(cpf: string): boolean {
    const cleaned = cpf.replace(/\D/g, '');
    if (cleaned.length !== 11) return false;
    
    // CPF validation algorithm
    let sum = 0;
    let remainder;
    
    if (cleaned === "00000000000") return false;
    
    for (let i = 1; i <= 9; i++) {
      sum = sum + parseInt(cleaned.substring(i-1, i)) * (11 - i);
    }
    
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cleaned.substring(9, 10))) return false;
    
    sum = 0;
    for (let i = 1; i <= 10; i++) {
      sum = sum + parseInt(cleaned.substring(i-1, i)) * (12 - i);
    }
    
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cleaned.substring(10, 11))) return false;
    
    return true;
  }
  */

  validateCNPJ(cnpj: string): boolean {
    const cleaned = cnpj.replace(/\D/g, '');
    if (cleaned.length !== 14) return false;
    
    // CNPJ validation algorithm
    let length = cleaned.length - 2;
    let numbers = cleaned.substring(0, length);
    const digits = cleaned.substring(length);
    let sum = 0;
    let pos = length - 7;
    
    for (let i = length; i >= 1; i--) {
      sum += parseInt(numbers.charAt(length - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    
    let result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result !== parseInt(digits.charAt(0))) return false;
    
    length = length + 1;
    numbers = cleaned.substring(0, length);
    sum = 0;
    pos = length - 7;
    
    for (let i = length; i >= 1; i--) {
      sum += parseInt(numbers.charAt(length - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    
    result = sum % 11 < 2 ? 0 : 11 - sum % 11;
    if (result !== parseInt(digits.charAt(1))) return false;
    
    return true;
  }

  validatePlate(plate: string): boolean {
    // Brazilian plate formats: ABC-1234 or ABC1D23 (Mercosul)
    const oldFormat = /^[A-Z]{3}-?\d{4}$/;
    const mercosulFormat = /^[A-Z]{3}\d[A-Z]\d{2}$/;
    
    const cleaned = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return oldFormat.test(cleaned) || mercosulFormat.test(cleaned);
  }

  // ========== FUNÇÕES DE RESUMO DE DADOS PESSOAIS ==========

  /**
   * Gera um resumo formatado dos dados pessoais coletados
   * @param lead - Objeto Lead com os dados pessoais
   * @returns String formatada com resumo bonito usando emojis e bullets
   */
  generatePersonalDataSummary(lead: Lead): string {
    console.log('[ChatbotService] 📝 Gerando resumo de dados pessoais para lead:', lead.protocol);
    
    // Formatar CPF mascarado
    const formatCPF = (cpf: string | null): string => {
      if (!cpf) return 'Não informado';
      const cleaned = cpf.replace(/\D/g, '');
      if (cleaned.length !== 11) return cpf;
      return `${cleaned.substring(0, 3)}.${cleaned.substring(3, 6)}.${cleaned.substring(6, 9)}-${cleaned.substring(9)}`;
    };

    // Formatar data de nascimento
    const formatDate = (date: Date | null): string => {
      if (!date) return 'Não informado';
      try {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      } catch {
        return 'Não informado';
      }
    };

    // Formatar CEP
    const formatCEP = (cep: string | null): string => {
      if (!cep) return 'Não informado';
      const cleaned = cep.replace(/\D/g, '');
      if (cleaned.length !== 8) return cep;
      return `${cleaned.substring(0, 5)}-${cleaned.substring(5)}`;
    };

    // Formatar telefone
    const formatPhone = (phone: string | null): string => {
      if (!phone) return 'Não informado';
      const cleaned = phone.replace(/\D/g, '');
      if (cleaned.length === 11) {
        return `(${cleaned.substring(0, 2)}) ${cleaned.substring(2, 7)}-${cleaned.substring(7)}`;
      } else if (cleaned.length === 10) {
        return `(${cleaned.substring(0, 2)}) ${cleaned.substring(2, 6)}-${cleaned.substring(6)}`;
      }
      return phone;
    };

    const summary = `📋 RESUMO DOS SEUS DADOS PESSOAIS

Nome: ${lead.name || 'Não informado'}
CPF: ${formatCPF(lead.cpf)}
Data de Nascimento: ${formatDate(lead.birthDate)}
Estado Civil: ${lead.maritalStatus || 'Não informado'}
Endereço: ${lead.address || 'Não informado'}
CEP: ${formatCEP(lead.cep)}
Telefone: ${formatPhone(lead.phone)}
E-mail: ${lead.email || 'Não informado'}
Profissão: ${lead.profession || 'Não informado'}
Condutor Principal: ${lead.isPrincipalDriver ? 'Sim' : lead.isPrincipalDriver === false ? 'Não' : 'Não informado'}`;

    console.log('[ChatbotService] ✅ Resumo gerado com sucesso');
    return summary;
  }

  // ========== FUNÇÕES DE EXTRAÇÃO INTELIGENTE DE DADOS PESSOAIS ==========

  /**
   * Extrai dados pessoais usando regex local (fallback quando OpenAI falhar)
   * @param message - Mensagem do cliente contendo dados pessoais
   * @returns Objeto com os campos extraídos
   */
  private extractPersonalDataLocalFallback(message: string): any {
    console.log('[ChatbotService] 🔧 Usando fallback local para extração de dados...');
    const cleanedData: any = {};

    // Clean message prefix
    const cleanMsg = this.cleanMessagePrefix(message);
    const msgLower = cleanMsg.toLowerCase();

    // Extract CPF (11 digits, with or without formatting)
    const cpfMatch = cleanMsg.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
    if (cpfMatch) {
      cleanedData.cpf = this.formatCPF(cpfMatch[1]);
      console.log('[ChatbotService] ✅ CPF extraído (regex):', cleanedData.cpf);
    }

    // Extract name - handles multiple patterns
    // Pattern 1: "Meu nome é João Silva" or "Me chamo João Silva"
    let nameMatch = cleanMsg.match(/(?:meu nome(?: é)?|me chamo|sou)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)+)/i);
    if (nameMatch) {
      cleanedData.name = nameMatch[1].trim();
      console.log('[ChatbotService] ✅ Nome extraído (regex pattern 1):', cleanedData.name);
    } else {
      // Pattern 2: Name at the start followed by comma or CPF
      nameMatch = cleanMsg.match(/^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)+)(?:\s*,|\s+\d)/);
      if (nameMatch) {
        cleanedData.name = nameMatch[1].trim();
        console.log('[ChatbotService] ✅ Nome extraído (regex pattern 2):', cleanedData.name);
      }
    }

    // Extract email
    const emailMatch = cleanMsg.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    if (emailMatch) {
      cleanedData.email = emailMatch[1].toLowerCase();
      console.log('[ChatbotService] ✅ Email extraído (regex):', cleanedData.email);
    }

    // Extract CEP (8 digits, with or without dash)
    const cepMatch = cleanMsg.match(/(?:cep[:\s]+)?(\d{5}-?\d{3})\b/i);
    if (cepMatch) {
      cleanedData.cep = this.formatCEP(cepMatch[1]);
      console.log('[ChatbotService] ✅ CEP extraído (regex):', cleanedData.cep);
    }

    // Extract phone (10-11 digits with various formats)
    const phoneMatch = cleanMsg.match(/(?:telefone|celular|fone)[:\s]*(\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4})|(\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4})/i);
    if (phoneMatch) {
      const phone = phoneMatch[1] || phoneMatch[2];
      cleanedData.phone = this.formatPhone(phone);
      console.log('[ChatbotService] ✅ Telefone extraído (regex):', cleanedData.phone);
    }

    // Extract birth date (DD/MM/YYYY or DD-MM-YYYY) - return as Date object
    const birthDateMatch = cleanMsg.match(/(?:nascimento|nasci|data)[:\s]*(\d{2})[/-](\d{2})[/-](\d{4})|(\d{2})[/-](\d{2})[/-](\d{4})/i);
    if (birthDateMatch) {
      let day: string, month: string, year: string;
      if (birthDateMatch[1]) {
        [, day, month, year] = birthDateMatch;
      } else {
        [, , , , day, month, year] = birthDateMatch;
      }
      // Return as Date object (Drizzle ORM expects Date, not string)
      const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      cleanedData.birthDate = new Date(isoString);
      console.log('[ChatbotService] ✅ Data de nascimento extraída (regex):', isoString, '→', cleanedData.birthDate);
    }

    // Extract profession - specific keywords to avoid conflicting with name
    const professionMatch = cleanMsg.match(/(?:profiss[aã]o[:\s]+|trabalho como|atuo como)\s*([a-záàâãéêíóôõúç]+(?:\s+[a-záàâãéêíóôõúç]+)*)/i);
    if (professionMatch) {
      cleanedData.profession = professionMatch[1].trim();
      console.log('[ChatbotService] ✅ Profissão extraída (regex):', cleanedData.profession);
    }

    // Extract address
    const addressMatch = cleanMsg.match(/(?:endere[cç]o|moro em)[:\s]+([^,\n]+(?:,\s*[^,\n]+)*)/i);
    if (addressMatch) {
      cleanedData.address = addressMatch[1].trim();
      console.log('[ChatbotService] ✅ Endereço extraído (regex):', cleanedData.address);
    }

    // Extract marital status
    if (msgLower.includes('solteiro') || msgLower.includes('solteira')) {
      cleanedData.maritalStatus = 'solteiro';
      console.log('[ChatbotService] ✅ Estado civil extraído (regex): solteiro');
    } else if (msgLower.includes('casado') || msgLower.includes('casada')) {
      cleanedData.maritalStatus = 'casado';
      console.log('[ChatbotService] ✅ Estado civil extraído (regex): casado');
    } else if (msgLower.includes('divorciado') || msgLower.includes('divorciada')) {
      cleanedData.maritalStatus = 'divorciado';
      console.log('[ChatbotService] ✅ Estado civil extraído (regex): divorciado');
    } else if (msgLower.includes('viúvo') || msgLower.includes('viúva')) {
      cleanedData.maritalStatus = 'viúvo';
      console.log('[ChatbotService] ✅ Estado civil extraído (regex): viúvo');
    } else if (msgLower.includes('união estável')) {
      cleanedData.maritalStatus = 'união estável';
      console.log('[ChatbotService] ✅ Estado civil extraído (regex): união estável');
    }

    console.log('[ChatbotService] ✅ Fallback local concluído. Campos extraídos:', Object.keys(cleanedData).join(', '));
    return cleanedData;
  }

  /**
   * Extrai dados pessoais estruturados de uma mensagem usando GPT-4
   * @param message - Mensagem do cliente contendo dados pessoais
   * @param existingData - Dados já coletados anteriormente
   * @returns Objeto com os campos extraídos (apenas os novos ou mais completos)
   */
  async extractPersonalDataFromMessage(message: string, existingData: any = {}): Promise<any> {
    try {
      console.log('[ChatbotService] 🤖 Iniciando extração de dados pessoais com GPT-4...');
      console.log('[ChatbotService] 📝 Mensagem:', message.substring(0, 200));
      console.log('[ChatbotService] 💾 Dados existentes:', JSON.stringify(existingData));

      const systemPrompt = `Você é um assistente especializado em extrair dados pessoais de mensagens em português brasileiro.
Sua tarefa é analisar a mensagem do usuário e extrair APENAS os dados pessoais mencionados explicitamente.

CAMPOS A EXTRAIR:
- name: Nome completo (string)
- cpf: CPF (apenas números, sem pontos ou traços)
- birthDate: Data de nascimento no formato ISO (YYYY-MM-DD)
- maritalStatus: Estado civil (valores permitidos: "solteiro", "casado", "divorciado", "viúvo", "união estável")
- address: Endereço completo (string com rua, número, complemento, bairro, cidade, estado)
- cep: CEP (apenas números, sem traço)
- phone: Telefone (apenas números, incluindo DDD)
- email: Email
- profession: Profissão
- isPrincipalDriver: Se é o condutor principal (boolean: true/false)

REGRAS IMPORTANTES:
1. Extraia APENAS os dados que estão EXPLICITAMENTE mencionados na mensagem
2. Normalize os dados (CPF e CEP sem pontuação, datas no formato ISO)
3. Para data de nascimento, aceite formatos como "01/01/1990", "01-01-1990", "1 de janeiro de 1990"
4. Para estado civil, normalize para um dos valores permitidos
5. Para isPrincipalDriver, identifique frases como "eu dirijo", "sou o motorista", "eu que vou dirigir" como true
6. Se um dado não estiver na mensagem, NÃO inclua no resultado
7. Retorne APENAS um objeto JSON válido, sem texto adicional

DADOS JÁ EXISTENTES:
${JSON.stringify(existingData, null, 2)}

IMPORTANTE: Se um campo já existe nos dados existentes, só extraia novamente se a nova informação for MAIS COMPLETA ou MAIS PRECISA que a existente.

Retorne um objeto JSON com APENAS os campos extraídos da mensagem.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.1, // Baixa temperatura para respostas mais consistentes
        max_tokens: 500
      });

      const extractedText = response.choices[0]?.message?.content?.trim();
      console.log('[ChatbotService] 📤 Resposta GPT-4:', extractedText);

      if (!extractedText) {
        console.log('[ChatbotService] ⚠️ GPT-4 retornou resposta vazia');
        return {};
      }

      // Parse JSON response
      let extractedData: any = {};
      try {
        // Remove markdown code blocks if present
        const cleanedText = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        extractedData = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[ChatbotService] ❌ Erro ao fazer parse do JSON retornado pelo GPT-4:', parseError);
        console.error('[ChatbotService] 📄 Texto recebido:', extractedText);
        return {};
      }

      // Validate and clean extracted data
      const cleanedData: any = {};

      // Formatar CPF automaticamente
      if (extractedData.cpf) {
        const formatted = this.formatCPF(extractedData.cpf);
        cleanedData.cpf = formatted;
        console.log('[ChatbotService] ✅ CPF extraído e formatado:', formatted);
      }

      // Formatar CNPJ automaticamente
      if (extractedData.cnpj) {
        const formatted = this.formatCNPJ(extractedData.cnpj);
        cleanedData.cnpj = formatted;
        console.log('[ChatbotService] ✅ CNPJ extraído e formatado:', formatted);
      }

      // Formatar CEP automaticamente
      if (extractedData.cep) {
        const formatted = this.formatCEP(extractedData.cep);
        cleanedData.cep = formatted;
        console.log('[ChatbotService] ✅ CEP extraído e formatado:', formatted);
      }

      // Formatar telefone automaticamente
      if (extractedData.phone) {
        const formatted = this.formatPhone(extractedData.phone);
        cleanedData.phone = formatted;
        console.log('[ChatbotService] ✅ Telefone extraído e formatado:', formatted);
      }

      // Aceitar qualquer data sem validação e converter para Date
      if (extractedData.birthDate) {
        try {
          cleanedData.birthDate = new Date(extractedData.birthDate);
          console.log('[ChatbotService] ✅ Data de nascimento extraída:', extractedData.birthDate);
        } catch (dateError) {
          console.error('[ChatbotService] ⚠️ Erro ao converter data:', dateError);
        }
      }

      // Aceitar qualquer estado civil sem validação
      if (extractedData.maritalStatus) {
        cleanedData.maritalStatus = extractedData.maritalStatus.trim();
        console.log('[ChatbotService] ✅ Estado civil extraído:', extractedData.maritalStatus.trim());
      }

      // Copy other string fields
      if (extractedData.name && extractedData.name.trim().length > 0) {
        cleanedData.name = extractedData.name.trim();
        console.log('[ChatbotService] ✅ Nome extraído:', cleanedData.name);
      }

      if (extractedData.address && extractedData.address.trim().length > 0) {
        cleanedData.address = extractedData.address.trim();
        console.log('[ChatbotService] ✅ Endereço extraído:', cleanedData.address);
      }

      if (extractedData.email && extractedData.email.trim().length > 0) {
        cleanedData.email = extractedData.email.trim();
        console.log('[ChatbotService] ✅ Email extraído:', cleanedData.email);
      }

      if (extractedData.profession && extractedData.profession.trim().length > 0) {
        cleanedData.profession = extractedData.profession.trim();
        console.log('[ChatbotService] ✅ Profissão extraída:', cleanedData.profession);
      }

      // Boolean field
      if (typeof extractedData.isPrincipalDriver === 'boolean') {
        cleanedData.isPrincipalDriver = extractedData.isPrincipalDriver;
        console.log('[ChatbotService] ✅ Condutor principal extraído:', cleanedData.isPrincipalDriver);
      }

      console.log('[ChatbotService] ✅ Extração concluída. Campos extraídos:', Object.keys(cleanedData).join(', '));
      return cleanedData;

    } catch (error) {
      console.error('[ChatbotService] ❌ Erro ao extrair dados pessoais com GPT-4:', error);
      if (error instanceof Error) {
        console.error('[ChatbotService] ❌ Mensagem de erro:', error.message);
        
        // Check if it's a quota/billing error
        if (error.message.includes('quota') || error.message.includes('billing')) {
          console.error('[ChatbotService] ⚠️ ERRO DE QUOTA: A chave da OpenAI está sem créditos');
          console.error('[ChatbotService] 💡 Solução: Adicione créditos em https://platform.openai.com/account/billing');
        }
      }
      
      // NO FALLBACK - Return empty object when OpenAI fails
      // User requested to use ONLY OpenAI for accurate extraction
      console.log('[ChatbotService] ⚠️ Sem fallback - retornando objeto vazio');
      return {};
    }
  }

  /**
   * Valida se todos os dados pessoais obrigatórios foram coletados
   * @param leadData - Dados do lead a serem validados
   * @returns Objeto com status de completude e lista de campos faltantes
   */
  async validateRequiredPersonalData(leadData: any): Promise<{
    isComplete: boolean;
    missingFields: string[];
    missingFieldsPortuguese: string[];
  }> {
    console.log('[ChatbotService] 🔍 Validando dados obrigatórios...');
    console.log('[ChatbotService] 💾 Dados recebidos:', JSON.stringify(leadData));

    const requiredFields = [
      'name',
      'cpf',
      'phone',
      'birthDate',
      'maritalStatus',
      'address',
      'cep',
      'email',
      'profession',
      'isPrincipalDriver'
    ];

    const fieldTranslations: Record<string, string> = {
      name: 'Nome completo',
      cpf: 'CPF',
      phone: 'Telefone',
      birthDate: 'Data de nascimento',
      maritalStatus: 'Estado civil',
      address: 'Endereço completo',
      cep: 'CEP',
      email: 'Email',
      profession: 'Profissão',
      isPrincipalDriver: 'Se você é o condutor principal'
    };

    const missingFields: string[] = [];
    const missingFieldsPortuguese: string[] = [];

    for (const field of requiredFields) {
      const value = leadData[field];
      
      // Check if field is missing or empty
      if (value === null || value === undefined || value === '' || 
          (typeof value === 'string' && value.trim() === '')) {
        missingFields.push(field);
        missingFieldsPortuguese.push(fieldTranslations[field]);
        console.log(`[ChatbotService] ❌ Campo faltante: ${field} (${fieldTranslations[field]})`);
      } else {
        console.log(`[ChatbotService] ✅ Campo preenchido: ${field}`);
      }
    }

    const isComplete = missingFields.length === 0;
    
    console.log('[ChatbotService] 📊 Resultado da validação:');
    console.log(`[ChatbotService] - Completo: ${isComplete}`);
    console.log(`[ChatbotService] - Campos faltantes (${missingFields.length}):`, missingFields.join(', '));

    return {
      isComplete,
      missingFields,
      missingFieldsPortuguese
    };
  }

  /**
   * Gera uma mensagem amigável solicitando os campos faltantes
   * @param missingFields - Array com nomes dos campos em português
   * @returns Mensagem formatada para solicitar os dados
   */
  async generateMissingFieldsMessage(missingFields: string[]): Promise<string> {
    console.log('[ChatbotService] 📝 Gerando mensagem para campos faltantes:', missingFields.join(', '));

    if (missingFields.length === 0) {
      return 'Perfeito! Todos os dados já foram coletados. ✅';
    }

    let message = 'Para continuar, preciso de mais algumas informações:\n\n';

    // Add numbered list of missing fields
    missingFields.forEach((field, index) => {
      message += `${index + 1}. ${field}\n`;
    });

    message += '\n💡 Você pode responder digitando ou enviando um áudio com todas as informações de uma vez!\n\n';
    message += '📝 Exemplo: "Meu nome é João Silva, CPF 123.456.789-00, nasci em 15/03/1985..."';

    console.log('[ChatbotService] ✅ Mensagem gerada com sucesso');
    return message;
  }

  // ========== FUNÇÕES DE VALIDAÇÃO POR ESTADO DO WORKFLOW ==========

  /**
   * Retorna array de campos obrigatórios para o estado fornecido
   * @param state - Estado do chatbot (ex: 'dados_pessoais', 'dados_veiculo')
   * @returns Array de campos obrigatórios para o estado
   */
  private getRequiredFieldsForState(state: string): string[] {
    console.log(`[ChatbotService] 🔍 Buscando campos obrigatórios para estado: ${state}`);
    
    const requiredFields = this.REQUIRED_FIELDS_BY_STATE[state];
    
    if (!requiredFields || requiredFields.length === 0) {
      console.log(`[ChatbotService] ⚠️ Nenhum campo obrigatório mapeado para estado: ${state}`);
      return [];
    }
    
    console.log(`[ChatbotService] ✅ Campos obrigatórios encontrados (${requiredFields.length}):`, requiredFields.join(', '));
    return requiredFields;
  }

  /**
   * Valida se todos os dados obrigatórios para um estado foram coletados
   * @param state - Estado do chatbot a ser validado
   * @param leadData - Dados do lead a serem validados
   * @returns Objeto com status de completude e lista de campos faltantes
   */
  private async isStateDataComplete(state: string, leadData: any): Promise<{
    isComplete: boolean;
    missingFields: string[];
    missingFieldsPortuguese: string[];
  }> {
    console.log(`[ChatbotService] 🔍 Validando completude de dados para estado: ${state}`);
    console.log(`[ChatbotService] 💾 Dados recebidos:`, JSON.stringify(leadData));

    // Para estado 'dados_pessoais', usar a função específica já implementada
    if (state === 'dados_pessoais') {
      console.log(`[ChatbotService] 📋 Usando validateRequiredPersonalData para estado: ${state}`);
      return await this.validateRequiredPersonalData(leadData);
    }

    // Para outros estados, obter campos obrigatórios do mapa
    const requiredFields = this.getRequiredFieldsForState(state);

    // Se não há campos mapeados, retornar completo
    if (requiredFields.length === 0) {
      console.log(`[ChatbotService] ✅ Estado sem campos obrigatórios mapeados, considerando completo`);
      return {
        isComplete: true,
        missingFields: [],
        missingFieldsPortuguese: []
      };
    }

    // Mapeamento de campos para português (para outros estados além de dados_pessoais)
    const fieldTranslations: Record<string, string> = {
      // Dados de veículo
      placa: 'Placa do veículo',
      marca: 'Marca do veículo',
      modelo: 'Modelo do veículo',
      ano: 'Ano do veículo',
      // Adicionar mais traduções conforme necessário
    };

    const missingFields: string[] = [];
    const missingFieldsPortuguese: string[] = [];

    // Validar cada campo obrigatório
    for (const field of requiredFields) {
      const value = leadData[field];
      
      // Verificar se campo está ausente ou vazio
      if (value === null || value === undefined || value === '' || 
          (typeof value === 'string' && value.trim() === '')) {
        missingFields.push(field);
        const translatedField = fieldTranslations[field] || field;
        missingFieldsPortuguese.push(translatedField);
        console.log(`[ChatbotService] ❌ Campo faltante: ${field} (${translatedField})`);
      } else {
        console.log(`[ChatbotService] ✅ Campo preenchido: ${field}`);
      }
    }

    const isComplete = missingFields.length === 0;
    
    console.log(`[ChatbotService] 📊 Resultado da validação para estado ${state}:`);
    console.log(`[ChatbotService] - Completo: ${isComplete}`);
    console.log(`[ChatbotService] - Campos faltantes (${missingFields.length}):`, missingFields.join(', '));

    return {
      isComplete,
      missingFields,
      missingFieldsPortuguese
    };
  }
}