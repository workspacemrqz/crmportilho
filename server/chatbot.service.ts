// Chatbot Service with state machine and message templates
import { db } from './db';
import { 
  leads, 
  conversations, 
  messages, 
  chatbotStates,
  vehicles,
  quotes,
  flowConfigs,
  flowSteps,
  type Lead,
  type Conversation,
  type ChatbotState,
  type InsertLead,
  type InsertConversation,
  type InsertChatbotState,
  type InsertVehicle,
  type InsertQuote,
  type FlowConfig,
  type FlowStep
} from '@shared/schema';
import { WAHAService } from './waha.service';
import { LocalStorageService } from './storage.service';
import { eq, and, desc, asc, ne } from 'drizzle-orm';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { 
  broadcastNewMessage, 
  broadcastConversationUpdate 
} from './websocket';

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
  instanceName: string; // Store instance name for processing
  messages: Array<{
    content: string;
    timestamp: number;
    messageData: any;
  }>;
  timer: NodeJS.Timeout | null;
  startTime: number;
  timeoutMs: number; // Store timeout to preserve it during buffer lifetime
}

export class ChatbotService {
  private wahaAPI: WAHAService;
  private localStorage: LocalStorageService;
  private messageTemplatesCache: Map<string, string> = new Map();
  private cacheExpiry: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes cache
  private messageBuffers: Map<string, MessageBuffer> = new Map();
  private bufferTimeoutMs: number = 30000; // Cache do valor (default 30s)
  private settingsCacheTime: number = 0;
  private SETTINGS_CACHE_TTL = 60000; // 1 minuto
  private customBufferTimeouts: Map<string, number> = new Map(); // Buffer customizado por telefone
  private permanentHandoffConversations: Set<string> = new Set(); // Guard em memória para handoff permanente

  // Required fields by chatbot state for validation
  private readonly REQUIRED_FIELDS_BY_STATE: Record<string, string[]> = {
    'dados_pessoais': ['name', 'cpf', 'phone', 'birthDate', 'maritalStatus', 'address', 'cep', 'email', 'profession', 'isPrincipalDriver'],
    'dados_veiculo': ['placa', 'marca', 'modelo', 'ano'],
  };

  constructor() {
    this.wahaAPI = new WAHAService();
    this.localStorage = new LocalStorageService();
    // Carregar configurações iniciais
    void this.loadSettings();
  }

  public markPermanentHandoff(conversationId: string, phone: string): void {
    console.log(`[ChatbotService] 🚨 Marcando handoff permanente em memória para conversation ${conversationId}`);
    this.permanentHandoffConversations.add(conversationId);
    
    const buffer = this.messageBuffers.get(phone);
    if (buffer) {
      console.log(`[ChatbotService] 🗑️ Limpando buffer de mensagens para ${phone} devido ao handoff`);
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      this.messageBuffers.delete(phone);
    }
  }

  public isPermanentHandoffActive(conversationId: string): boolean {
    return this.permanentHandoffConversations.has(conversationId);
  }
  
  // Method with both conversationId and phone (for routes.ts compatibility)
  public isPermanentHandoff(conversationId: string, phone?: string): boolean {
    return this.permanentHandoffConversations.has(conversationId);
  }

  public clearPermanentHandoff(conversationId: string): void {
    console.log(`[ChatbotService] ♻️ Removendo handoff permanente da memória para conversation ${conversationId}`);
    this.permanentHandoffConversations.delete(conversationId);
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

  /**
   * Extract first name from lead's name
   * Example: "Gabriel Marquez" -> "Gabriel"
   */
  private extractFirstName(lead: Lead): string {
    // Tentar pegar o nome completo de várias fontes possíveis
    const fullName = lead.name || lead.whatsappName || '';
    
    if (!fullName || fullName.trim() === '') {
      return '';
    }
    
    // Pegar apenas o primeiro nome (primeira palavra)
    const firstName = fullName.trim().split(/\s+/)[0];
    return firstName;
  }

  /**
   * Replace placeholders in text with lead information
   * Currently supports: {nome}, [DD/MM/AAAA], [NÚMERO_DO_PROTOCOLO]
   */
  private async replacePlaceholders(text: string, lead: Lead): Promise<string> {
    let result = text;
    
    // Replace {nome} with first name
    const firstName = this.extractFirstName(lead);
    if (firstName) {
      result = result.replace(/\{nome\}/gi, firstName);
    }
    
    // Replace [DD/MM/AAAA] with current date in São Paulo timezone
    const saoPauloDate = new Date().toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    result = result.replace(/\[DD\/MM\/AAAA\]/gi, saoPauloDate);
    
    // Replace [NÚMERO_DO_PROTOCOLO] with lead's protocol number
    // If lead doesn't have a protocol, generate one
    let protocol = lead.protocol;
    if (!protocol) {
      // Generate a new protocol number
      const { storage } = await import('./storage');
      const year = new Date().getFullYear();
      const allLeads = await storage.getLeads({});
      const currentYearLeads = allLeads.filter(l => 
        l.protocol && l.protocol.startsWith(`${year}-`)
      );
      
      let nextNumber = 1;
      if (currentYearLeads.length > 0) {
        const protocolNumbers = currentYearLeads
          .map(l => {
            const match = l.protocol.match(/^\d{4}-(\d{3})$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(num => num > 0);
        
        if (protocolNumbers.length > 0) {
          nextNumber = Math.max(...protocolNumbers) + 1;
        }
      }
      
      protocol = `${year}-${String(nextNumber).padStart(3, '0')}`;
      
      // Update the lead with the new protocol
      await storage.updateLead(lead.id, { protocol });
    }
    result = result.replace(/\[NÚMERO_DO_PROTOCOLO\]/gi, protocol);
    
    return result;
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
      console.error('[ChatbotService] Error loading settings, using default 10s:', error);
      this.bufferTimeoutMs = 10000;
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

  // Set custom buffer timeout for a specific phone number (one-time use)
  private setCustomBufferTimeout(phone: string, timeoutMs: number) {
    this.customBufferTimeouts.set(phone, timeoutMs);
    console.log(`[ChatbotService] 🕐 Buffer customizado definido para ${phone}: ${timeoutMs/1000}s`);
  }

  // Get buffer timeout for a specific phone (checks custom first, then step-specific, then initial step, then default)
  private async getBufferTimeoutForPhone(phone: string): Promise<number> {
    // Check if there's a custom timeout for this phone
    const customTimeout = this.customBufferTimeouts.get(phone);
    if (customTimeout !== undefined) {
      console.log(`[ChatbotService] 🕐 Usando buffer customizado para ${phone}: ${customTimeout/1000}s`);
      // Remove custom timeout after retrieving (one-time use)
      this.customBufferTimeouts.delete(phone);
      return customTimeout;
    }
    
    // Try to get buffer from current flow step
    try {
      const { storage } = await import('./storage');
      const lead = await storage.getLeadByPhone(phone);
      
      // Get active flow configuration (needed for fallback to initial step)
      const flowConfig = await this.getActiveFlow();
      if (flowConfig) {
        const steps = await this.getFlowSteps(flowConfig.id);
        if (steps.length > 0) {
          // First, try to identify current step if chatbot state exists
          if (lead) {
            const conversation = await storage.getActiveConversation(lead.id);
            if (conversation) {
              const chatbotState = await storage.getChatbotState(conversation.id);
              if (chatbotState) {
                // CRITICAL: If chatbot state exists, find the current step and use its buffer
                // Do NOT fall back to initial step - that would ignore the configured buffer
                const currentStep = steps.find(s => s.stepId === chatbotState.currentState);
                
                if (currentStep) {
                  // Type assertion to access buffer field (Drizzle infers all fields)
                  const buffer = (currentStep as any).buffer;
                  
                  // Validate buffer value using isFinite (clamp between 0 and 300 seconds)
                  let bufferSeconds = Number(buffer);
                  
                  if (!isFinite(bufferSeconds) || bufferSeconds < 0) {
                    console.warn(`[ChatbotService] ⚠️ Buffer inválido no step "${currentStep.stepName}" (${buffer}), usando mínimo de 0s`);
                    bufferSeconds = 0;
                  } else if (bufferSeconds > 300) {
                    console.warn(`[ChatbotService] ⚠️ Buffer muito alto no step "${currentStep.stepName}" (${bufferSeconds}s), limitando a 300s`);
                    bufferSeconds = 300;
                  }
                  
                  console.log(`[ChatbotService] 🕐 ✅ USANDO BUFFER DO STEP ATUAL "${currentStep.stepName}": ${bufferSeconds}s (valor original: ${buffer})${bufferSeconds === 0 ? ' - ENVIO INSTANTÂNEO' : ''}`);
                  return bufferSeconds * 1000;
                } else {
                  console.warn(`[ChatbotService] ⚠️ Current step "${chatbotState.currentState}" não encontrado nos steps disponíveis`);
                }
              }
            }
          }
          
          // Fallback: Use initial step (lowest order) ONLY for completely new leads (no chatbot state)
          // This ensures buffer=0 works for first contact without requiring chatbot state
          const initialStep = steps.reduce((min, step) => 
            step.order < min.order ? step : min
          , steps[0]);
          
          const buffer = (initialStep as any).buffer;
          let bufferSeconds = Number(buffer);
          
          if (!isFinite(bufferSeconds) || bufferSeconds < 0) {
            console.warn(`[ChatbotService] ⚠️ Buffer inválido no step inicial "${initialStep.stepName}" (${buffer}), usando mínimo de 0s`);
            bufferSeconds = 0;
          } else if (bufferSeconds > 300) {
            console.warn(`[ChatbotService] ⚠️ Buffer muito alto no step inicial "${initialStep.stepName}" (${bufferSeconds}s), limitando a 300s`);
            bufferSeconds = 300;
          }
          
          console.log(`[ChatbotService] 🕐 Usando buffer do step inicial "${initialStep.stepName}" (NOVO LEAD sem estado): ${bufferSeconds}s (valor original: ${buffer})${bufferSeconds === 0 ? ' - ENVIO INSTANTÂNEO' : ''}`);
          return bufferSeconds * 1000;
        }
      }
    } catch (error) {
      console.log(`[ChatbotService] Erro ao determinar buffer do step, usando padrão global:`, error);
    }
    
    // Last resort: use default configured timeout
    const globalTimeout = await this.getBufferTimeout();
    console.log(`[ChatbotService] ⚠️ Usando buffer global (fallback): ${globalTimeout/1000}s`);
    return globalTimeout;
  }

  /**
   * Get buffer timeout using an already loaded chatbot state
   * This avoids race conditions and ensures we use the correct step's buffer
   */
  private async getBufferTimeoutWithState(
    phone: string,
    chatbotState: ChatbotState | null
  ): Promise<number> {
    // Check if there's a custom timeout for this phone
    const customTimeout = this.customBufferTimeouts.get(phone);
    if (customTimeout !== undefined) {
      console.log(`[ChatbotService] 🕐 Usando buffer customizado para ${phone}: ${customTimeout/1000}s`);
      // Remove custom timeout after retrieving (one-time use)
      this.customBufferTimeouts.delete(phone);
      return customTimeout;
    }
    
    // If we have a chatbot state, use its current step's buffer
    if (chatbotState && chatbotState.currentState) {
      try {
        const flowConfig = await this.getActiveFlow();
        if (flowConfig) {
          const steps = await this.getFlowSteps(flowConfig.id);
          const currentStep = steps.find(s => s.stepId === chatbotState.currentState);
          
          if (currentStep) {
            const buffer = (currentStep as any).buffer;
            let bufferSeconds = Number(buffer);
            
            if (!isFinite(bufferSeconds) || bufferSeconds < 0) {
              console.warn(`[ChatbotService] ⚠️ Buffer inválido no step "${currentStep.stepName}" (${buffer}), usando mínimo de 0s`);
              bufferSeconds = 0;
            } else if (bufferSeconds > 300) {
              console.warn(`[ChatbotService] ⚠️ Buffer muito alto no step "${currentStep.stepName}" (${bufferSeconds}s), limitando a 300s`);
              bufferSeconds = 300;
            }
            
            console.log(`[ChatbotService] 🕐 ✅ BUFFER CORRETO DO STEP ATUAL "${currentStep.stepName}": ${bufferSeconds}s${bufferSeconds === 0 ? ' - ENVIO INSTANTÂNEO' : ''}`);
            return bufferSeconds * 1000;
          }
        }
      } catch (error) {
        console.error(`[ChatbotService] Erro ao obter buffer do step atual:`, error);
      }
    }
    
    // Fallback to initial step for new leads
    try {
      const flowConfig = await this.getActiveFlow();
      if (flowConfig) {
        const steps = await this.getFlowSteps(flowConfig.id);
        if (steps.length > 0) {
          const initialStep = steps.reduce((min, step) => 
            step.order < min.order ? step : min
          , steps[0]);
          
          const buffer = (initialStep as any).buffer;
          let bufferSeconds = Number(buffer);
          
          if (!isFinite(bufferSeconds) || bufferSeconds < 0) {
            bufferSeconds = 0;
          } else if (bufferSeconds > 300) {
            bufferSeconds = 300;
          }
          
          console.log(`[ChatbotService] 🕐 Usando buffer do step inicial "${initialStep.stepName}" (NOVO LEAD): ${bufferSeconds}s${bufferSeconds === 0 ? ' - ENVIO INSTANTÂNEO' : ''}`);
          return bufferSeconds * 1000;
        }
      }
    } catch (error) {
      console.log(`[ChatbotService] Erro ao determinar buffer do step inicial:`, error);
    }
    
    // Last resort: use default configured timeout
    const globalTimeout = await this.getBufferTimeout();
    console.log(`[ChatbotService] ⚠️ Usando buffer global (fallback): ${globalTimeout/1000}s`);
    return globalTimeout;
  }

  /**
   * Public method to get buffer debug information for testing
   * Returns detailed information about buffer configuration for a phone number
   */
  public async getBufferDebugInfo(phone: string): Promise<{
    phone: string;
    currentStepId: string | null;
    currentStepName: string | null;
    bufferSeconds: number;
    bufferMs: number;
    bufferSource: 'step' | 'global' | 'custom';
    allSteps: Array<{
      stepId: string;
      stepName: string;
      order: number;
      buffer: number;
    }>;
    leadId: string | null;
    conversationId: string | null;
    chatbotStateId: string | null;
  }> {
    try {
      const { storage } = await import('./storage');
      
      // Clean phone number
      const cleanPhone = phone.replace(/\D/g, '');
      
      // Check for custom timeout first
      const customTimeout = this.customBufferTimeouts.get(cleanPhone);
      if (customTimeout !== undefined) {
        return {
          phone: cleanPhone,
          currentStepId: null,
          currentStepName: null,
          bufferSeconds: customTimeout / 1000,
          bufferMs: customTimeout,
          bufferSource: 'custom',
          allSteps: [],
          leadId: null,
          conversationId: null,
          chatbotStateId: null
        };
      }
      
      // Find or create lead
      let lead = await storage.getLeadByPhone(cleanPhone);
      if (!lead) {
        // Create a temporary lead for testing
        lead = await storage.createLead({
          whatsappPhone: cleanPhone,
          phone: cleanPhone,
          protocol: `TEST-${Date.now()}`
        });
      }
      
      // Find or create conversation
      let conversation = await storage.getActiveConversation(lead.id);
      if (!conversation) {
        conversation = await storage.createConversation({
          leadId: lead.id,
          protocol: lead.protocol,
          instanceName: 'default',
          status: 'active',
          currentMenu: 'initial',
          currentStep: 'welcome'
        });
      }
      
      // Get or create chatbot state
      let chatbotState = await storage.getChatbotState(conversation.id);
      if (!chatbotState) {
        chatbotState = await storage.createChatbotState({
          conversationId: conversation.id,
          currentState: 'welcome',
          context: {},
          collectedData: {},
          menuSelections: {}
        });
      }
      
      // Try to get active flow and current step
      const flowConfig = await this.getActiveFlow();
      if (flowConfig) {
        const steps = await this.getFlowSteps(flowConfig.id);
        if (steps.length > 0) {
          const currentStep = await this.identifyCurrentStep(chatbotState, steps);
          
          if (currentStep) {
            const buffer = (currentStep as any).buffer;
            let bufferSeconds = Number(buffer);
            
            // Validate and clamp buffer value (allow 0 for instant sending)
            if (!isFinite(bufferSeconds) || bufferSeconds < 0) {
              bufferSeconds = 0;
            } else if (bufferSeconds > 300) {
              bufferSeconds = 300;
            }
            
            return {
              phone: cleanPhone,
              currentStepId: currentStep.stepId,
              currentStepName: currentStep.stepName,
              bufferSeconds,
              bufferMs: bufferSeconds * 1000,
              bufferSource: 'step',
              allSteps: steps.map(s => {
                const raw = (s as any).buffer;
                const parsed = Number(raw);
                const buffer = Number.isFinite(parsed) && parsed >= 0 ? parsed : 30;
                return {
                  stepId: s.stepId,
                  stepName: s.stepName,
                  order: s.order,
                  buffer
                };
              }),
              leadId: lead.id,
              conversationId: conversation.id,
              chatbotStateId: chatbotState.id
            };
          }
        }
      }
      
      // Fallback to global buffer
      const globalBufferMs = await this.getBufferTimeout();
      return {
        phone: cleanPhone,
        currentStepId: chatbotState.currentState,
        currentStepName: null,
        bufferSeconds: globalBufferMs / 1000,
        bufferMs: globalBufferMs,
        bufferSource: 'global',
        allSteps: [],
        leadId: lead.id,
        conversationId: conversation.id,
        chatbotStateId: chatbotState.id
      };
      
    } catch (error) {
      console.error('[ChatbotService] Error getting buffer debug info:', error);
      throw error;
    }
  }

  async processIncomingMessage(phone: string, messageContent: string, messageData: any, instanceName: string) {
    try {
      console.log(`[ChatbotService] processIncomingMessage called with phone: ${phone}, instance: ${instanceName}`);
      
      // Validate phone is not null/empty
      if (!phone || phone.trim() === '') {
        throw new Error('Phone number is required but was null or empty');
      }
      
      // Validate instanceName is not null/empty
      if (!instanceName || instanceName.trim() === '') {
        throw new Error('Instance name is required but was null or empty');
      }
      
      // CRITICAL FIX: Get/create lead, conversation, and chatbot state FIRST
      // This ensures we have the current state before determining buffer timeout
      const contactInfo = {
        name: messageData?.name,
        pushName: messageData?.pushName
      };
      
      // Find or create lead
      const lead = await this.findOrCreateLead(phone, contactInfo);
      
      // Find or create conversation
      const conversation = await this.findOrCreateConversation(lead.id, lead.protocol, instanceName);
      
      // Get or create chatbot state - this tells us the current flow step
      const chatbotState = await this.getOrCreateChatbotState(conversation.id);
      
      // NOW determine buffer timeout using the actual current state
      // This ensures we use the correct step's buffer, not the initial step
      const timeout = await this.getBufferTimeoutWithState(phone, chatbotState);
      
      // Check if buffer exists
      let buffer = this.messageBuffers.get(phone);
      
      if (!buffer) {
        // Create new buffer with correct timeout
        console.log(`[ChatbotService] 🔄 Creating NEW buffer with ${timeout/1000}s timeout for ${phone}${timeout === 0 ? ' (ENVIO INSTANTÂNEO)' : ''}`);
        buffer = {
          phone,
          instanceName,
          messages: [],
          timer: null,
          startTime: Date.now(),
          timeoutMs: timeout
        };
        this.messageBuffers.set(phone, buffer);
        
        // Start timer with configured timeout
        buffer.timer = setTimeout(() => {
          void this.flushBuffer(phone, instanceName).catch(err => {
            console.error(`[ChatbotService] Error flushing buffer for ${phone}:`, err);
            this.messageBuffers.delete(phone);
          });
        }, timeout);
      } else {
        // Buffer exists - reset timer if timeout changed
        // This can happen when transitioning between steps with different buffers
        if (buffer.timeoutMs !== timeout) {
          console.log(`[ChatbotService] ⚠️ Buffer timeout changed from ${buffer.timeoutMs/1000}s to ${timeout/1000}s - recreating buffer`);
          
          // Clear existing timer
          if (buffer.timer) {
            clearTimeout(buffer.timer);
          }
          
          // Create new buffer with updated timeout but keep existing messages
          const existingMessages = buffer.messages;
          buffer = {
            phone,
            instanceName,
            messages: existingMessages,
            timer: null,
            startTime: Date.now(),
            timeoutMs: timeout
          };
          this.messageBuffers.set(phone, buffer);
          
          // Start new timer
          buffer.timer = setTimeout(() => {
            void this.flushBuffer(phone, instanceName).catch(err => {
              console.error(`[ChatbotService] Error flushing buffer for ${phone}:`, err);
              this.messageBuffers.delete(phone);
            });
          }, timeout);
        }
      }
      
      // Add message to buffer
      buffer.messages.push({
        content: messageContent,
        timestamp: Date.now(),
        messageData
      });
      
      // Use the stored timeout from buffer (preserves the original timeout even during state transitions)
      const timeRemaining = buffer.timeoutMs - (Date.now() - buffer.startTime);
      console.log(`[ChatbotService] 📨 Message buffered (${buffer.messages.length} total). Timer ends in ${timeRemaining}ms${buffer.timeoutMs === 0 ? ' (ENVIO INSTANTÂNEO)' : ''}`);

    } catch (error) {
      console.error('Error processing incoming message:', error);
      throw error;
    }
  }

  private async flushBuffer(phone: string, instanceName: string) {
    const buffer = this.messageBuffers.get(phone);
    if (!buffer || buffer.messages.length === 0) {
      console.log(`[ChatbotService] No messages to flush for ${phone}`);
      return;
    }
    
    console.log(`[ChatbotService] ========== INÍCIO DO PROCESSAMENTO DE BUFFER ==========`);
    console.log(`[ChatbotService] 📱 Telefone: ${phone}`);
    console.log(`[ChatbotService] 📱 Instância: ${instanceName}`);
    console.log(`[ChatbotService] 📨 Mensagens coletadas: ${buffer.messages.length}`);
    console.log(`[ChatbotService] ⏱️ Tempo de buffer: ${Date.now() - buffer.startTime}ms`);
    
    try {
      // Limpar timer
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      
      // Remover buffer do Map (reset para próximo ciclo)
      this.messageBuffers.delete(phone);
      
      // Concatenar todas as mensagens sem prefixo
      const allMessages = buffer.messages
        .map(msg => msg.content)
        .join('\n');
      
      console.log(`[ChatbotService] 📝 Conteúdo combinado das mensagens (${buffer.messages.length} mensagens):\n${allMessages}`);
      
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
      let conversation = await this.findOrCreateConversation(lead.id, lead.protocol, instanceName);
      
      // Get or create chatbot state FIRST to check handoff status
      let chatbotState = await this.getOrCreateChatbotState(conversation.id);
      
      // CRITICAL: Check BOTH in-memory guard AND database before any processing
      // This prevents race conditions and ensures handoff is respected
      const hasInMemoryHandoff = this.isPermanentHandoffActive(conversation.id);
      const hasDatabaseHandoff = chatbotState.isPermanentHandoff;
      
      if (hasInMemoryHandoff || hasDatabaseHandoff) {
        console.log(`[ChatbotService] 🛑 HANDOFF PERMANENTE DETECTADO para conversation ${conversation.id}`);
        console.log(`[ChatbotService]   - Guard em memória: ${hasInMemoryHandoff ? 'SIM ✓' : 'NÃO'}`);
        console.log(`[ChatbotService]   - Guard no banco: ${hasDatabaseHandoff ? 'SIM ✓' : 'NÃO'}`);
        console.log(`[ChatbotService] 📝 Salvando mensagem do cliente apenas para histórico (BOT NÃO RESPONDERÁ)`);
        
        // Sincronizar estado em memória com banco de dados se necessário
        if (hasDatabaseHandoff && !hasInMemoryHandoff) {
          console.log(`[ChatbotService] 🔄 Sincronizando handoff do banco para memória`);
          this.permanentHandoffConversations.add(conversation.id);
        }
        
        // Store all incoming messages for history ONLY
        for (const msg of buffer.messages) {
          const messageType = msg.messageData?.type || 'text';
          
          const [savedMessage] = await db.insert(messages).values({
            conversationId: conversation.id,
            content: msg.content,
            isBot: false,
            messageType,
            metadata: msg.messageData
          }).returning();
          
          // Broadcast incoming customer message
          try {
            broadcastNewMessage(conversation.id, savedMessage);
            console.log(`[ChatbotService] 📡 Mensagem do cliente salva e transmitida (handoff ativo)`);
          } catch (broadcastError) {
            console.error('[ChatbotService] ❌ Broadcast failed (non-fatal):', broadcastError);
          }
        }
        
        console.log(`[ChatbotService] ✅ Mensagens salvas. Bot NÃO processará devido ao handoff permanente.`);
        console.log(`[ChatbotService] ========== FIM DO PROCESSAMENTO (HANDOFF ATIVO) ==========`);
        return; // STOP HERE - Do not process state machine or send bot responses
      }
      
      // No handoff detected - proceed with normal bot processing
      console.log(`[ChatbotService] ✅ Nenhum handoff detectado. Processamento normal do bot iniciado.`);
      
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
        
        const [savedMessage] = await db.insert(messages).values({
          conversationId: conversation.id,
          content: msg.content,
          isBot: false,
          messageType,
          metadata: enrichedMetadata
        }).returning();
        
        // Broadcast incoming customer message
        try {
          broadcastNewMessage(conversation.id, savedMessage);
          console.log(`[ChatbotService] 📡 Broadcast: customer message sent for conversation ${conversation.id}`);
        } catch (broadcastError) {
          console.error('[ChatbotService] ❌ Broadcast failed (non-fatal):', broadcastError);
        }
      }

      console.log(`[ChatbotService] 🔑 FlushBuffer - conversationId: ${conversation.id} | protocol: ${lead.protocol}`);
      
      // chatbotState already loaded above for handoff check
      // Check for human handoff request (check all messages)
      const hasHandoffRequest = buffer.messages.some(msg => this.isHumanHandoffRequest(msg.content));
      if (hasHandoffRequest) {
        await this.handleHumanHandoff(lead, conversation, 'Cliente solicitou atendimento humano', instanceName);
        return;
      }

      // Process message based on current state with combined message content
      console.log(`[ChatbotService] 🔄 Processando mensagens com estado: ${chatbotState.currentState}`);
      console.log(`[ChatbotService] 📊 Dados coletados antes do processamento:`, JSON.stringify(chatbotState.collectedData));
      
      // Try to use configurable flow first, fallback to state machine if no active flow
      await this.processWithConfigurableFlow(lead, conversation, chatbotState, allMessages, instanceName);
      
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
          instanceName,
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
      const mimetype = messageData?.mimetype || messageData?._data?.mimetype || messageData?.media?.mimetype;
      // WAHA webhook provides media.url field for downloaded files
      const mediaUrl = messageData?.media?.url || messageData?._data?.mediaUrl || messageData?.mediaUrl;
      const size = messageData?.size || messageData?._data?.size || messageData?.media?.fileSize;
      
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
      
      // Upload to Local Storage for permanent caching
      let storagePath: string | null = null;
      try {
        const storageFilePath = `${leadId}/whatsapp/${messageId}`;
        console.log('[ChatbotService] ☁️ Uploading to Local Storage:', storageFilePath);
        
        storagePath = await this.localStorage.uploadDocument(
          mediaBuffer,
          filename,
          leadId,
          mimetype || 'application/octet-stream'
        );
        
        console.log('[ChatbotService] ✅ Successfully cached in Local Storage:', storagePath);
      } catch (storageError) {
        console.error('[ChatbotService] ⚠️ Failed to upload to Local Storage (non-fatal):', storageError);
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
      
      console.log('[ChatbotService] ✅ Media processed successfully, type:', docType);
      
      // Return enriched metadata
      return {
        filename: uniqueFilename,
        originalFilename: filename,
        mimetype,
        size: size || mediaBuffer.length,
        mediaUrl,
        messageId,
        savedPath: filePath,
        documentType: docType,
        storagePath: storagePath || undefined
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

  private async findOrCreateConversation(leadId: string, protocol: string, instanceName: string = 'default'): Promise<Conversation> {
    console.log(`[ChatbotService] 🔎 findOrCreateConversation - leadId: ${leadId} | protocol: ${protocol} | instanceName: ${instanceName}`);
    
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
    console.log(`[ChatbotService] ⚠️ CRIANDO NOVA CONVERSA para lead: ${leadId} | protocol: ${protocol} | instanceName: ${instanceName}`);
    console.log(`[ChatbotService] ⚠️ Stack trace de onde foi chamado:`, new Error().stack);
    
    const [newConversation] = await db.insert(conversations).values({
      leadId,
      protocol,
      instanceName,
      status: 'active',
      currentMenu: 'initial',
      currentStep: 'welcome'
    }).returning();

    console.log(`[ChatbotService] ✨ Nova conversa criada - ID: ${newConversation.id}`);
    
    // Broadcast new conversation
    try {
      // Import broadcastNewConversation dynamically to avoid circular dependency
      const { broadcastNewConversation } = await import('./websocket');
      broadcastNewConversation(newConversation);
      console.log(`[ChatbotService] 📡 Broadcast: new conversation sent for ${newConversation.id}`);
    } catch (broadcastError) {
      console.error('[ChatbotService] ❌ Broadcast failed (non-fatal):', broadcastError);
    }
    
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
      
      // Sync in-memory handoff guard with DB state (important after server restart)
      if (existingState.isPermanentHandoff && !this.isPermanentHandoffActive(conversationId)) {
        console.log(`[ChatbotService] 🔄 Sincronizando guard em memória: isPermanentHandoff=true no DB para conversation ${conversationId}`);
        this.permanentHandoffConversations.add(conversationId);
      }
      
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

  // ============================================================================
  // CONFIGURABLE FLOW PROCESSING METHODS
  // ============================================================================
  
  /**
   * Process incoming message using the configurable visual flow from /fluxo page
   * This replaces the hardcoded state machine when a flow config is active
   */
  private async processWithConfigurableFlow(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    messageContent: string,
    instanceName: string
  ): Promise<void> {
    try {
      console.log(`[ChatbotService] 🎯 Processing with configurable flow for lead ${lead.protocol}`);
      
      // Get active flow configuration
      const flowConfig = await this.getActiveFlow();
      if (!flowConfig) {
        console.log(`[ChatbotService] ⚠️ No active flow found, falling back to state machine`);
        return await this.processStateMachine(lead, conversation, chatbotState, messageContent, instanceName);
      }
      
      // Get all flow steps
      const steps = await this.getFlowSteps(flowConfig.id);
      if (!steps || steps.length === 0) {
        console.log(`[ChatbotService] ⚠️ No steps found in flow, cannot process`);
        return await this.processStateMachine(lead, conversation, chatbotState, messageContent, instanceName);
      }
      
      console.log(`[ChatbotService] 📋 Flow "${flowConfig.id}" loaded with ${steps.length} steps`);
      
      // Process steps in a loop to handle automatic transitions
      // Limit iterations to prevent infinite loops
      const MAX_AUTO_TRANSITIONS = 10;
      let iteration = 0;
      let shouldContinue = true;
      
      while (shouldContinue && iteration < MAX_AUTO_TRANSITIONS) {
        iteration++;
        
        // Refresh chatbot state from database to get latest state
        const freshState = await db.query.chatbotStates.findFirst({
          where: eq(chatbotStates.id, chatbotState.id)
        });
        
        if (!freshState) {
          console.error(`[ChatbotService] ❌ Could not find chatbot state ${chatbotState.id}`);
          break;
        }
        
        // Identify current step
        const currentStep = await this.identifyCurrentStep(freshState, steps);
        if (!currentStep) {
          console.log(`[ChatbotService] ⚠️ Could not identify current step, starting from first step`);
          const firstStep = steps.find(s => s.order === 0) || steps[0];
          await this.updateChatbotState(chatbotState.id, {
            currentState: firstStep.stepId
          });
          continue;
        }
        
        console.log(`[ChatbotService] 📍 Iteration ${iteration}: Current step: ${currentStep.stepName} (${currentStep.stepId})`);
        
        // Track state before processing
        const stateBefore = freshState.currentState;
        
        // Process the current step and get continuation signal
        const shouldContinueLoop = await this.processFlowStep(lead, conversation, freshState, currentStep, steps, flowConfig, messageContent, instanceName);
        
        // Check if we should continue based on step processing result
        if (!shouldContinueLoop) {
          // Step processing determined we should stop (FIXED→AI, no transitions, or waiting for user)
          shouldContinue = false;
          console.log(`[ChatbotService] ✅ Processing complete - step signaled to stop loop`);
          
          // Update the in-memory chatbotState reference for the caller
          const stateAfter = await db.query.chatbotStates.findFirst({
            where: eq(chatbotStates.id, chatbotState.id)
          });
          if (stateAfter) {
            Object.assign(chatbotState, stateAfter);
          }
        } else {
          // Step processing wants loop to continue (AI→FIXED, AI→AI, FIXED→FIXED)
          const stateAfter = await db.query.chatbotStates.findFirst({
            where: eq(chatbotStates.id, chatbotState.id)
          });
          
          if (!stateAfter) {
            console.error(`[ChatbotService] ❌ Could not find updated chatbot state`);
            shouldContinue = false;
          } else if (stateAfter.currentState === stateBefore) {
            // State didn't change - something went wrong, stop processing
            console.warn(`[ChatbotService] ⚠️ State didn't change but step wanted to continue - stopping`);
            shouldContinue = false;
          } else {
            // Automatic transition occurred - continue loop
            console.log(`[ChatbotService] 🔄 Automatic transition detected: ${stateBefore} → ${stateAfter.currentState}`);
            console.log(`[ChatbotService] 📝 Keeping original message for all auto-transitions`);
            
            // NOTE: We keep the original messageContent for all auto-transitions
            // - AI steps need it to understand context
            // - FIXED steps ignore it anyway (they just send their fixed messages)
            
            // Update the in-memory chatbotState reference for the caller
            Object.assign(chatbotState, stateAfter);
            shouldContinue = true;
          }
        }
      }
      
      if (iteration >= MAX_AUTO_TRANSITIONS) {
        console.warn(`[ChatbotService] ⚠️ Reached max auto-transitions limit (${MAX_AUTO_TRANSITIONS})`);
      }
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Error processing with configurable flow:', error);
      console.log('[ChatbotService] Falling back to state machine');
      return await this.processStateMachine(lead, conversation, chatbotState, messageContent, instanceName);
    }
  }
  
  /**
   * Get active flow configuration from database
   */
  private async getActiveFlow(): Promise<FlowConfig | null> {
    try {
      const [config] = await db.select()
        .from(flowConfigs)
        .where(eq(flowConfigs.isActive, true))
        .orderBy(desc(flowConfigs.createdAt))
        .limit(1);
      return config || null;
    } catch (error) {
      console.error('[ChatbotService] Error fetching active flow:', error);
      return null;
    }
  }
  
  /**
   * Get all steps for a flow configuration
   */
  private async getFlowSteps(flowConfigId: string): Promise<FlowStep[]> {
    try {
      const steps = await db.select()
        .from(flowSteps)
        .where(eq(flowSteps.flowConfigId, flowConfigId))
        .orderBy(asc(flowSteps.order));
      
      // Debug: log detailed step information to verify all fields are being loaded
      if (steps.length > 0) {
        console.log(`[ChatbotService] 📋 Loaded ${steps.length} steps from database:`);
        steps.forEach(s => {
          const transitions = (s.transitions as any) || [];
          console.log(`[ChatbotService]   - Step "${s.stepName}" (${s.stepId}):`, {
            stepType: s.stepType,
            buffer: s.buffer,
            transitions: transitions.length,
            order: s.order
          });
        });
      }
      
      return steps;
    } catch (error) {
      console.error('[ChatbotService] Error fetching flow steps:', error);
      return [];
    }
  }
  
  /**
   * Identify which step the lead is currently in
   */
  private async identifyCurrentStep(
    chatbotState: ChatbotState,
    steps: FlowStep[]
  ): Promise<FlowStep | null> {
    // Check if currentState matches a stepId
    const currentStepId = chatbotState.currentState;
    if (currentStepId) {
      const step = steps.find(s => s.stepId === currentStepId);
      if (step) {
        return step;
      }
    }
    
    // If no match, start from first step
    return steps.find(s => s.order === 0) || steps[0] || null;
  }
  
  /**
   * Update lead status and priority if configured in the current step
   */
  private async updateLeadStatusAndPriority(lead: Lead, currentStep: FlowStep): Promise<void> {
    try {
      const updates: any = {};
      
      // Check if this step should change the lead's status
      if (currentStep.changeStatusTo) {
        updates.status = currentStep.changeStatusTo;
        console.log(`[ChatbotService] 🏷️ Changing lead status to: ${currentStep.changeStatusTo}`);
      }
      
      // Check if this step should change the lead's priority
      if (currentStep.changePriorityTo) {
        updates.priority = currentStep.changePriorityTo;
        console.log(`[ChatbotService] ⚡ Changing lead priority to: ${currentStep.changePriorityTo}`);
      }
      
      // Only update if there are changes
      if (Object.keys(updates).length > 0) {
        await db.update(leads)
          .set(updates)
          .where(eq(leads.id, lead.id));
        
        // Update the local lead object to reflect changes for subsequent nodes in the same loop
        if (updates.status) {
          lead.status = updates.status;
        }
        if (updates.priority) {
          lead.priority = updates.priority;
        }
        
        console.log(`[ChatbotService] ✅ Updated lead ${lead.id} with:`, updates);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Error updating lead status/priority:', error);
      // Don't throw - we want the flow to continue even if the update fails
    }
  }
  
  /**
   * Process a specific flow step
   * @returns true if loop should continue, false if it should stop
   */
  private async processFlowStep(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    currentStep: FlowStep,
    allSteps: FlowStep[],
    flowConfig: FlowConfig,
    messageContent: string,
    instanceName: string
  ): Promise<boolean> {
    try {
      console.log(`[ChatbotService] 🔄 Processing step: ${currentStep.stepName} (type: ${currentStep.stepType})`);
      
      // Check if this step has already been executed for this conversation
      const context = chatbotState.context as any || {};
      const executedSteps = new Set<string>(context.executedSteps || []);
      
      if (executedSteps.has(currentStep.stepId)) {
        console.log(`[ChatbotService] ⏭️ Step "${currentStep.stepName}" already executed - skipping`);
        // Step already executed - don't process again, just wait for user input
        return false;
      }
      
      console.log(`[ChatbotService] ✨ First execution of step "${currentStep.stepName}"`);
      
      // Update lead status/priority if configured in this node
      await this.updateLeadStatusAndPriority(lead, currentStep);
      
      // Process the step (AI or FIXED)
      let shouldContinue: boolean;
      let transitioned: boolean = true; // Default to true for FIXED steps
      
      if (currentStep.stepType === 'fixed') {
        console.log(`[ChatbotService] 📌 FIXED message node detected`);
        shouldContinue = await this.processFixedMessageStep(lead, conversation, chatbotState, currentStep, allSteps, messageContent, instanceName);
        // FIXED steps always transition (they send message and move on)
        transitioned = true;
      } else {
        // AI node - returns object with shouldContinue and transitioned
        console.log(`[ChatbotService] 🤖 AI node detected - using OpenAI`);
        const aiResult = await this.processAIStep(lead, conversation, chatbotState, currentStep, allSteps, flowConfig, messageContent, instanceName);
        shouldContinue = aiResult.shouldContinue;
        transitioned = aiResult.transitioned;
      }
      
      // CRITICAL FIX: Only mark as executed if there was a transition to another step
      // If step stayed on same step (waiting for more user input), DON'T mark as executed
      if (transitioned) {
        console.log(`[ChatbotService] ✅ Step transitioned - marking "${currentStep.stepId}" as executed`);
        executedSteps.add(currentStep.stepId);
        const updatedContext = {
          ...context,
          executedSteps: Array.from(executedSteps)
        };
        
        // Persist to database
        await this.updateChatbotState(chatbotState.id, {
          context: updatedContext
        });
        
        // CRITICAL: Update in-memory chatbotState so subsequent iterations in same cycle see the executed flag
        chatbotState.context = updatedContext as any;
        
        console.log(`[ChatbotService] ✅ Step "${currentStep.stepId}" executed and persisted successfully`);
      } else {
        console.log(`[ChatbotService] ⏸️ Step did NOT transition - NOT marking as executed (will process again on next user message)`);
      }
      
      return shouldContinue;
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Error in processFlowStep:', error);
      throw error;
    }
  }

  /**
   * Process a FIXED message step (no AI involved)
   * @returns true if loop should continue (FIXED→FIXED), false if should stop (FIXED→AI, no transitions, or waiting for user)
   */
  private async processFixedMessageStep(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    currentStep: FlowStep,
    allSteps: FlowStep[],
    messageContent: string,
    instanceName: string
  ): Promise<boolean> {
    try {
      // Parse transitions from JSONB field
      const transitions = (currentStep.transitions as any) || [];
      console.log(`[ChatbotService] 📋 Fixed step has ${transitions.length} transition(s)`);
      
      // Check if we're waiting for user response to a previous fixed message with multiple transitions
      const context = chatbotState.context as any || {};
      if (context.waitingForFixedTransition && context.currentStepId === currentStep.stepId) {
        console.log(`[ChatbotService] 🔍 Processing user response for fixed message with multiple transitions`);
        return await this.handleFixedMessageTransitionSelection(
          lead,
          conversation,
          chatbotState,
          currentStep,
          allSteps,
          transitions,
          messageContent
        );
      }
      
      // Parse stepPrompt with robust validation
      let messages: string[] = [];
      try {
        const parsed = JSON.parse(currentStep.stepPrompt);
        if (Array.isArray(parsed)) {
          // Filter out empty strings and strings with only whitespace
          messages = parsed.filter(msg => msg && typeof msg === 'string' && msg.trim().length > 0);
          console.log(`[ChatbotService] 📨 Detected ${parsed.length} raw messages, ${messages.length} valid messages after filtering`);
        } else {
          // Not an array, treat as single message if not empty
          if (currentStep.stepPrompt && currentStep.stepPrompt.trim().length > 0) {
            messages = [currentStep.stepPrompt];
            console.log(`[ChatbotService] 📤 stepPrompt is JSON but not an array, treating as single message`);
          }
        }
      } catch {
        // Not valid JSON, treat as single message if not empty (backward compatibility)
        if (currentStep.stepPrompt && currentStep.stepPrompt.trim().length > 0) {
          messages = [currentStep.stepPrompt];
          console.log(`[ChatbotService] 📤 stepPrompt is plain text, treating as single message`);
        }
      }
      
      // CRITICAL FIX: Ensure ALL messages are sent before advancing state
      if (messages.length === 0) {
        console.warn(`[ChatbotService] ⚠️ No valid messages to send`);
        // Continue with transitions
      } else if (messages.length === 1) {
        // Single message: send and await (replace placeholders)
        console.log(`[ChatbotService] 📤 Sending single message`);
        const messageWithPlaceholders = await this.replacePlaceholders(messages[0], lead);
        await this.sendMessageWithRetry(lead.whatsappPhone, messageWithPlaceholders, instanceName, conversation.id);
        console.log(`[ChatbotService] ✅ Message sent successfully`);
      } else {
        // Multiple messages: await first, then await ALL remaining messages
        console.log(`[ChatbotService] 📤 Sending first of ${messages.length} messages`);
        const firstMessageWithPlaceholders = await this.replacePlaceholders(messages[0], lead);
        await this.sendMessageWithRetry(lead.whatsappPhone, firstMessageWithPlaceholders, instanceName, conversation.id);
        console.log(`[ChatbotService] ✅ First message sent, now sending remaining ${messages.length - 1} messages`);
        
        // CRITICAL: AWAIT all remaining messages before advancing state
        const remainingMessages = messages.slice(1);
        await this.sendMessagesInBackground(lead, remainingMessages, instanceName, conversation.id, currentStep.stepName);
        console.log(`[ChatbotService] ✅ All ${messages.length} messages sent successfully - safe to advance state`);
      }
      
      // ONLY AFTER ALL MESSAGES ARE SENT: Determine next step based on number of transitions
      if (transitions.length === 0) {
        // No transitions - stay on current step and stop loop
        console.log(`[ChatbotService] ⚠️ No transitions defined for fixed step "${currentStep.stepName}" - staying on current step`);
        console.log(`[ChatbotService] 🛑 Stopping loop - no transitions`);
        return false;
      } else if (transitions.length === 1) {
        // Single transition - auto-advance after buffer
        const singleTransition = transitions[0];
        const targetStepId = singleTransition.targetStepId;
        const nextStep = allSteps.find(s => s.stepId === targetStepId);
        
        if (nextStep) {
          // Get buffer time for this step (use nullish coalescing to allow 0)
          const buffer = currentStep.buffer ?? 30;
          const bufferMs = buffer * 1000;
          
          console.log(`[ChatbotService] ⏱️ Single transition detected - will auto-advance to "${nextStep.stepName}" after ${buffer}s buffer${buffer === 0 ? ' (ENVIO INSTANTÂNEO)' : ''}`);
          
          // Set custom buffer timeout for the next user message
          this.setCustomBufferTimeout(lead.whatsappPhone, bufferMs);
          
          // Update state to next step immediately (the buffer will be applied to the next incoming message)
          await this.updateChatbotState(chatbotState.id, {
            currentState: nextStep.stepId,
            context: {
              ...context,
              waitingForFixedTransition: false,
              lastFixedMessageSentAt: Date.now()
            }
          });
          
          console.log(`[ChatbotService] ✅ Auto-transitioned to next step: ${nextStep.stepName}`);
          
          // CRITICAL: Check target step type to determine if loop should continue
          if (nextStep.stepType === 'ai') {
            console.log(`[ChatbotService] 🛑 Target is AI step - stopping loop (AI will wait for next user message)`);
            return false;
          } else {
            console.log(`[ChatbotService] 🔄 Target is FIXED step - continuing loop`);
            return true;
          }
        } else {
          console.error(`[ChatbotService] ❌ Target step not found: ${targetStepId}`);
          return false;
        }
      } else {
        // Multiple transitions - wait for user response
        console.log(`[ChatbotService] 🔀 Multiple transitions (${transitions.length}) detected - waiting for user response`);
        
        // Update context to indicate we're waiting for transition selection
        await this.updateChatbotState(chatbotState.id, {
          context: {
            ...context,
            waitingForFixedTransition: true,
            currentStepId: currentStep.stepId,
            availableTransitions: transitions,
            lastFixedMessageSentAt: Date.now()
          }
        });
        
        console.log(`[ChatbotService] ⏸️ Waiting for user to select one of ${transitions.length} options`);
        console.log(`[ChatbotService] 🛑 Stopping loop - waiting for user selection`);
        return false;
      }
      
    } catch (error) {
      console.error('[ChatbotService] Error processing fixed message step:', error);
      throw error;
    }
  }

  /**
   * Send remaining messages sequentially with delays
   * CRITICAL: This method is now AWAITABLE to ensure ALL messages are sent before state transitions
   * 
   * NOTE: This method typically receives REMAINING messages (not all messages).
   * The first message should already have been sent and awaited before calling this method.
   * 
   * CHANGE FROM PREVIOUS VERSION:
   * - Now returns Promise<void> instead of void
   * - Removed fire-and-forget wrapper - method is now properly awaitable
   * - Errors are propagated to caller instead of being swallowed
   * - Ensures state only advances AFTER all messages are successfully sent
   */
  private async sendMessagesInBackground(
    lead: Lead,
    messages: string[],
    instanceName: string,
    conversationId: string,
    stepName: string
  ): Promise<void> {
    console.log(`[Fixed Step] Sending ${messages.length} remaining message(s) sequentially`);
    
    try {
      for (let i = 0; i < messages.length; i++) {
        try {
          console.log(`[Fixed Step] Sending message ${i + 2}/${messages.length + 1}`); // +2 because first message was already sent
          const messageWithPlaceholders = await this.replacePlaceholders(messages[i], lead);
          await this.sendMessageWithRetry(lead.whatsappPhone, messageWithPlaceholders, instanceName, conversationId);
          console.log(`[Fixed Step] Message ${i + 2}/${messages.length + 1} sent successfully`);
          
          // Delay between messages (except for the last one)
          if (i < messages.length - 1) {
            const delay = Math.floor(Math.random() * 2000) + 2000;
            console.log(`[Fixed Step] Waiting ${delay}ms before next message`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (messageError) {
          console.error(`[Fixed Step] Error sending message ${i + 2}:`, messageError);
          // CRITICAL CHANGE: Propagate error instead of continuing
          // This ensures state doesn't advance if ANY message fails
          throw messageError;
        }
      }
      
      console.log(`[Fixed Step] ✅ All ${messages.length} remaining messages sent successfully`);
      
    } catch (error) {
      console.error('[Fixed Step] Critical error in sendMessagesInBackground:', error);
      // Propagate error to prevent state advancement
      throw error;
    }
  }

  /**
   * Handle user response when a fixed message has multiple transitions
   * @returns true if loop should continue, false if should stop
   */
  private async handleFixedMessageTransitionSelection(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    currentStep: FlowStep,
    allSteps: FlowStep[],
    transitions: any[],
    userResponse: string
  ): Promise<boolean> {
    try {
      console.log(`[ChatbotService] 🔍 Analyzing user response: "${userResponse}"`);
      console.log(`[ChatbotService] 📋 Available transitions:`, transitions.map(t => ({ label: t.label, targetStepId: t.targetStepId })));
      
      // Try to match user response with transition labels (case-insensitive, fuzzy matching)
      const normalizedResponse = userResponse.toLowerCase().trim();
      
      // First try exact match
      let selectedTransition = transitions.find(t => 
        t.label.toLowerCase().trim() === normalizedResponse
      );
      
      // If no exact match, try partial match
      if (!selectedTransition) {
        selectedTransition = transitions.find(t => 
          normalizedResponse.includes(t.label.toLowerCase().trim()) ||
          t.label.toLowerCase().trim().includes(normalizedResponse)
        );
      }
      
      // If still no match, try numeric selection (1, 2, 3, etc.)
      if (!selectedTransition) {
        const numberMatch = normalizedResponse.match(/\d+/);
        if (numberMatch) {
          const index = parseInt(numberMatch[0]) - 1; // Convert to 0-based index
          if (index >= 0 && index < transitions.length) {
            selectedTransition = transitions[index];
            console.log(`[ChatbotService] 🔢 Matched by number: option ${index + 1}`);
          }
        }
      }
      
      if (selectedTransition) {
        const targetStepId = selectedTransition.targetStepId;
        const nextStep = allSteps.find(s => s.stepId === targetStepId);
        
        if (nextStep) {
          console.log(`[ChatbotService] ✅ User selected transition: "${selectedTransition.label}" → ${nextStep.stepName}`);
          
          // Update state to next step and clear waiting flag
          const context = chatbotState.context as any || {};
          await this.updateChatbotState(chatbotState.id, {
            currentState: nextStep.stepId,
            context: {
              ...context,
              waitingForFixedTransition: false,
              currentStepId: null,
              availableTransitions: null,
              lastTransitionSelectedAt: Date.now(),
              selectedTransitionLabel: selectedTransition.label
            }
          });
          
          // Process the next step immediately (recursively)
          console.log(`[ChatbotService] 🔄 Processing next step immediately: ${nextStep.stepName}`);
          const shouldContinue = await this.processFlowStep(lead, conversation, chatbotState, nextStep, allSteps, {} as FlowConfig, userResponse, conversation.instanceName);
          
          // Return the result from processing the next step
          return shouldContinue;
        } else {
          console.error(`[ChatbotService] ❌ Target step not found: ${targetStepId}`);
          await this.sendMessageWithRetry(
            lead.whatsappPhone,
            'Desculpe, houve um erro ao processar sua escolha. Por favor, tente novamente.',
            conversation.instanceName,
            conversation.id
          );
          return false;
        }
      } else {
        // No match found - ask user to try again
        console.log(`[ChatbotService] ⚠️ Could not match user response to any transition`);
        
        const optionsList = transitions.map((t, i) => `${i + 1}. ${t.label}`).join('\n');
        const retryMessage = `Desculpe, não entendi sua escolha. Por favor, selecione uma das opções:\n\n${optionsList}`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, retryMessage, conversation.instanceName, conversation.id);
        console.log(`[ChatbotService] 📤 Sent retry message with available options`);
        return false;
      }
      
    } catch (error) {
      console.error('[ChatbotService] Error handling fixed message transition selection:', error);
      throw error;
    }
  }

  /**
   * Process an AI step (existing logic)
   * @returns object with shouldContinue (if loop should continue) and transitioned (if moved to different step)
   */
  private async processAIStep(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    currentStep: FlowStep,
    allSteps: FlowStep[],
    flowConfig: FlowConfig,
    messageContent: string,
    instanceName: string
  ): Promise<{ shouldContinue: boolean; transitioned: boolean }> {
    try {
      // Get conversation history
      const conversationHistory = await this.getConversationHistory(conversation.id, 10);
      
      // Generate AI response based on current step
      const aiResponse = await this.generateFlowResponse(
        flowConfig,
        currentStep,
        allSteps,
        messageContent,
        conversationHistory
      );
      
      if (!aiResponse) {
        console.error('[ChatbotService] ❌ Failed to generate AI response');
        return { shouldContinue: false, transitioned: false };
      }
      
      console.log(`[ChatbotService] 🤖 AI Response: ${aiResponse.mensagemAgente.substring(0, 100)}...`);
      console.log(`[ChatbotService] ➡️ Next step suggested: ${aiResponse.proximaEtapaId || 'none'}`);
      
      // Check if AI determined a transition to ANOTHER step (different from current)
      // IMPORTANT: If AI returns the SAME stepId as current, it means "stay here and wait for next user message"
      if (aiResponse.proximaEtapaId && aiResponse.proximaEtapaId !== currentStep.stepId) {
        // AI wants to TRANSITION to another step
        const nextStep = allSteps.find(s => s.stepId === aiResponse.proximaEtapaId);
        if (nextStep) {
          console.log(`[ChatbotService] 🔀 AI determined transition to DIFFERENT step: ${nextStep.stepName}`);
          console.log(`[ChatbotService] ⚠️ NOT sending AI message - next step will send its own message`);
          
          // Update state to transition to next step
          // The loop in processWithConfigurableFlow will detect this and continue processing
          await this.updateChatbotState(chatbotState.id, {
            currentState: nextStep.stepId
          });
          
          console.log(`[ChatbotService] ✅ State updated to: ${nextStep.stepName} (${nextStep.stepId})`);
          console.log(`[ChatbotService] 🔄 Returning true - loop will continue to process next step`);
          return { shouldContinue: true, transitioned: true }; // Allow loop to continue, transitioned
        } else {
          console.log(`[ChatbotService] ⚠️ Next step ID not found: ${aiResponse.proximaEtapaId}`);
          console.log(`[ChatbotService] 🛑 Stopping loop - invalid next step`);
          return { shouldContinue: false, transitioned: false }; // Stop loop, no transition
        }
      } else {
        // AI is staying on current step (or no transition specified) - SEND MESSAGE
        if (aiResponse.proximaEtapaId === currentStep.stepId) {
          console.log(`[ChatbotService] ℹ️ AI returned SAME step - staying on: ${currentStep.stepName}`);
        } else {
          console.log(`[ChatbotService] ℹ️ No transition specified - staying on: ${currentStep.stepName}`);
        }
        
        console.log(`[ChatbotService] 📤 Sending AI response to user (staying on same step)`);
        const aiMessageWithPlaceholders = await this.replacePlaceholders(aiResponse.mensagemAgente, lead);
        await this.sendMessageWithRetry(
          lead.whatsappPhone,
          aiMessageWithPlaceholders,
          instanceName,
          conversation.id
        );
        console.log(`[ChatbotService] ✅ AI message sent successfully`);
        
        console.log(`[ChatbotService] 🛑 Returning false - no transition, stopping loop`);
        return { shouldContinue: false, transitioned: false }; // Stop loop - no transition, staying on same step
      }
      
    } catch (error) {
      console.error('[ChatbotService] Error processing AI step:', error);
      throw error;
    }
  }
  
  /**
   * Generate AI response based on current flow step
   */
  private async generateFlowResponse(
    flowConfig: FlowConfig,
    currentStep: FlowStep,
    allSteps: FlowStep[],
    messageContent: string,
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<{ mensagemAgente: string; proximaEtapaId: string | null } | null> {
    try {
      console.log('[ChatbotService] 🤖 Generating AI response using flow configuration...');
      
      // Build context for the AI
      const systemPrompt = `${flowConfig.globalPrompt}

ETAPA ATUAL: ${currentStep.stepName}
OBJETIVO DA ETAPA: ${currentStep.objective}
INSTRUÇÕES PARA ESTA ETAPA: ${currentStep.stepPrompt}

INSTRUÇÕES DE ROTEAMENTO: ${currentStep.routingInstructions}

ETAPAS DISPONÍVEIS NO FLUXO:
${allSteps.map(s => `- ${s.stepId}: ${s.stepName}`).join('\n')}

IMPORTANTE: 
- Responda APENAS ao contexto desta etapa (${currentStep.stepName})
- NÃO aborde outros assuntos fora do escopo desta etapa
- Use as instruções de roteamento para decidir se deve avançar para outra etapa
- Sua resposta deve ser natural, cordial e profissional`;

      const messages: any[] = [
        { role: 'system', content: systemPrompt }
      ];
      
      // Add conversation history
      conversationHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      });
      
      // Add current message
      messages.push({
        role: 'user',
        content: messageContent
      });
      
      // Add instruction for structured response
      messages.push({
        role: 'system',
        content: `Baseado na mensagem do cliente e nas instruções de roteamento, responda em formato JSON com:
{
  "mensagemAgente": "sua resposta ao cliente aqui",
  "proximaEtapaId": "id da próxima etapa (se aplicável) ou null para manter na etapa atual"
}

Lembre-se: Use EXATAMENTE os stepIds disponíveis listados acima. Se não for necessário mudar de etapa, use null.`
      });
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 500
      });
      
      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) {
        console.error('[ChatbotService] No response from OpenAI');
        return null;
      }
      
      // Try to parse JSON response
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        } else if (jsonText.includes('```')) {
          jsonText = jsonText.replace(/```\n?/g, '').trim();
        }
        
        const parsed = JSON.parse(jsonText);
        
        // Validate response structure
        if (!parsed.mensagemAgente) {
          throw new Error('Missing mensagemAgente in response');
        }
        
        return {
          mensagemAgente: parsed.mensagemAgente,
          proximaEtapaId: parsed.proximaEtapaId || null
        };
      } catch (parseError) {
        console.error('[ChatbotService] Failed to parse AI response as JSON:', parseError);
        console.log('[ChatbotService] Raw response:', responseText);
        
        // Fallback: use the text as message and stay on current step
        return {
          mensagemAgente: responseText,
          proximaEtapaId: null
        };
      }
      
    } catch (error) {
      console.error('[ChatbotService] Error generating flow response:', error);
      return null;
    }
  }
  
  /**
   * Get conversation history for context
   */
  private async getConversationHistory(
    conversationId: string,
    limit: number = 10
  ): Promise<Array<{ role: string; content: string }>> {
    try {
      const recentMessages = await db.select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.timestamp))
        .limit(limit);
      
      // Reverse to get chronological order
      return recentMessages.reverse().map(msg => ({
        role: msg.isBot ? 'assistant' : 'user',
        content: msg.content
      }));
    } catch (error) {
      console.error('[ChatbotService] Error fetching conversation history:', error);
      return [];
    }
  }

  private async processStateMachine(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    const state = chatbotState.currentState;

    switch(state) {
      case 'initial':
        await this.handleInitialState(lead, conversation, chatbotState, instanceName);
        break;
      
      case 'menu_selection':
        await this.handleMenuSelection(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'menu1_como_conheceu':
        await this.handleMenu1ComoConheceu(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'menu1_seguros_novos':
        await this.handleMenu1SegurosNovos(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'menu1_tipo_seguro':
        await this.handleMenu1TipoSeguro(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'menu2_autorio_status':
        await this.handleMenu2AutorioStatus(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'menu2_autorio_quando_pega':
        await this.handleMenu2AutorioQuandoPega(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'fluxo_auto_status':
        await this.handleFluxoAutoStatus(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'fluxo_auto_dados_pessoais':
        await this.handleFluxoAutoDadosPessoais(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'fluxo_auto_dados_pessoais_confirmacao':
        await this.handleFluxoAutoDadosPessoaisConfirmacao(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'fluxo_auto_dados_veiculo':
        await this.handleFluxoAutoDadosVeiculo(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_estacionamento':
        await this.handleDadosVeiculoEstacionamento(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_portao':
        await this.handleDadosVeiculoPortao(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_trabalho_estudo':
        await this.handleDadosVeiculoTrabalhoEstudo(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_moradia':
        await this.handleDadosVeiculoMoradia(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_carro_reserva':
        await this.handleDadosVeiculoCarroReserva(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_reboque':
        await this.handleDadosVeiculoReboque(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_condutor_menor_25':
        await this.handleDadosVeiculoCondutorMenor25(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'dados_veiculo_tipo_uso':
        await this.handleDadosVeiculoTipoUso(lead, conversation, chatbotState, messageContent, instanceName);
        break;

      case 'menu3_renovacao':
        await this.handleMenu3Renovacao(lead, conversation, chatbotState, messageContent, instanceName);
        break;

      case 'menu4_endosso':
        await this.handleMenu4Endosso(lead, conversation, chatbotState, messageContent, instanceName);
        break;

      case 'menu5_parcelas':
        await this.handleMenu5Parcelas(lead, conversation, chatbotState, messageContent, instanceName);
        break;

      case 'menu6_sinistros':
        await this.handleMenu6Sinistros(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'aguardando_apolice':
        await this.handleAguardandoApolice(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'fluxo_auto_quando_pega':
        await this.handleFluxoAutoQuandoPega(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'aguardando_identificador':
        await this.handleAguardandoIdentificador(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'aguardando_identificador_parcelas':
        await this.handleAguardandoIdentificadorParcelas(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'aguardando_identificador_sinistros':
        await this.handleAguardandoIdentificadorSinistros(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'endosso_item':
        await this.handleEndossoItem(lead, conversation, chatbotState, messageContent, instanceName);
        break;
      
      case 'aguardando_documentos':
        await this.handleAguardandoDocumentos(lead, conversation, chatbotState, messageContent, instanceName);
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
          instanceName,
          conversation.id
        );
        
        // SEMPRE transferir para humano, NUNCA resetar
        await this.handleHumanHandoff(lead, conversation, 'Estado desconhecido', instanceName);
    }
  }

  private async handleInitialState(lead: Lead, conversation: Conversation, chatbotState: ChatbotState, instanceName: string) {
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
        await this.wahaAPI.sendText(lead.whatsappPhone, message, instanceName, conversation.id);
        
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
      await this.sendMessageWithRetry(lead.whatsappPhone, message1, instanceName, conversation.id);
      console.log('[ChatbotService] ✅ MENSAGEM1 enviada com sucesso');
      
      // Small delay to ensure proper ordering
      await new Promise(resolve => setTimeout(resolve, 800));
      
      console.log('[ChatbotService] 📤 Enviando MENSAGEM2 para', lead.whatsappPhone);
      await this.sendMessageWithRetry(lead.whatsappPhone, message2, instanceName, conversation.id);
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
          instanceName,
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
    messageContent: string,
    instanceName: string
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
          
          await this.sendMessageWithRetry(lead.whatsappPhone, menu1Message, instanceName, conversation.id);
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
          
          await this.sendMessageWithRetry(lead.whatsappPhone, menu2Message, instanceName, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu2_autorio_status',
            menuSelections: { mainMenu: '2' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu2_autorio_status`);
          break;
        
        case '3':
          const template3 = await this.getMessageTemplate('MENU3_RENOVACAO_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template3, instanceName, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu3_renovacao',
            menuSelections: { mainMenu: '3' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu3_renovacao`);
          break;
        
        case '4':
          const template4 = await this.getMessageTemplate('MENU4_ENDOSSO_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template4, instanceName, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu4_endosso',
            menuSelections: { mainMenu: '4' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu4_endosso`);
          break;
        
        case '5':
          const template5 = await this.getMessageTemplate('MENU5_PARCELAS_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template5, instanceName, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu5_parcelas',
            menuSelections: { mainMenu: '5' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu5_parcelas`);
          break;
        
        case '6':
          const template6 = await this.getMessageTemplate('MENU6_SINISTROS_ABERTURA');
          await this.sendMessageWithRetry(lead.whatsappPhone, template6, instanceName, conversation.id);
          await this.updateChatbotState(chatbotState.id, {
            currentState: 'menu6_sinistros',
            menuSelections: { mainMenu: '6' }
          });
          console.log(`[ChatbotService] ✅ Transição para: menu6_sinistros`);
          break;
        
        default:
          const menuMsg = await this.getMessageTemplate('MENSAGEM2');
          const helpMsg = `Desculpe, não entendi sua escolha. ${menuMsg}`;
          await this.sendMessageWithRetry(lead.whatsappPhone, helpMsg, instanceName, conversation.id);
          console.log(`[ChatbotService] ⚠️ Opção não reconhecida, reenviando menu`);
          break;
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenuSelection:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar sua mensagem. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu1ComoConheceu(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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

        await this.sendMessageWithRetry(lead.whatsappPhone, tipoSeguroMessage, instanceName, conversation.id);
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

        await this.sendMessageWithRetry(lead.whatsappPhone, cotacaoMessage, instanceName, conversation.id);
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
        
        await this.sendMessageWithRetry(lead.whatsappPhone, resendMessage, instanceName, conversation.id);
        console.log(`[ChatbotService] ⚠️ Intenção não clara, reenviando opções`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu1ComoConheceu:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar sua resposta. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu1SegurosNovos(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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

        await this.sendMessageWithRetry(lead.whatsappPhone, tipoSeguroMessage, instanceName, conversation.id);
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

        await this.sendMessageWithRetry(lead.whatsappPhone, cotacaoMessage, instanceName, conversation.id);
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
        
        await this.sendMessageWithRetry(lead.whatsappPhone, resendMessage, instanceName, conversation.id);
        console.log(`[ChatbotService] ⚠️ Intenção não clara, reenviando opções`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu1SegurosNovos:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro ao processar sua resposta. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu1TipoSeguro(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu1_tipo_seguro | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();

      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('carro') || lowercaseMessage.includes('veículo')) {
        // According to instructions, start AUTO insurance flow
        const autoMessage = `Você escolheu Auto. 🚗
💚 Será um prazer ajudar você a garantir tranquilidade e segurança.

O veículo já está com você ou quando você irá pegá-lo?`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, autoMessage, instanceName, conversation.id);
        await this.updateChatbotState(chatbotState.id, {
          currentState: 'fluxo_auto_status',
          collectedData: { ...(chatbotState.collectedData as ChatbotCollectedData || {}), tipoSeguro: 'auto' }
        });
        console.log(`[ChatbotService] ✅ Transição para: fluxo_auto_status`);
      } else {
        // Other insurance types - transfer to human
        const transferMessage = `Entendi! Vou transferir você para um de nossos especialistas que poderá ajudá-lo da melhor forma. Um momento, por favor... 💚`;
        await this.sendMessageWithRetry(lead.whatsappPhone, transferMessage, instanceName, conversation.id);
        await this.handleHumanHandoff(lead, conversation, `Tipo de seguro: ${messageContent}`, instanceName);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Tipo: ${messageContent}`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu1TipoSeguro:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu2AutorioStatus(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
        
        // Get updated lead to ensure we have latest data
        const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
        
        // Send message and transfer to human
        const urgentMessage = `Entendido! Como o veículo já está com você, vou marcar sua solicitação com grau de importância ALTO e COTAÇÃO URGENTE. 🚨

Vou transferir você agora para um de nossos especialistas Autorio que dará prioridade ao seu atendimento. Um momento, por favor... 💚`;
        await this.sendMessageWithRetry(lead.whatsappPhone, urgentMessage, instanceName, conversation.id);
        
        // Transfer to human (STOP AI flow)
        await this.handleHumanHandoff(lead, conversation, 'Menu 2 - Autorio - COTAÇÃO URGENTE - Veículo já com cliente', instanceName);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Autorio COTAÇÃO URGENTE`);
        
      } else if (resposta === 'não') {
        // Vehicle not yet with customer - ask when
        console.log('[ChatbotService] ℹ️ Autorio: Veículo ainda não está com cliente - prioridade padrão');
        
        const whenMessage = `Entendi que você ainda não pegou o carro. Para melhor organizarmos o atendimento, quando está previsto para retirar o veículo? 

Por favor, informe a data e hora aproximadas.`;
        await this.sendMessageWithRetry(lead.whatsappPhone, whenMessage, instanceName, conversation.id);
        
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
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Desculpe, não entendi sua resposta. O veículo já está com você ou você ainda vai retirá-lo?', instanceName, conversation.id);
        console.log(`[ChatbotService] ⚠️ Resposta não compreendida, reenviando pergunta`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu2AutorioStatus:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu2AutorioQuandoPega(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      
      // Get updated lead to ensure we have latest data
      const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
      
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
      
      await this.sendMessageWithRetry(lead.whatsappPhone, confirmMessage, instanceName, conversation.id);
      
      // Transfer to human (STOP AI flow as per instructions)
      await this.handleHumanHandoff(lead, conversation, `Menu 2 - Autorio - Prioridade Padrão - Veículo será retirado em: ${quandoPegaVeiculo}`, instanceName);
      console.log(`[ChatbotService] ✅ Transferindo para humano - Autorio (Prioridade Padrão)`);
      
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu2AutorioQuandoPega:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente ou digite "humano" para falar com um atendente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleFluxoAutoStatus(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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

      await this.wahaAPI.sendText(lead.whatsappPhone, urgentMessage, instanceName, conversation.id);
      
      // Set custom buffer of 30 seconds for collecting personal data
      this.setCustomBufferTimeout(lead.whatsappPhone, 30000);
      
      // Update lead priority to urgent
      await db.update(leads)
        .set({ 
          priority: 'urgente',
          tags: [...(lead.tags || []), 'URGENTE', 'AUTO', 'SEM_SEGURO']
        })
        .where(eq(leads.id, lead.id));

      // Get updated lead to ensure we have latest data
      const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));

      await this.updateChatbotState(chatbotState.id, {
        currentState: 'fluxo_auto_dados_pessoais',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          veiculoComCliente: true,
          prioridade: 'urgente'
        }
      });

    } else if (resposta === 'não') {
      await this.wahaAPI.sendText(lead.whatsappPhone, 'Perfeito! Quando você irá pegar o veículo? (Por favor, informe a data e horário aproximado)', instanceName, conversation.id);
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
      await this.wahaAPI.sendText(lead.whatsappPhone, 'Desculpe, não entendi. O veículo já está com você?', instanceName, conversation.id);
    }
  }

  private async handleFluxoAutoDadosPessoais(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_dados_pessoais | Lead: ${lead.protocol}`);
      
      // Validar se há conteúdo de mensagem para processar
      if (!messageContent || messageContent.trim() === '') {
        console.log('[ChatbotService] ⚠️ Mensagem vazia recebida, solicitando dados novamente');
        await this.wahaAPI.sendText(
          lead.whatsappPhone, 
          'Não recebi sua mensagem. Por favor, envie seus dados pessoais novamente ou um áudio com as informações.',
          instanceName,
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
          instanceName,
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
        await this.wahaAPI.sendText(lead.whatsappPhone, missingMessage, instanceName, conversation.id);
        
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
      await this.wahaAPI.sendText(lead.whatsappPhone, summary, instanceName, conversation.id);
      
      // Delay entre mensagens
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Pedir confirmação
      const confirmationMessage = 'Confira os dados acima. Está tudo correto ou deseja alterar algo?';
      await this.wahaAPI.sendText(lead.whatsappPhone, confirmationMessage, instanceName, conversation.id);

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
        instanceName,
        conversation.id
      );
    }
  }

  private async handleFluxoAutoDadosPessoaisConfirmacao(
    lead: Lead,
    conversation: Conversation,
    chatbotState: ChatbotState,
    messageContent: string,
    instanceName: string
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
          instanceName,
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
        await this.wahaAPI.sendText(lead.whatsappPhone, newSummary, instanceName, conversation.id);
        
        // Delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Perguntar novamente
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Confira os dados atualizados. Está tudo correto agora?',
          instanceName,
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
          await this.handleFluxoAutoDadosVeiculo(lead, conversation, updatedState, messageContent, instanceName);
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
            instanceName,
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
            instanceName,
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
            instanceName,
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
        await this.wahaAPI.sendText(lead.whatsappPhone, newSummary, instanceName, conversation.id);
        
        // Delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Perguntar novamente
        await this.wahaAPI.sendText(
          lead.whatsappPhone,
          'Confira os dados atualizados. Está tudo correto agora?',
          instanceName,
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
        await this.handleHumanHandoff(lead, conversation, 'Erro repetido ao processar confirmação de dados', instanceName);
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
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_dados_veiculo | Lead: ${lead.protocol}`);
      
      // Send first question directly without intro message
      const firstQuestion = await this.getMessageTemplate('AUTO_DADOS_VEICULO_ESTACIONAMENTO');
      await this.sendMessageWithRetry(lead.whatsappPhone, firstQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }

  // ========== VEHICLE DATA COLLECTION HANDLERS (SEQUENTIAL) ==========
  
  private async handleDadosVeiculoEstacionamento(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoPortao(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoTrabalhoEstudo(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoMoradia(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoCarroReserva(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoReboque(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoCondutorMenor25(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      await this.sendMessageWithRetry(lead.whatsappPhone, nextQuestion, instanceName, conversation.id);
      
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
        instanceName,
        conversation.id
      );
    }
  }
  
  private async handleDadosVeiculoTipoUso(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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

      await this.sendMessageWithRetry(lead.whatsappPhone, documentsMessage, instanceName, conversation.id);
      
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
        instanceName,
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
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu3_renovacao | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();
      let tipoIdentificador = '';
      let tipoSeguro = '';

      // Identificar o tipo de seguro escolhido
      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('frota') || lowercaseMessage.includes('🚗')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é a placa do veículo?', instanceName, conversation.id);
        tipoIdentificador = 'placa';
        tipoSeguro = 'Auto/Frota';
      } else if (lowercaseMessage.includes('empresarial') || lowercaseMessage.includes('🏢')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CNPJ da empresa?', instanceName, conversation.id);
        tipoIdentificador = 'cnpj';
        tipoSeguro = 'Empresarial';
      } else if (lowercaseMessage.includes('vida') || lowercaseMessage.includes('💚')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Vida';
      } else if (lowercaseMessage.includes('residencial') || lowercaseMessage.includes('🏠')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Residencial';
      } else if (lowercaseMessage.includes('viagem') || lowercaseMessage.includes('✈️')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Viagem';
      } else if (lowercaseMessage.includes('equipamento') || lowercaseMessage.includes('máquina') || lowercaseMessage.includes('agrícola') || lowercaseMessage.includes('⚙️')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF ou CNPJ do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf_cnpj';
        tipoSeguro = 'Equipamentos/Máquinas Agrícolas';
      } else if (lowercaseMessage.includes('rc profissional') || lowercaseMessage.includes('profissional') || lowercaseMessage.includes('💼')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF ou CNPJ do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf_cnpj';
        tipoSeguro = 'RC Profissional';
      } else if (lowercaseMessage.includes('fiança') || lowercaseMessage.includes('🏘️')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = 'Seguro Fiança';
      } else {
        // Se não identificou o tipo, perguntar novamente
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          'Por favor, me informe qual tipo de seguro você deseja renovar escolhendo uma das opções:\n🚗 Auto / Frota\n🏢 Empresarial\n🏠 Residencial\n💚 Vida\n✈️ Viagem\n⚙️ Equipamentos / Máquinas agrícolas\n💼 RC Profissional\n🏘️ Seguro Fiança',
          instanceName,
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
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu4Endosso(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
          instanceName,
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
        const mensagemCompleta = `Vou te transferir agora para um atendente humano, que dará continuidade ao seu atendimento e vai te ajudar da melhor forma possível. Só um momento, por favor. 💚`;
        await this.handleHumanHandoff(lead, conversation, 'Endosso - Alteração Cadastral', mensagemCompleta);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Alteração Cadastral`);
        
      } else if (lowercaseMessage.includes('cobertura')) {
        // Alteração de cobertura - transferir direto para humano
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          'Entendi! Para alterações de cobertura, vou transferir você para nosso setor especializado. Em breve entrarão em contato. 💚', 
          instanceName,
          conversation.id
        );
        await this.handleHumanHandoff(lead, conversation, 'Endosso - Alteração de Cobertura', instanceName);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Alteração de Cobertura`);
        
      } else {
        // Se não identificou o tipo, perguntar novamente
        await this.sendMessageWithRetry(
          lead.whatsappPhone, 
          `Por favor, escolha uma das opções abaixo:
🔘 Alteração cadastral
🔘 Alteração de cobertura
🔘 Alteração no item segurado`, 
          instanceName,
          conversation.id
        );
        console.log(`[ChatbotService] ⚠️ Tipo de endosso não identificado, solicitando novamente`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleMenu4Endosso:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu5Parcelas(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu5_parcelas | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();
      let tipoIdentificador = '';
      let tipoSeguro = '';

      // Identificar o tipo de seguro escolhido (similar ao Menu 3)
      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('frota') || lowercaseMessage.includes('🚗')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é a placa do veículo?', instanceName, conversation.id);
        tipoIdentificador = 'placa';
        tipoSeguro = 'Auto/Frota';
      } else if (lowercaseMessage.includes('empresarial') || lowercaseMessage.includes('🏢')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CNPJ da empresa?', instanceName, conversation.id);
        tipoIdentificador = 'cnpj';
        tipoSeguro = 'Empresarial';
      } else if (lowercaseMessage.includes('vida') || lowercaseMessage.includes('💚') || 
                 lowercaseMessage.includes('residencial') || lowercaseMessage.includes('🏠')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = lowercaseMessage.includes('vida') ? 'Vida' : 'Residencial';
      } else {
        // Para outros tipos, pedir CPF
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
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
        instanceName,
        conversation.id
      );
    }
  }

  private async handleMenu6Sinistros(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: menu6_sinistros | Lead: ${lead.protocol}`);
      const lowercaseMessage = messageContent.toLowerCase();
      let tipoIdentificador = '';
      let tipoSeguro = '';

      // Identificar o tipo de seguro escolhido (similar ao Menu 3)
      if (lowercaseMessage.includes('auto') || lowercaseMessage.includes('frota') || lowercaseMessage.includes('🚗')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é a placa do veículo?', instanceName, conversation.id);
        tipoIdentificador = 'placa';
        tipoSeguro = 'Auto/Frota';
      } else if (lowercaseMessage.includes('empresarial') || lowercaseMessage.includes('🏢')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CNPJ da empresa?', instanceName, conversation.id);
        tipoIdentificador = 'cnpj';
        tipoSeguro = 'Empresarial';
      } else if (lowercaseMessage.includes('vida') || lowercaseMessage.includes('💚') || 
                 lowercaseMessage.includes('residencial') || lowercaseMessage.includes('🏠')) {
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
        tipoIdentificador = 'cpf';
        tipoSeguro = lowercaseMessage.includes('vida') ? 'Vida' : 'Residencial';
      } else {
        // Para outros tipos, pedir CPF
        await this.sendMessageWithRetry(lead.whatsappPhone, 'Qual é o CPF do segurado?', instanceName, conversation.id);
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
        instanceName,
        conversation.id
      );
    }
  }

  private async handleAguardandoApolice(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: aguardando_apolice | Lead: ${lead.protocol}`);
      
      // Check if client wants to keep current data or review
      const lowercaseMessage = messageContent.toLowerCase();
      
      if (lowercaseMessage.includes('sim') || lowercaseMessage.includes('manter')) {
        const confirmMessage = `Perfeito! Vou processar sua cotação mantendo os dados atuais da apólice.
Nossa equipe irá analisar e entrar em contato em breve com as melhores opções. 💚

Obrigado por escolher a Portilho Corretora!`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, confirmMessage, instanceName, conversation.id);
        await this.handleHumanHandoff(lead, conversation, 'Cotação de apólice - mantém dados atuais', instanceName);
      } else if (lowercaseMessage.includes('não') || lowercaseMessage.includes('revisar') || lowercaseMessage.includes('atualizar')) {
        const reviewMessage = `Entendi! Para revisar os dados, vou transferir você para um especialista que poderá ajudá-lo com todas as alterações necessárias. 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, reviewMessage, instanceName, conversation.id);
        await this.handleHumanHandoff(lead, conversation, 'Cotação de apólice - deseja revisar dados', instanceName);
      } else {
        // Client sent something else - could be the policy document
        const receivedMessage = `Recebi seu envio! Nossa equipe irá analisar e entrar em contato em breve com a melhor proposta. 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, receivedMessage, instanceName, conversation.id);
        await this.handleHumanHandoff(lead, conversation, 'Apólice recebida para análise', instanceName);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoApolice:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Um especialista entrará em contato em breve.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleFluxoAutoQuandoPega(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: fluxo_auto_quando_pega | Lead: ${lead.protocol}`);
      
      // Update lead with normal priority since vehicle is not yet with customer
      await db.update(leads)
        .set({ 
          priority: 'normal',
          tags: [...(lead.tags || []), 'AUTO', 'VEÍCULO_A_RETIRAR']
        })
        .where(eq(leads.id, lead.id));
      
      // Get updated lead to ensure we have latest data
      const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
      
      // Store the date when client will pick up vehicle
      const confirmMessage = `Perfeito! Anotei que você irá pegar o veículo em ${messageContent}.

Agora preciso coletar alguns dados pessoais. Você pode enviar tudo de uma vez ou por áudio, como preferir:

Nome completo, CPF, data de nascimento, estado civil, endereço completo com CEP, telefone, e-mail, profissão e se você é o principal condutor do veículo.`;

      await this.sendMessageWithRetry(lead.whatsappPhone, confirmMessage, instanceName, conversation.id);
      await this.updateChatbotState(chatbotState.id, {
        currentState: 'fluxo_auto_dados_pessoais',
        collectedData: { 
          ...(chatbotState.collectedData as ChatbotCollectedData || {}), 
          dataRetirada: messageContent,
          prioridade: 'normal'
        }
      });
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleFluxoAutoQuandoPega:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleAguardandoIdentificador(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
        
        await this.sendMessageWithRetry(lead.whatsappPhone, successMessage, instanceName, conversation.id);
        
        // Transferir para humano com informações completas
        const handoffInfo = `Renovação de Seguro
Tipo: ${tipoRenovacao}
${tipoIdentificadorDescricao}: ${identificador}`;
        
        await this.handleHumanHandoff(lead, conversation, handoffInfo, instanceName);
        console.log(`[ChatbotService] ✅ Transferindo para humano - Renovação de ${tipoRenovacao}`);
      } else {
        const errorMessage = `Desculpe, o ${tipoIdentificador} informado parece estar incorreto.
Por favor, verifique e envie novamente.`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, errorMessage, instanceName, conversation.id);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoIdentificador:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleAguardandoIdentificadorParcelas(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      
      await this.sendMessageWithRetry(lead.whatsappPhone, successMessage, instanceName, conversation.id);
      
      // Transferir para humano com informações completas
      const handoffInfo = `Parcelas/Boletos
Tipo de Seguro: ${tipoSeguroParcelas}
${tipoIdentificadorDescricao}: ${identificador}`;
      
      await this.handleHumanHandoff(lead, conversation, handoffInfo, instanceName);
      console.log(`[ChatbotService] ✅ Transferindo para humano - Parcelas de ${tipoSeguroParcelas}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoIdentificadorParcelas:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleAguardandoIdentificadorSinistros(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
      
      await this.sendMessageWithRetry(lead.whatsappPhone, successMessage, instanceName, conversation.id);
      
      // Transferir para humano com informações completas - PRIORIDADE ALTA
      const handoffInfo = `🚨 SINISTRO/ASSISTÊNCIA - PRIORIDADE ALTA
Tipo de Seguro: ${tipoSeguroSinistros}
${tipoIdentificadorDescricao}: ${identificador}`;
      
      await this.handleHumanHandoff(lead, conversation, handoffInfo, instanceName);
      console.log(`[ChatbotService] 🚨 Transferindo para humano - SINISTRO de ${tipoSeguroSinistros}`);
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleAguardandoIdentificadorSinistros:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleEndossoItem(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
  ) {
    try {
      console.log(`[ChatbotService] 📍 Estado: endosso_item | Lead: ${lead.protocol}`);
      
      const lowercaseMessage = messageContent.toLowerCase();
      
      if (lowercaseMessage.includes('veículo') || lowercaseMessage.includes('veiculo') || lowercaseMessage.includes('carro')) {
        // Veículo selecionado - solicitar CRLV ou nota fiscal
        const veiculoMessage = `Para prosseguir, envie o documento necessário para a alteração do veículo: CRLV ou nota fiscal.`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, veiculoMessage, instanceName, conversation.id);
        
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
        
        await this.sendMessageWithRetry(lead.whatsappPhone, outrosMessage, instanceName, conversation.id);
        
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
          instanceName,
          conversation.id
        );
        console.log(`[ChatbotService] ⚠️ Item não identificado, solicitando novamente`);
      }
    } catch (error) {
      console.error('[ChatbotService] ❌ Erro em handleEndossoItem:', error);
      await this.sendMessageWithRetry(
        lead.whatsappPhone, 
        'Desculpe, houve um erro. Por favor, tente novamente.',
        instanceName,
        conversation.id
      );
    }
  }

  private async handleAguardandoDocumentos(
    lead: Lead, 
    conversation: Conversation, 
    chatbotState: ChatbotState, 
    messageContent: string,
    instanceName: string
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
        
        await this.sendMessageWithRetry(lead.whatsappPhone, thankYouMessage, instanceName, conversation.id);
        
        // Transferir para humano com informações detalhadas
        const handoffInfo = `Endosso - Alteração no Item Segurado
Item: ${itemDescricao}
Documento: Recebido`;
        
        await this.handleHumanHandoff(lead, conversation, handoffInfo, instanceName);
        console.log(`[ChatbotService] ✅ Documento de endosso recebido - Transferindo para humano`);
        
      } else {
        // Outros tipos de documento (mantém comportamento original)
        const thankYouMessage = `Obrigado por enviar os documentos! 📄
Nossa equipe irá analisar e entrar em contato em breve com sua cotação.

Fique à vontade para enviar mais informações ou documentos se desejar.

Agradecemos por escolher a Portilho Corretora! 💚`;
        
        await this.sendMessageWithRetry(lead.whatsappPhone, thankYouMessage, instanceName, conversation.id);
        
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

  private async handleHumanHandoff(lead: Lead, conversation: Conversation, reason: string, instanceName: string, customMessage?: string) {
    // CRITICAL: Mark in memory FIRST to prevent race conditions
    this.markPermanentHandoff(conversation.id, lead.whatsappPhone);
    
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
    
    // Broadcast conversation update for handoff
    try {
      const [updatedConversation] = await db.select()
        .from(conversations)
        .where(eq(conversations.id, conversation.id))
        .limit(1);
      
      if (updatedConversation) {
        broadcastConversationUpdate(conversation.id, updatedConversation);
        console.log(`[ChatbotService] 📡 Broadcast: conversation update sent for ${conversation.id} (handoff)`);
      }
    } catch (broadcastError) {
      console.error('[ChatbotService] ❌ Conversation update broadcast failed (non-fatal):', broadcastError);
    }

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

    // Send notification message (use custom message if provided, otherwise use default)
    if (customMessage) {
      await this.wahaAPI.sendText(
        lead.whatsappPhone,
        customMessage,
        instanceName,
        conversation.id
      );
    } else {
      await this.wahaAPI.sendText(
        lead.whatsappPhone,
        'Vou te transferir agora para um atendente humano, que dará continuidade ao seu atendimento e vai te ajudar da melhor forma possível. Só um momento, por favor. 💚',
        instanceName,
        conversation.id
      );
    }

    // Log the handoff
    const [handoffMessage] = await db.insert(messages).values({
      conversationId: conversation.id,
      content: `[SISTEMA] Transferido para atendimento humano. Motivo: ${reason}. Bot desativado permanentemente - apenas atendentes poderão responder.`,
      isBot: true,
      messageType: 'system'
    }).returning();
    
    // Broadcast handoff system message
    try {
      broadcastNewMessage(conversation.id, handoffMessage);
      console.log(`[ChatbotService] 📡 Broadcast: handoff system message sent for conversation ${conversation.id}`);
    } catch (broadcastError) {
      console.error('[ChatbotService] ❌ Broadcast failed (non-fatal):', broadcastError);
    }
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
  private async sendMessageWithRetry(phone: string, text: string, instanceName: string, conversationId?: string, maxRetries: number = 3): Promise<any> {
    // CRITICAL VALIDATION: Ensure instanceName is never null/undefined
    if (!instanceName || instanceName.trim() === '') {
      const errorMsg = `[ChatbotService] ❌ CRITICAL: instanceName is missing or empty! phone=${phone}, conversationId=${conversationId}`;
      console.error(errorMsg);
      throw new Error('instanceName is required and cannot be empty - this would cause WAHA "Session does not exist" errors');
    }
    
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ChatbotService] 📤 Tentativa ${attempt}/${maxRetries} de enviar mensagem para ${phone} na instância ${instanceName}`);
        const result = await this.wahaAPI.sendText(phone, text, instanceName, conversationId);
        console.log(`[ChatbotService] ✅ Mensagem enviada com sucesso na tentativa ${attempt}`);
        
        // Save bot message to database and broadcast (only if conversationId is provided)
        if (conversationId) {
          try {
            const [savedBotMessage] = await db.insert(messages).values({
              conversationId,
              content: text,
              isBot: true,
              messageType: 'text',
              metadata: { 
                sentViaRetry: true,
                attempt,
                wahaResult: result
              }
            }).returning();
            
            // Broadcast bot message
            try {
              broadcastNewMessage(conversationId, savedBotMessage);
              console.log(`[ChatbotService] 📡 Broadcast: bot message sent for conversation ${conversationId}`);
            } catch (broadcastError) {
              console.error('[ChatbotService] ❌ Broadcast failed (non-fatal):', broadcastError);
            }
          } catch (dbError) {
            console.error('[ChatbotService] ❌ Failed to save bot message to DB (non-fatal):', dbError);
          }
        }
        
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
    const lowercaseMessage = message.toLowerCase();
    
    // Palavras-chave diretas para atendimento humano
    const triggers = ['humano', 'atendente', 'falar com alguém', 'pessoa real', 'atendimento humano'];
    if (triggers.some(trigger => lowercaseMessage.includes(trigger))) {
      return true;
    }
    
    // Padrões para quando o cliente quer falar com uma pessoa específica
    // Exemplos: "quero falar com a Camila", "preciso falar com Verônica", "me passa o João"
    const specificPersonPatterns = [
      /(?:quero|preciso|gostaria|posso|queria|pode)\s+(?:de\s+)?falar\s+com\s+(?:a|o)?\s*[a-záàâãéêíóôõúçA-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+/i,
      /(?:me\s+)?(?:passa|transfere|conecta|manda)\s+(?:para\s+)?(?:a|o)?\s*[a-záàâãéêíóôõúçA-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+/i,
      /falar\s+com\s+(?:a|o)?\s*[a-záàâãéêíóôõúçA-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+/i,
      /(?:cadê|onde\s+está|onde\s+tá)\s+(?:a|o)?\s*[a-záàâãéêíóôõúçA-ZÁÀÂÃÉÊÍÓÔÕÚÇ]+/i
    ];
    
    if (specificPersonPatterns.some(pattern => pattern.test(message))) {
      console.log('[ChatbotService] 🔔 Detectado pedido para falar com pessoa específica');
      return true;
    }
    
    return false;
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