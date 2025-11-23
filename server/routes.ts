import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ChatbotService } from "./chatbot.service";
import { WAHAService } from "./waha.service";
import { LocalStorageService } from "./storage.service";
import { flowAIService } from "./flow-ai.service";
import { followupService } from "./followup.service";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import {
  insertLeadSchema,
  insertMessageSchema,
  insertDocumentSchema,
  insertWorkflowTemplateSchema,
  insertSystemSettingsSchema,
  insertFlowConfigSchema,
  insertKeywordRuleSchema,
  insertFlowStepSchema,
  insertFollowupMessageSchema,
  insertInstanceSchema,
  type Message,
  type Instance
} from "@shared/schema";
import { 
  validateWebhookAuth, 
  logSecurityEvent,
  trackFailedAttempts 
} from "./middleware/webhook-auth";
import { 
  webhookRateLimiter, 
  strictRateLimiter,
  apiRateLimiter,
  webhookSecurityHeaders 
} from "./middleware/security";
import { 
  validateWebhookPayload,
  extractPhoneNumber,
  extractMessageContent 
} from "./schemas/webhook.schema";
import { requireAuth, validateLogin } from "./middleware/auth";
import { 
  broadcastNewMessage, 
  broadcastNewConversation, 
  broadcastConversationUpdate 
} from './websocket';

// Initialize services
const chatbotService = new ChatbotService();
const wahaAPI = new WAHAService();
const localStorage = new LocalStorageService();

// Cache para deduplicação de mensagens (armazena IDs das últimas 1000 mensagens)
const processedMessageIds = new Set<string>();
const MAX_CACHE_SIZE = 1000;

function addToCache(messageId: string) {
  if (processedMessageIds.size >= MAX_CACHE_SIZE) {
    // Remove o primeiro item (mais antigo) quando atingir o limite
    const firstItem = processedMessageIds.values().next().value;
    if (firstItem) processedMessageIds.delete(firstItem);
  }
  processedMessageIds.add(messageId);
}

/**
 * Normaliza stepPrompt de nodes Fixed para JSON array
 * Garante que nodes Fixed sempre armazenam mensagens como JSON array
 */
function normalizeFlowSteps(steps: any[]): any[] {
  return steps.map(step => {
    // Apenas normalizar nodes Fixed
    if (step.stepType === 'fixed' && step.stepPrompt) {
      // Verificar se já é JSON array válido
      try {
        const parsed = JSON.parse(step.stepPrompt);
        if (Array.isArray(parsed)) {
          // Já é array - manter como está
          return step;
        }
      } catch {
        // Não é JSON válido - converter para array
      }
      
      // Converter string simples para array de 1 elemento
      return {
        ...step,
        stepPrompt: JSON.stringify([step.stepPrompt])
      };
    }
    
    // Nodes AI ou sem stepPrompt: manter como está
    return step;
  });
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure file upload with disk storage
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, PDF, DOC files are allowed.'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply rate limiting to all API endpoints
  app.use('/api/', apiRateLimiter);
  
  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));
  
  // Authentication endpoints (no auth required)
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ 
          error: 'Missing credentials',
          message: 'Username and password are required' 
        });
      }
      
      if (validateLogin(username, password)) {
        req.session.isAuthenticated = true;
        req.session.userId = username;
        
        return res.json({ 
          success: true,
          user: { username }
        });
      }
      
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Username or password is incorrect' 
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ 
        error: 'Server error',
        message: 'An error occurred during login' 
      });
    }
  });
  
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ 
          error: 'Logout failed',
          message: 'Could not log out' 
        });
      }
      res.clearCookie('connect.sid');
      return res.json({ success: true });
    });
  });
  
  app.get('/api/auth/check', (req: Request, res: Response) => {
    if (req.session?.isAuthenticated) {
      return res.json({ 
        isAuthenticated: true,
        user: { username: req.session.userId }
      });
    }
    return res.json({ isAuthenticated: false });
  });

  // Webhook endpoint for WAHA API with security middleware (no auth required)
  app.post(
    '/api/webhook/waha',
    webhookSecurityHeaders, // Add security headers
    webhookRateLimiter, // Apply rate limiting
    validateWebhookAuth, // Validate authentication
    async (req: Request, res: Response) => {
      console.log('[WAHA-WEBHOOK] 🎯 Webhook recebido!');
      console.log('[WAHA-WEBHOOK] Headers:', req.headers);
      
      try {
        // Check if IP is blocked due to failed attempts
        if (trackFailedAttempts(req)) {
          logSecurityEvent('WEBHOOK_BLOCKED_IP', {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            message: 'IP temporarily blocked due to multiple failed attempts'
          });
          return res.status(429).json({ 
            error: 'Too many failed attempts',
            message: 'Access temporarily blocked. Please try again later.'
          });
        }

        console.log('[WAHA-WEBHOOK] Raw incoming payload:', JSON.stringify(req.body, null, 2));

        // Validate and sanitize webhook payload
        const validation = validateWebhookPayload(req.body);
        if (!validation.success) {
          console.error('[WAHA-WEBHOOK] Validation failed:', validation.error, validation.details);
          logSecurityEvent('WEBHOOK_INVALID_PAYLOAD', {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            error: validation.error,
            details: validation.details,
            source: 'waha-api'
          });
          return res.status(400).json({ 
            error: 'Invalid payload',
            message: validation.error,
            details: validation.details 
          });
        }

        const validatedData = validation.data;
        console.log('[WAHA-WEBHOOK] Validated data:', JSON.stringify(validatedData, null, 2));
        
        // Extract instance name from webhook payload
        const instanceName: string = (validatedData?.session as string) || 'default';
        console.log('[WAHA-WEBHOOK] Instance name:', instanceName);
        
        // Extract and validate phone number from WAHA payload
        console.log('[WAHA-WEBHOOK] About to extract phone number...');
        const phone = extractPhoneNumber(validatedData);
        console.log('[WAHA-WEBHOOK] Extracted phone:', phone);
        if (!phone) {
          logSecurityEvent('WEBHOOK_NO_PHONE', {
            ip: req.ip,
            payload: validatedData ? Object.keys(validatedData) : [],
            source: 'waha-api'
          });
          return res.status(400).json({ 
            error: 'Invalid data',
            message: 'Phone number not found in payload' 
          });
        }

        // Parse message with WAHA service
        const parsedMessage = wahaAPI.parseWebhookMessage(validatedData);
        
        if (!parsedMessage) {
          console.log('[WAHA-WEBHOOK] Invalid message');
          return res.status(200).json({ status: 'ignored', reason: 'invalid-message' });
        }
        
        // Check if message is from a group - ignore group messages
        const isGroup = (validatedData?.payload as any)?._data?.Info?.IsGroup || false;
        if (isGroup) {
          console.log('[WAHA-WEBHOOK] 🚫 Message from group detected - ignoring. Groups are not supported.');
          return res.status(200).json({ status: 'ignored', reason: 'group-message-not-supported' });
        }
        
        // CRITICAL FIX: Ignorar TODAS as mensagens enviadas pelo bot via API
        // Isso previne loops quando atendente envia mensagem via WAHA API
        if (parsedMessage.isFromMe && parsedMessage.source === 'api') {
          console.log('[WAHA-WEBHOOK] 🤖 Mensagem enviada pelo bot via API - IGNORANDO para evitar loop');
          console.log('[WAHA-WEBHOOK] Message ID:', parsedMessage.messageId);
          console.log('[WAHA-WEBHOOK] Content:', parsedMessage.message?.substring(0, 50));
          return res.status(200).json({ status: 'ignored', reason: 'bot-message-via-api' });
        }
        
        // Check for human intervention - if message is from me (WhatsApp Business) but NOT from bot
        if (parsedMessage.isFromMe) {
          console.log('[WAHA-WEBHOOK] Message is from WhatsApp Business account (isFromMe: true)');
          console.log('[WAHA-WEBHOOK] Message source:', parsedMessage.source);
          
          // IMPROVED DETECTION: Check source field first (more reliable)
          // - source: "api" = sent by bot through API
          // - source: "app" or "web" or null = sent by human through WhatsApp app
          const isHumanMessage = parsedMessage.source !== 'api';
          
          if (isHumanMessage) {
            console.log('[WAHA-WEBHOOK] 🚨 HUMAN MESSAGE DETECTED (source != api)! This is definitely human intervention.');
            
            const lead = await storage.getLeadByPhone(phone.replace(/\D/g, ''));
            if (lead) {
              // CRITICAL FIX: Find or create conversation (same logic as chatbot)
              // Old code only looked for 'active' status, missing conversations that don't exist yet
              // or have other statuses like 'transferred', 'waiting', etc.
              let conversation = null;
              
              // First, try to find any non-closed conversation (same as chatbot does)
              const existingConversations = await storage.getConversations({ leadId: lead.id });
              const nonClosedConversation = existingConversations.find(conv => conv.status !== 'closed');
              
              if (nonClosedConversation) {
                conversation = nonClosedConversation;
                console.log('[WAHA-WEBHOOK] ✅ Found existing non-closed conversation:', conversation.id);
              } else {
                // Create new conversation if none exists
                console.log('[WAHA-WEBHOOK] ⚠️ No existing conversation found. Creating new one for handoff.');
                conversation = await storage.createConversation({
                  leadId: lead.id,
                  protocol: lead.protocol,
                  instanceName: instanceName,
                  status: 'active',
                  currentMenu: 'initial',
                  currentStep: 'welcome'
                });
                console.log('[WAHA-WEBHOOK] ✨ Created new conversation:', conversation.id);
              }
              
              if (conversation) {
                // CRITICAL: Mark handoff in memory IMMEDIATELY before any DB operations
                // This prevents race conditions where customer messages arrive while we're updating the DB
                chatbotService.markPermanentHandoff(conversation.id, phone);
                
                // Get or create chatbot state
                const chatbotState = await storage.getChatbotState(conversation.id);
                if (chatbotState) {
                  // Mark as permanently handed off in database
                  await storage.updateChatbotState(chatbotState.id, {
                    isPermanentHandoff: true
                  });
                  
                  // Store a system message about the permanent handoff
                  const systemMessage = await storage.createMessage({
                    conversationId: conversation.id,
                    content: `[SISTEMA] Intervenção humana detectada. Bot permanentemente desativado para este lead.`,
                    isBot: true,
                    messageType: 'system',
                    metadata: { 
                      handoffType: 'permanent',
                      handoffReason: 'human_intervention_detected',
                      handoffTime: new Date().toISOString()
                    }
                  });
                  
                  // Broadcast system message
                  try {
                    broadcastNewMessage(conversation.id, systemMessage);
                    console.log(`[WAHA-WEBHOOK] 📡 Broadcast: system message sent for conversation ${conversation.id}`);
                  } catch (broadcastError) {
                    console.error('[WAHA-WEBHOOK] ❌ Broadcast failed (non-fatal):', broadcastError);
                  }
                  
                  // Store the human's message too
                  const humanMessage = await storage.createMessage({
                    conversationId: conversation.id,
                    content: parsedMessage.message,
                    isBot: false,
                    messageType: parsedMessage.type || 'text',
                    metadata: { 
                      ...parsedMessage,
                      isHumanAgent: true,
                      handoffTriggered: true
                    }
                  });
                  
                  // Broadcast human agent message
                  try {
                    broadcastNewMessage(conversation.id, humanMessage);
                    console.log(`[WAHA-WEBHOOK] 📡 Broadcast: human agent message sent for conversation ${conversation.id}`);
                  } catch (broadcastError) {
                    console.error('[WAHA-WEBHOOK] ❌ Broadcast failed (non-fatal):', broadcastError);
                  }
                  
                  // Broadcast conversation update for handoff
                  try {
                    const updatedConversation = await storage.getConversation(conversation.id);
                    if (updatedConversation) {
                      broadcastConversationUpdate(conversation.id, updatedConversation);
                      console.log(`[WAHA-WEBHOOK] 📡 Broadcast: conversation update sent for ${conversation.id}`);
                    }
                  } catch (broadcastError) {
                    console.error('[WAHA-WEBHOOK] ❌ Conversation update broadcast failed (non-fatal):', broadcastError);
                  }
                  
                  console.log(`[WAHA-WEBHOOK] Lead ${lead.protocol} permanently handed off to human agent`);
                }
              }
            }
          } else if (!parsedMessage.source || parsedMessage.source === 'api') {
            // FALLBACK: When source is 'api' or not available, use the original logic
            // Check if this is a bot-sent message by checking recent messages
            const lead = await storage.getLeadByPhone(phone.replace(/\D/g, ''));
            if (lead) {
              // CRITICAL FIX: Find or create conversation (same as above)
              let conversation = null;
              const existingConversations = await storage.getConversations({ leadId: lead.id });
              const nonClosedConversation = existingConversations.find(conv => conv.status !== 'closed');
              
              if (nonClosedConversation) {
                conversation = nonClosedConversation;
                console.log('[WAHA-WEBHOOK] ✅ Found existing non-closed conversation (fallback):', conversation.id);
              } else {
                // Create new conversation if none exists
                console.log('[WAHA-WEBHOOK] ⚠️ No existing conversation found (fallback). Creating new one.');
                conversation = await storage.createConversation({
                  leadId: lead.id,
                  protocol: lead.protocol,
                  instanceName: instanceName,
                  status: 'active',
                  currentMenu: 'initial',
                  currentStep: 'welcome'
                });
                console.log('[WAHA-WEBHOOK] ✨ Created new conversation (fallback):', conversation.id);
              }
              
              if (conversation) {
                // Check if we recently sent this exact message as a bot
                const recentMessages = await storage.getMessages(conversation.id, 10);
                const botSentThisMessage = recentMessages.some(msg => 
                  msg.isBot === true && 
                  msg.content === parsedMessage.message &&
                  // Message sent in the last 30 seconds
                  (new Date().getTime() - new Date(msg.timestamp).getTime()) < 30000
                );
                
                if (!botSentThisMessage) {
                  // This is a human intervention!
                  console.log('[WAHA-WEBHOOK] 🚨 HUMAN INTERVENTION DETECTED (fallback check)! Marking conversation as permanently handed off.');
                  
                  // CRITICAL: Mark handoff in memory IMMEDIATELY before any DB operations
                  chatbotService.markPermanentHandoff(conversation.id, phone);
                  
                  // Get or create chatbot state
                  const chatbotState = await storage.getChatbotState(conversation.id);
                  if (chatbotState) {
                    // Mark as permanently handed off in database
                    await storage.updateChatbotState(chatbotState.id, {
                      isPermanentHandoff: true
                    });
                    
                    // Store a system message about the permanent handoff
                    const systemMessage = await storage.createMessage({
                      conversationId: conversation.id,
                      content: `[SISTEMA] Intervenção humana detectada. Bot permanentemente desativado para este lead.`,
                      isBot: true,
                      messageType: 'system',
                      metadata: { 
                        handoffType: 'permanent',
                        handoffReason: 'human_intervention_detected',
                        handoffTime: new Date().toISOString()
                      }
                    });
                    
                    // Broadcast system message
                    try {
                      broadcastNewMessage(conversation.id, systemMessage);
                      console.log(`[WAHA-WEBHOOK] 📡 Broadcast: system message sent for conversation ${conversation.id}`);
                    } catch (broadcastError) {
                      console.error('[WAHA-WEBHOOK] ❌ Broadcast failed (non-fatal):', broadcastError);
                    }
                    
                    // Store the human's message too
                    const humanMessage = await storage.createMessage({
                      conversationId: conversation.id,
                      content: parsedMessage.message,
                      isBot: false,
                      messageType: parsedMessage.type || 'text',
                      metadata: { 
                        ...parsedMessage,
                        isHumanAgent: true,
                        handoffTriggered: true
                      }
                    });
                    
                    // Broadcast human agent message
                    try {
                      broadcastNewMessage(conversation.id, humanMessage);
                      console.log(`[WAHA-WEBHOOK] 📡 Broadcast: human agent message sent for conversation ${conversation.id}`);
                    } catch (broadcastError) {
                      console.error('[WAHA-WEBHOOK] ❌ Broadcast failed (non-fatal):', broadcastError);
                    }
                    
                    // Broadcast conversation update for handoff
                    try {
                      const updatedConversation = await storage.getConversation(conversation.id);
                      if (updatedConversation) {
                        broadcastConversationUpdate(conversation.id, updatedConversation);
                        console.log(`[WAHA-WEBHOOK] 📡 Broadcast: conversation update sent for ${conversation.id}`);
                      }
                    } catch (broadcastError) {
                      console.error('[WAHA-WEBHOOK] ❌ Conversation update broadcast failed (non-fatal):', broadcastError);
                    }
                    
                    console.log(`[WAHA-WEBHOOK] Lead ${lead.protocol} permanently handed off to human agent`);
                  }
                } else {
                  console.log('[WAHA-WEBHOOK] Message was sent by bot, ignoring echo');
                }
              }
            }
          }
          
          return res.status(200).json({ status: 'processed', reason: 'human-intervention-check' });
        }

        console.log('[WAHA-WEBHOOK] 🔍 Parsed message type:', parsedMessage.type);
        console.log('[WAHA-WEBHOOK] 🔍 Parsed message ID:', parsedMessage.messageId);
        console.log('[WAHA-WEBHOOK] 🔍 Has media:', parsedMessage.media ? 'YES' : 'NO');
        
        // CRITICAL: Check if conversation is permanently handed off BEFORE processing ANY customer message
        const leadCheck = await storage.getLeadByPhone(phone.replace(/\D/g, ''));
        if (leadCheck) {
          const conversationsCheck = await storage.getConversations({ leadId: leadCheck.id, status: 'active' });
          if (conversationsCheck.length > 0) {
            const conversationCheck = conversationsCheck[0];
            
            // Check both in-memory guard and database
            if (chatbotService.isPermanentHandoff(conversationCheck.id, phone)) {
              console.log('[WAHA-WEBHOOK] 🛑 PERMANENT HANDOFF ACTIVE - Ignoring message to prevent bot response');
              
              // Still save the customer message for history, but don't let bot process it
              const customerMessage = await storage.createMessage({
                conversationId: conversationCheck.id,
                content: parsedMessage.message || '',
                isBot: false,
                messageType: parsedMessage.type || 'text',
                metadata: { 
                  ...parsedMessage,
                  ignoredDueToHandoff: true
                }
              });
              
              // Broadcast customer message
              try {
                broadcastNewMessage(conversationCheck.id, customerMessage);
                console.log(`[WAHA-WEBHOOK] 📡 Broadcast: customer message sent for conversation ${conversationCheck.id}`);
              } catch (broadcastError) {
                console.error('[WAHA-WEBHOOK] ❌ Broadcast failed (non-fatal):', broadcastError);
              }
              
              return res.status(200).json({ status: 'ignored', reason: 'permanent-handoff-active' });
            }
          }
        }

        // Verificar se a mensagem já foi processada (deduplicação) - ANTES de processar áudio
        const messageId = (validatedData as any).payload?.id || (validatedData as any).id;
        if (messageId && processedMessageIds.has(messageId)) {
          console.log(`[WAHA-WEBHOOK] ⚠️ Duplicate message detected: ${messageId}`);
          
          // Se for áudio, não ignorar na primeira tentativa (pode precisar transcrever)
          if (parsedMessage.type !== 'audio') {
            console.log(`[WAHA-WEBHOOK] Ignoring duplicate non-audio message`);
            return res.status(200).json({ status: 'ignored', reason: 'duplicate-message' });
          }
          console.log(`[WAHA-WEBHOOK] Allowing duplicate audio message for transcription`);
        }

        // Extract message content (text or transcribe audio)
        let messageContent = extractMessageContent(validatedData);
        console.log('[WAHA-WEBHOOK] 🔍 Extracted text content:', messageContent ? `"${messageContent.substring(0, 50)}..."` : 'EMPTY');
        
        // Check if it's an audio message and transcribe it
        if (!messageContent && parsedMessage.type === 'audio' && parsedMessage.messageId) {
          console.log('[WAHA-WEBHOOK] 🎤 Audio message detected, transcribing...');
          
          // Extract media URL from parsedMessage
          const mediaUrl = parsedMessage.media?.media?.url || parsedMessage.media?.url;
          console.log('[WAHA-WEBHOOK] Media URL:', mediaUrl ? 'Found' : 'Not found');
          
          // Download and transcribe audio
          const audioBuffer = await wahaAPI.downloadMedia(parsedMessage.messageId, mediaUrl);
          if (audioBuffer) {
            const transcription = await wahaAPI.transcribeAudio(audioBuffer);
            if (transcription) {
              messageContent = transcription;
              console.log('[WAHA-WEBHOOK] ✅ Audio transcribed successfully:', transcription.substring(0, 100) + '...');
            } else {
              console.error('[WAHA-WEBHOOK] ❌ Failed to transcribe audio');
              await wahaAPI.sendText(phone, '🎤 Desculpe, não consegui entender o áudio. Por favor, envie um texto ou tente novamente.', instanceName);
              return res.status(200).json({ status: 'processed', message: 'audio-transcription-failed' });
            }
          } else {
            console.error('[WAHA-WEBHOOK] ❌ Failed to download audio');
            await wahaAPI.sendText(phone, '🎤 Desculpe, não consegui baixar o áudio. Por favor, envie um texto ou tente novamente.', instanceName);
            return res.status(200).json({ status: 'processed', message: 'audio-download-failed' });
          }
        }

        // Adicionar ao cache de mensagens processadas
        if (messageId) {
          addToCache(messageId);
          console.log(`[WAHA-WEBHOOK] Message added to cache: ${messageId}`);
        }

        // Buscar informações do contato se a mensagem NÃO for do bot (fromMe: false)
        if (!parsedMessage.isFromMe) {
          console.log('[WAHA-WEBHOOK] Fetching contact info for incoming message...');
          const contactInfo = await wahaAPI.getContactInfo(phone, instanceName);
          if (contactInfo && contactInfo.pushname) {
            console.log(`[WAHA-WEBHOOK] Contact name found: ${contactInfo.pushname}`);
            parsedMessage.pushName = contactInfo.pushname;
            parsedMessage.name = contactInfo.name;
          }
        }

        // Log successful webhook reception
        logSecurityEvent('WEBHOOK_RECEIVED', {
          ip: req.ip,
          phone: phone.substring(0, 6) + '***', // Partial phone for privacy
          messageType: parsedMessage.type,
          authenticated: true,
          source: 'waha-api'
        });

        // Check if chatbot is enabled for this instance
        const instance = await storage.getInstance(instanceName);
        if (!instance) {
          console.error(`[WAHA-WEBHOOK] ❌ Instance '${instanceName}' not found in database`);
          return res.status(404).json({ 
            error: 'Instance not found',
            message: `Instance '${instanceName}' not found in database`
          });
        }

        if (!instance.chatbotEnabled) {
          console.log(`[WAHA-WEBHOOK] ⚠️ Chatbot disabled for instance '${instanceName}' - logging message only`);
          logSecurityEvent('WEBHOOK_CHATBOT_DISABLED', {
            ip: req.ip,
            instanceName,
            phone: phone.substring(0, 6) + '***',
            messageType: parsedMessage.type,
            message: 'Chatbot is disabled for this instance - message not processed'
          });
          
          return res.status(200).json({ 
            status: 'ignored',
            reason: 'chatbot-disabled',
            instanceName,
            timestamp: new Date().toISOString()
          });
        }

        console.log(`[WAHA-WEBHOOK] ✅ Chatbot enabled for instance '${instanceName}' - processing message`);

        // Process message through chatbot with instance name
        await chatbotService.processIncomingMessage(
          phone,
          messageContent || parsedMessage.message,
          parsedMessage,
          instanceName
        );

        res.status(200).json({ 
          status: 'processed',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logSecurityEvent('WEBHOOK_PROCESSING_ERROR', {
          ip: req.ip,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          source: 'waha-api'
        });
        console.error('[WAHA-WEBHOOK] Processing error:', error);
        res.status(500).json({ 
          error: 'Processing failed',
          message: 'Failed to process webhook request'
        });
      }
    }
  );

  // Test endpoint for buffer validation (no auth required for testing)
  app.post('/api/test/buffer-flow', async (req: Request, res: Response) => {
    try {
      const { phone, message } = req.body;
      
      // Validate input
      if (!phone) {
        return res.status(400).json({
          error: 'Missing phone',
          message: 'Phone number is required'
        });
      }
      
      console.log('[TEST-BUFFER] 🧪 Testing buffer flow for phone:', phone);
      console.log('[TEST-BUFFER] Message:', message || '(no message)');
      
      // Get buffer debug info from chatbot service
      const debugInfo = await chatbotService.getBufferDebugInfo(phone);
      
      console.log('[TEST-BUFFER] ✅ Buffer info retrieved:', {
        currentStep: debugInfo.currentStepName,
        bufferSeconds: debugInfo.bufferSeconds,
        source: debugInfo.bufferSource
      });
      
      // Return comprehensive debug information
      return res.json({
        success: true,
        phone: debugInfo.phone,
        currentStepId: debugInfo.currentStepId,
        currentStepName: debugInfo.currentStepName,
        bufferSeconds: debugInfo.bufferSeconds,
        bufferMs: debugInfo.bufferMs,
        bufferSource: debugInfo.bufferSource,
        allSteps: debugInfo.allSteps,
        leadId: debugInfo.leadId,
        conversationId: debugInfo.conversationId,
        chatbotStateId: debugInfo.chatbotStateId,
        message: message || null
      });
      
    } catch (error) {
      console.error('[TEST-BUFFER] ❌ Error:', error);
      return res.status(500).json({
        error: 'Server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  });

  // Apply authentication middleware to all protected API routes
  app.use('/api/leads', requireAuth);
  app.use('/api/conversations', requireAuth);
  app.use('/api/documents', requireAuth);
  app.use('/api/dashboard', requireAuth);
  app.use('/api/audit-logs', requireAuth);
  app.use('/api/workflows', requireAuth);
  app.use('/api/settings', requireAuth);
  app.use('/api/chatbot', requireAuth);

  // Lead endpoints
  app.get('/api/leads', async (req: Request, res: Response) => {
    try {
      const filters = {
        status: req.query.status as string,
        priority: req.query.priority as string,
        assignedTo: req.query.assignedTo as string,
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined
      };

      console.log('Fetching leads with filters:', filters);
      const leads = await storage.getLeads(filters);
      console.log(`Found ${leads.length} leads`);
      res.json(leads);
    } catch (error) {
      console.error('Error fetching leads:', error);
      res.status(500).json({ error: 'Failed to fetch leads' });
    }
  });

  // POST endpoint to create a new lead
  app.post('/api/leads', async (req: Request, res: Response) => {
    try {
      // Validate request body with Zod
      const leadDataSchema = z.object({
        name: z.string().min(1, 'Name is required'),
        whatsappPhone: z.string().min(10, 'WhatsApp phone must be at least 10 characters'),
        cpf: z.string().length(11, 'CPF must be 11 digits').optional(),
        email: z.string().email('Invalid email format').optional()
      });

      const validatedData = leadDataSchema.parse(req.body);
      
      // Generate unique protocol in YYYY-NNN format
      const year = new Date().getFullYear();
      
      // Get the count of leads created this year to generate the next sequential number
      const allLeads = await storage.getLeads({});
      const currentYearLeads = allLeads.filter(lead => 
        lead.protocol && lead.protocol.startsWith(`${year}-`)
      );
      
      // Find the highest protocol number for this year
      let nextNumber = 1;
      if (currentYearLeads.length > 0) {
        const protocolNumbers = currentYearLeads
          .map(lead => {
            const match = lead.protocol.match(/^\d{4}-(\d{3})$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(num => num > 0);
        
        if (protocolNumbers.length > 0) {
          nextNumber = Math.max(...protocolNumbers) + 1;
        }
      }
      
      // Format protocol as YYYY-NNN (e.g., 2025-001)
      const protocol = `${year}-${String(nextNumber).padStart(3, '0')}`;
      
      console.log(`Creating new lead with protocol: ${protocol}`);
      
      // Create the lead with the generated protocol
      const newLead = await storage.createLead({
        ...validatedData,
        protocol,
        status: 'novo',
        priority: 'normal'
      });
      
      // Create audit log for lead creation
      await storage.createAuditLog({
        protocol: newLead.protocol,
        action: 'lead_created',
        entityType: 'lead',
        entityId: newLead.id,
        newData: newLead,
        userId: req.body.userId || 'system'
      });
      
      console.log(`Successfully created lead with ID: ${newLead.id}, Protocol: ${newLead.protocol}`);
      res.status(201).json(newLead);
    } catch (error) {
      console.error('Error creating lead:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: 'Invalid data', 
          details: error.errors 
        });
      }
      res.status(500).json({ error: 'Failed to create lead' });
    }
  });

  app.get('/api/leads/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
      }

      const leads = await storage.searchLeads(query);
      res.json(leads);
    } catch (error) {
      console.error('Error searching leads:', error);
      res.status(500).json({ error: 'Failed to search leads' });
    }
  });

  app.get('/api/leads/:id', async (req: Request, res: Response) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Get related data
      const conversations = await storage.getConversations({ leadId: lead.id });
      const documents = await storage.getDocuments(lead.id);
      const vehicles = await storage.getVehicles(lead.id);
      const quotes = await storage.getQuotes(lead.id);

      res.json({
        ...lead,
        conversations,
        documents,
        vehicles,
        quotes
      });
    } catch (error) {
      console.error('Error fetching lead:', error);
      res.status(500).json({ error: 'Failed to fetch lead' });
    }
  });

  // Get vehicle data from chatbot state for a lead
  app.get('/api/leads/:id/vehicle-data', async (req: Request, res: Response) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Get the conversation for this lead
      const conversations = await storage.getConversations({ leadId: lead.id });
      if (!conversations || conversations.length === 0) {
        return res.json({ dadosVeiculo: null });
      }

      // Get the most recent conversation
      const conversation = conversations[0];
      
      // Get the chatbot state for this conversation
      const chatbotState = await storage.getChatbotState(conversation.id);
      if (!chatbotState || !chatbotState.collectedData) {
        return res.json({ dadosVeiculo: null });
      }

      // Return the vehicle data from collected data
      const collectedData = chatbotState.collectedData as any;
      return res.json({ 
        dadosVeiculo: collectedData.dadosVeiculo || null,
        // Include other relevant vehicle-related data if available
        veiculoComCliente: collectedData.veiculoComCliente,
        tipoSeguro: collectedData.tipoSeguro
      });
    } catch (error) {
      console.error('Error fetching vehicle data:', error);
      res.status(500).json({ error: 'Failed to fetch vehicle data' });
    }
  });

  // Update vehicle data in chatbot state
  app.post('/api/chatbot/update-vehicle-data', async (req: Request, res: Response) => {
    try {
      const { phone, vehicleData } = req.body;
      
      if (!phone || !vehicleData) {
        return res.status(400).json({ error: 'Phone and vehicle data are required' });
      }
      
      // Get chatbot state for this phone
      const chatbotState = await storage.getChatbotStateByPhone(phone);
      if (!chatbotState) {
        return res.status(404).json({ error: 'Chatbot state not found for this phone' });
      }
      
      // Update vehicle data in collected data
      const collectedData = chatbotState.collectedData as any || {};
      collectedData.dadosVeiculo = {
        ...(collectedData.dadosVeiculo || {}),
        ...vehicleData
      };
      
      // Update chatbot state
      await storage.updateChatbotState(chatbotState.id, {
        collectedData
      });
      
      res.json({ success: true, message: 'Vehicle data updated successfully' });
    } catch (error) {
      console.error('Error updating vehicle data:', error);
      res.status(500).json({ error: 'Failed to update vehicle data' });
    }
  });

  // Get WhatsApp documents from conversation messages
  app.get('/api/leads/:id/whatsapp-documents', async (req: Request, res: Response) => {
    try {
      const leadId = req.params.id;
      
      // Get lead details
      const lead = await storage.getLead(leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      // Get all conversations for this lead
      const conversations = await storage.getConversations({ leadId: lead.id });
      if (!conversations || conversations.length === 0) {
        return res.json({ documents: [] });
      }
      
      // Get all messages from all conversations
      const allDocuments: any[] = [];
      
      for (const conversation of conversations) {
        const messages = await storage.getMessages(conversation.id);
        
        // Filter for document/media messages from customer (not from bot)
        const documentMessages = messages.filter((msg: Message) => 
          !msg.isBot && 
          (msg.messageType === 'document' || 
           msg.messageType === 'image' || 
           msg.messageType === 'media')
        );
        
        // Convert to document format
        for (const msg of documentMessages) {
          const metadata = msg.metadata as any;
          allDocuments.push({
            id: msg.id,
            filename: metadata?.filename || metadata?.caption || `${msg.messageType}_${msg.id}`,
            type: msg.messageType,
            uploadedAt: msg.timestamp,
            messageId: metadata?.messageId || msg.id,
            mimeType: metadata?.mimetype || null,
            mediaUrl: metadata?.mediaUrl || metadata?.url || null,
            size: metadata?.size || null
          });
        }
      }
      
      // Sort by upload date (newest first)
      allDocuments.sort((a, b) => 
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      
      res.json({ documents: allDocuments });
    } catch (error) {
      console.error('Error fetching WhatsApp documents:', error);
      res.status(500).json({ error: 'Failed to fetch WhatsApp documents' });
    }
  });

  // Download WhatsApp document
  app.get('/api/leads/:leadId/documents/:messageId/download', async (req: Request, res: Response) => {
    try {
      const { leadId, messageId } = req.params;
      console.log('[DOWNLOAD] Attempting to download WhatsApp document:', { leadId, messageId });
      
      // Get lead details
      const lead = await storage.getLead(leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      // Find the document in conversation messages
      const conversations = await storage.getConversations({ leadId: lead.id });
      let documentInfo: any = null;
      let docMessage: Message | null = null;
      let conversationId: string | null = null;
      
      for (const conversation of conversations) {
        const messages = await storage.getMessages(conversation.id);
        const foundMessage = messages.find((msg: any) => 
          (msg.id === messageId || (msg.metadata as any)?.messageId === messageId) &&
          (msg.messageType === 'document' || msg.messageType === 'image' || msg.messageType === 'media')
        );
        
        if (foundMessage) {
          docMessage = foundMessage;
          conversationId = conversation.id;
          const metadata = foundMessage.metadata as any;
          documentInfo = {
            filename: metadata?.filename || metadata?.caption || `document_${messageId}`,
            mimeType: metadata?.mimetype || 'application/octet-stream',
            mediaUrl: metadata?.mediaUrl || metadata?.url,
            messageId: metadata?.messageId || messageId,
            storagePath: metadata?.storagePath || null
          };
          break;
        }
      }
      
      if (!documentInfo) {
        console.log('[DOWNLOAD] Document not found in messages');
        return res.status(404).json({ error: 'Document not found' });
      }
      
      console.log('[DOWNLOAD] Document info found:', documentInfo);
      
      let fileBuffer: Buffer | null = null;
      
      // Step 1: Try downloading from Local Storage (cache)
      if (documentInfo.storagePath) {
        console.log('[DOWNLOAD] ☁️ Attempting to download from Local Storage cache:', documentInfo.storagePath);
        try {
          fileBuffer = await localStorage.downloadDocument(documentInfo.storagePath);
          console.log('[DOWNLOAD] ✅ Successfully downloaded from Local Storage cache, size:', fileBuffer.length);
        } catch (storageError) {
          console.log('[DOWNLOAD] ⚠️ Failed to download from Local Storage cache, will try WAHA API:', storageError);
          fileBuffer = null;
        }
      } else {
        console.log('[DOWNLOAD] No Local Storage cache path found, will try WAHA API');
      }
      
      // Step 2: If not in Local Storage, try downloading from WAHA API
      if (!fileBuffer) {
        console.log('[DOWNLOAD] 📥 Attempting to download from WAHA API');
        const wahaDownloadAPI = new WAHAService();
        fileBuffer = await wahaDownloadAPI.downloadMedia(documentInfo.messageId, documentInfo.mediaUrl);
        
        if (!fileBuffer) {
          console.log('[DOWNLOAD] ❌ Failed to download file from WAHA API');
          return res.status(404).json({ error: 'File not available for download' });
        }
        
        console.log('[DOWNLOAD] ✅ File downloaded from WAHA API, size:', fileBuffer.length);
        
        // Step 3: Save to Local Storage for future downloads (if not already cached)
        if (!documentInfo.storagePath) {
          try {
            console.log('[DOWNLOAD] ☁️ Saving to Local Storage cache for future downloads');
            const storagePath = await localStorage.uploadDocument(
              fileBuffer,
              documentInfo.filename,
              leadId,
              documentInfo.mimeType
            );
            
            console.log('[DOWNLOAD] ✅ Successfully cached in Local Storage:', storagePath);
            
            // Update message metadata with storage path
            if (docMessage) {
              const updatedMetadata = {
                ...(docMessage.metadata as any),
                storagePath: storagePath
              };
              
              // Import db and messages at the top if not already imported
              const { db } = await import('./db');
              const { messages: messagesTable } = await import('@shared/schema');
              const { eq } = await import('drizzle-orm');
              
              await db.update(messagesTable)
                .set({ metadata: updatedMetadata })
                .where(eq(messagesTable.id, docMessage.id));
              
              console.log('[DOWNLOAD] 📝 Updated message metadata with storage path');
            }
          } catch (storageError) {
            console.error('[DOWNLOAD] ⚠️ Failed to cache in Local Storage (non-fatal):', storageError);
          }
        }
      }
      
      // Set appropriate headers for file download
      res.setHeader('Content-Type', documentInfo.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${documentInfo.filename}"`);
      res.setHeader('Content-Length', fileBuffer.length.toString());
      
      // Send the file
      res.send(fileBuffer);
    } catch (error) {
      console.error('[DOWNLOAD] Error downloading WhatsApp document:', error);
      res.status(500).json({ error: 'Failed to download document' });
    }
  });

  // Update lead whatsapp phone (fix incorrect phone numbers)
  app.patch('/api/leads/:id/whatsapp', async (req: Request, res: Response) => {
    try {
      const leadId = req.params.id;
      const { whatsappPhone } = req.body;

      if (!whatsappPhone || typeof whatsappPhone !== 'string') {
        return res.status(400).json({ error: 'whatsappPhone is required and must be a string' });
      }

      // Clean the phone number (remove non-digits)
      const cleanPhone = whatsappPhone.replace(/\D/g, '');
      
      if (cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({ error: 'Invalid phone number length' });
      }

      const updatedLead = await storage.updateLead(leadId, { whatsappPhone: cleanPhone });
      if (!updatedLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      console.log(`[API] Updated lead ${leadId} whatsappPhone: ${cleanPhone}`);
      res.json({ success: true, lead: updatedLead });
    } catch (error) {
      console.error('Error updating lead whatsapp phone:', error);
      res.status(500).json({ error: 'Failed to update whatsapp phone' });
    }
  });

  app.post('/api/leads/:id/update', async (req: Request, res: Response) => {
    try {
      const leadId = req.params.id;
      const updateData = req.body;

      // Validate update data against schema
      const validatedData = insertLeadSchema.partial().parse(updateData);

      const updatedLead = await storage.updateLead(leadId, validatedData);
      if (!updatedLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Create audit log
      await storage.createAuditLog({
        protocol: updatedLead.protocol,
        action: 'lead_updated',
        entityType: 'lead',
        entityId: leadId,
        newData: validatedData,
        userId: req.body.userId || 'system'
      });

      res.json(updatedLead);
    } catch (error) {
      console.error('Error updating lead:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid data', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update lead' });
    }
  });

  // Analyze conversation for data inconsistencies
  app.post('/api/leads/:id/analyze-conversation', async (req: Request, res: Response) => {
    try {
      const leadId = req.params.id;
      
      // Get lead
      const lead = await storage.getLead(leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Get conversations
      const conversations = await storage.getConversations({ leadId: lead.id });
      if (!conversations || conversations.length === 0) {
        return res.json({ corrections: [], message: 'No conversation found for this lead' });
      }

      // Get all messages from all conversations
      const allMessages: any[] = [];
      for (const conversation of conversations) {
        const messages = await storage.getMessages(conversation.id, 1000);
        allMessages.push(...messages);
      }

      // Filter only customer messages (not bot)
      const customerMessages = allMessages
        .filter(msg => !msg.isBot)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (customerMessages.length === 0) {
        return res.json({ corrections: [], message: 'No customer messages found' });
      }

      // Build conversation text
      const conversationText = customerMessages
        .map(msg => `[${new Date(msg.timestamp).toLocaleString('pt-BR')}] Cliente: ${msg.content}`)
        .join('\n');

      // Get vehicle data from chatbot state
      const conversation = conversations[0];
      const chatbotState = await storage.getChatbotState(conversation.id);
      const collectedData = chatbotState?.collectedData as any || {};
      const vehicleData = collectedData.dadosVeiculo || {};

      // Get vehicles from database
      const vehicles = await storage.getVehicles(lead.id);
      const vehicle = vehicles.length > 0 ? vehicles[0] : null;

      // Use OpenAI to analyze conversation
      const systemPrompt = `Você é um assistente especializado em analisar conversas de WhatsApp e identificar inconsistências nos dados coletados.

Sua tarefa é analisar a conversa abaixo e identificar:

1. DATA DE NASCIMENTO: Se o lead mencionou sua data de nascimento na conversa, mas o campo "birthDate" não foi registrado ou está vazio.
2. CARRO RESERVA: Se o lead foi perguntado "Deseja carro reserva? Se sim, por quantos dias?" e respondeu indicando que DESEJA carro reserva com número de dias (ex: "7 dias", "15", "30 dias", "sim, 7 dias"), mas o campo está marcado como "não desejo" ou vazio.

DADOS ATUAIS DO LEAD:
- Data de Nascimento registrada: ${lead.birthDate ? new Date(lead.birthDate).toLocaleDateString('pt-BR') : 'NÃO REGISTRADA'}
- Carro Reserva registrado: ${vehicle?.reserveCar || vehicleData?.carroReserva || 'NÃO REGISTRADO'}

IMPORTANTE:
- Retorne APENAS um JSON array com as correções necessárias
- Cada correção deve ter: { "field": "nome_do_campo", "currentValue": "valor_atual", "suggestedValue": "valor_sugerido", "reason": "explicação" }
- Para birthDate, use formato ISO (YYYY-MM-DD)
- Para reserveCar, se o lead disse que quer, preencha com "sim, X dias" onde X é o número de dias mencionado
- Se não encontrar inconsistências, retorne array vazio []
- NÃO adicione correções se os dados já estão corretos

Retorne APENAS o JSON array, sem texto adicional.`;

      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `CONVERSA:\n${conversationText}` }
        ],
        temperature: 0.1,
        max_tokens: 1000
      });

      const analysisResult = response.choices[0]?.message?.content?.trim() || '[]';
      let corrections = [];
      
      try {
        corrections = JSON.parse(analysisResult);
      } catch (e) {
        console.error('Error parsing OpenAI response:', e);
        return res.status(500).json({ error: 'Failed to parse analysis result' });
      }

      res.json({ 
        corrections,
        leadProtocol: lead.protocol,
        analyzedMessages: customerMessages.length
      });
    } catch (error) {
      console.error('Error analyzing conversation:', error);
      res.status(500).json({ error: 'Failed to analyze conversation' });
    }
  });

  // Apply corrections to lead data
  app.post('/api/leads/:id/apply-corrections', async (req: Request, res: Response) => {
    try {
      const leadId = req.params.id;
      const { corrections } = req.body;

      if (!corrections || !Array.isArray(corrections)) {
        return res.status(400).json({ error: 'Corrections array is required' });
      }

      // Get lead
      const lead = await storage.getLead(leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      const updates: any = {};
      const vehicleUpdates: any = {};

      // Process each correction
      for (const correction of corrections) {
        if (correction.field === 'birthDate') {
          updates.birthDate = new Date(correction.suggestedValue);
        } else if (correction.field === 'reserveCar') {
          vehicleUpdates.reserveCar = correction.suggestedValue;
        }
      }

      // Update lead if there are updates
      if (Object.keys(updates).length > 0) {
        await storage.updateLead(leadId, updates);
        
        // Create audit log
        await storage.createAuditLog({
          protocol: lead.protocol,
          action: 'lead_corrected',
          entityType: 'lead',
          entityId: leadId,
          previousData: { birthDate: lead.birthDate },
          newData: updates,
          userId: req.body.userId || 'system'
        });
      }

      // Update vehicle if there are vehicle updates
      if (Object.keys(vehicleUpdates).length > 0) {
        const vehicles = await storage.getVehicles(lead.id);
        if (vehicles.length > 0) {
          await storage.updateVehicle(vehicles[0].id, vehicleUpdates);
          
          // Create audit log
          await storage.createAuditLog({
            protocol: lead.protocol,
            action: 'vehicle_corrected',
            entityType: 'vehicle',
            entityId: vehicles[0].id,
            previousData: { reserveCar: vehicles[0].reserveCar },
            newData: vehicleUpdates,
            userId: req.body.userId || 'system'
          });
        } else {
          // Create new vehicle if none exists
          await storage.createVehicle({
            leadId: lead.id,
            ...vehicleUpdates
          });
          
          // Create audit log
          await storage.createAuditLog({
            protocol: lead.protocol,
            action: 'vehicle_created',
            entityType: 'vehicle',
            entityId: lead.id,
            newData: vehicleUpdates,
            userId: req.body.userId || 'system'
          });
        }
      }

      res.json({ 
        success: true, 
        message: 'Corrections applied successfully',
        appliedCorrections: corrections.length
      });
    } catch (error) {
      console.error('Error applying corrections:', error);
      res.status(500).json({ error: 'Failed to apply corrections' });
    }
  });

  // Clear all leads and their history with password validation
  app.post('/api/leads/clear-all', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      const masterPassword = process.env.SENHAPRINCIPAL;

      if (!masterPassword) {
        console.error('[API] SENHAPRINCIPAL not configured');
        return res.status(500).json({ error: 'Senha principal não configurada' });
      }

      if (!password || password !== masterPassword) {
        console.log('[API] Invalid password attempt for clear-all');
        return res.status(401).json({ error: 'Senha incorreta' });
      }

      console.log('[API] Clearing all leads and conversation history...');
      const result = await storage.clearAllLeads();
      console.log(`[API] Successfully cleared ${result.count} leads and all related data`);
      res.json({ 
        success: true, 
        message: `Removidos ${result.count} leads e todo o histórico de conversas`,
        count: result.count 
      });
    } catch (error) {
      console.error('[API] Error clearing leads:', error);
      res.status(500).json({ error: 'Falha ao limpar leads' });
    }
  });

  // Legacy DELETE endpoint for backward compatibility (deprecated)
  app.delete('/api/leads/clear-all', async (req: Request, res: Response) => {
    try {
      console.log('[API] Clearing all leads and conversation history...');
      const result = await storage.clearAllLeads();
      console.log(`[API] Successfully cleared ${result.count} leads and all related data`);
      res.json({ 
        success: true, 
        message: `Removidos ${result.count} leads e todo o histórico de conversas`,
        count: result.count 
      });
    } catch (error) {
      console.error('[API] Error clearing leads:', error);
      res.status(500).json({ error: 'Falha ao limpar leads' });
    }
  });

  // Conversation endpoints
  app.get('/api/conversations', async (req: Request, res: Response) => {
    try {
      const filters = {
        status: req.query.status as string,
        leadId: req.query.leadId as string,
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined
      };

      const conversations = await storage.getConversations(filters);
      
      // Enrich with lead data
      const enrichedConversations = await Promise.all(
        conversations.map(async (conv) => {
          const lead = await storage.getLead(conv.leadId);
          return {
            ...conv,
            lead
          };
        })
      );

      res.json(enrichedConversations);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  });

  app.get('/api/conversations/:id/messages', async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.id;
      const limit = parseInt(req.query.limit as string) || 100;

      const messages = await storage.getMessages(conversationId, limit);
      res.json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post('/api/conversations/:id/send', async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.id;
      const { message, type = 'text' } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Get conversation and lead
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const lead = await storage.getLead(conversation.leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Send message via WAHA API
      let result;
      if (type === 'text') {
        result = await wahaAPI.sendText(lead.whatsappPhone, message, conversationId);
      } else {
        return res.status(400).json({ error: 'Unsupported message type' });
      }

      // Store message in database
      const storedMessage = await storage.createMessage({
        conversationId,
        content: message,
        isBot: true,
        messageType: type,
        metadata: { manual: true, sentBy: req.body.userId || 'agent' }
      });
      
      // Broadcast manual message
      try {
        broadcastNewMessage(conversationId, storedMessage);
        console.log(`[API] 📡 Broadcast: manual message sent for conversation ${conversationId}`);
      } catch (broadcastError) {
        console.error('[API] ❌ Broadcast failed (non-fatal):', broadcastError);
      }

      // PERMANENTLY DISABLE CHATBOT when manual message is sent
      const chatbotState = await storage.getChatbotState(conversationId);
      if (chatbotState) {
        // Mark as permanently handed off
        await storage.updateChatbotState(chatbotState.id, {
          isPermanentHandoff: true
        });
        
        console.log(`[API] 🔇 Mensagem manual enviada. Bot PERMANENTEMENTE desativado para lead ${lead.protocol}`);
        
        // Store system message about the permanent handoff
        const systemHandoffMessage = await storage.createMessage({
          conversationId,
          content: `[SISTEMA] Mensagem manual enviada pelo dashboard. Bot permanentemente desativado para este lead.`,
          isBot: true,
          messageType: 'system',
          metadata: { 
            handoffType: 'permanent',
            handoffReason: 'manual_message_sent',
            handoffTime: new Date().toISOString()
          }
        });
        
        // Broadcast system handoff message
        try {
          broadcastNewMessage(conversationId, systemHandoffMessage);
          console.log(`[API] 📡 Broadcast: system handoff message sent for conversation ${conversationId}`);
        } catch (broadcastError) {
          console.error('[API] ❌ Broadcast failed (non-fatal):', broadcastError);
        }
        
        // Broadcast conversation update for handoff
        try {
          const updatedConversation = await storage.getConversation(conversationId);
          if (updatedConversation) {
            broadcastConversationUpdate(conversationId, updatedConversation);
            console.log(`[API] 📡 Broadcast: conversation update sent for ${conversationId}`);
          }
        } catch (broadcastError) {
          console.error('[API] ❌ Conversation update broadcast failed (non-fatal):', broadcastError);
        }
      }

      res.json({
        message: storedMessage,
        wahaResult: result,
        botPermanentlyDisabled: true
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // Send file/document in conversation
  app.post('/api/conversations/:id/send-file', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.id;
      
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Get conversation and lead
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const lead = await storage.getLead(conversation.leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Create public URL for the file using Replit domain
      const domain = process.env.REPLIT_DEV_DOMAIN || req.get('host') || 'localhost:3000';
      const fileUrl = `https://${domain}/uploads/${req.file.filename}`;
      
      // Get caption from request body (sent by frontend)
      // If user typed text, use it; otherwise use filename
      const userCaption = req.body.caption || req.file.originalname;
      
      // Determine if file is an image or document
      const isImage = req.file.mimetype.startsWith('image/');
      const messageType = isImage ? 'image' : 'document';
      
      // For images: only send caption if it's different from filename
      // This way images without text appear clean in WhatsApp
      const shouldSendCaption = !isImage || (userCaption !== req.file.originalname);
      const caption = shouldSendCaption ? userCaption : '';
      
      console.log(`[API] 📁 File uploaded: ${req.file.originalname} (type: ${messageType})`);
      console.log(`[API] 📍 Public URL: ${fileUrl}`);
      console.log(`[API] 📝 User Caption: ${userCaption}`);
      console.log(`[API] 📝 Caption to send: ${caption}`);
      console.log(`[API] 🎨 MIME Type: ${req.file.mimetype}`);

      // Send file via WAHA API - use appropriate method based on file type
      let result;
      if (isImage) {
        result = await wahaAPI.sendImage(lead.whatsappPhone, fileUrl, caption, req.file.originalname, req.file.mimetype);
      } else {
        result = await wahaAPI.sendDocument(lead.whatsappPhone, fileUrl, caption, req.file.originalname, req.file.mimetype);
      }

      // Store message in database
      const storedMessage = await storage.createMessage({
        conversationId,
        content: caption,
        isBot: true,
        messageType,
        metadata: { 
          manual: true, 
          sentBy: req.body.userId || 'agent',
          filename: req.file.originalname,
          fileUrl,
          mimeType: req.file.mimetype,
          size: req.file.size
        }
      });
      
      // Broadcast file message
      try {
        broadcastNewMessage(conversationId, storedMessage);
        console.log(`[API] 📡 Broadcast: file message sent for conversation ${conversationId}`);
      } catch (broadcastError) {
        console.error('[API] ❌ Broadcast failed (non-fatal):', broadcastError);
      }

      // PAUSE CHATBOT for 24 hours when manual message is sent
      const chatbotState = await storage.getChatbotState(conversationId);
      if (chatbotState) {
        const handoffUntil = new Date();
        handoffUntil.setHours(handoffUntil.getHours() + 24);
        
        await storage.updateChatbotState(chatbotState.id, {
          handoffUntil
        });
        
        console.log(`[API] 🔇 Arquivo enviado manualmente. Bot pausado até ${handoffUntil.toISOString()} para lead ${lead.protocol}`);
        
        // Broadcast conversation update for pause
        try {
          const updatedConversation = await storage.getConversation(conversationId);
          if (updatedConversation) {
            broadcastConversationUpdate(conversationId, updatedConversation);
            console.log(`[API] 📡 Broadcast: conversation update sent for ${conversationId} (bot paused)`);
          }
        } catch (broadcastError) {
          console.error('[API] ❌ Conversation update broadcast failed (non-fatal):', broadcastError);
        }
      }

      res.json({
        message: storedMessage,
        wahaResult: result,
        botPaused: true,
        pausedUntil: chatbotState ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null
      });
    } catch (error) {
      console.error('Error sending file:', error);
      res.status(500).json({ error: 'Failed to send file' });
    }
  });

  // Document endpoints
  app.post('/api/documents/upload', upload.single('document'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { leadId, type } = req.body;
      if (!leadId || !type) {
        return res.status(400).json({ error: 'leadId and type are required' });
      }

      console.log('[UPLOAD] Uploading document to Local Storage:', req.file.originalname);

      // Upload file to Local Storage
      const storagePath = await localStorage.uploadDocument(
        req.file.buffer,
        req.file.originalname,
        leadId,
        req.file.mimetype
      );

      console.log('[UPLOAD] Document uploaded to Local Storage:', storagePath);

      // Store document info in database with storage path
      const document = await storage.createDocument({
        leadId,
        filename: req.file.originalname,
        type: type as any,
        url: storagePath, // Store storage path
        mimeType: req.file.mimetype,
        size: req.file.size
      });

      // Create audit log
      const lead = await storage.getLead(leadId);
      if (lead) {
        await storage.createAuditLog({
          protocol: lead.protocol,
          action: 'document_uploaded',
          entityType: 'document',
          entityId: document.id,
          newData: { filename: req.file.originalname, type },
          userId: req.body.userId || 'system'
        });
      }

      res.json(document);
    } catch (error) {
      console.error('Error uploading document:', error);
      res.status(500).json({ error: 'Failed to upload document' });
    }
  });

  app.get('/api/documents/:id/download', async (req: Request, res: Response) => {
    try {
      const documentId = req.params.id;
      
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      console.log('[DOWNLOAD] Downloading document from Local Storage:', document.url);

      // Download file from Local Storage
      const fileBuffer = await localStorage.downloadDocument(document.url);

      // Set headers for download
      res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
      res.setHeader('Content-Length', fileBuffer.length.toString());
      
      // Send file buffer
      res.send(fileBuffer);
    } catch (error) {
      console.error('Error downloading document:', error);
      res.status(500).json({ error: 'Failed to download document' });
    }
  });

  app.delete('/api/documents/:id', async (req: Request, res: Response) => {
    try {
      const documentId = req.params.id;
      
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      await storage.deleteDocument(documentId);

      // Create audit log
      const lead = await storage.getLead(document.leadId);
      if (lead) {
        await storage.createAuditLog({
          protocol: lead.protocol,
          action: 'document_deleted',
          entityType: 'document',
          entityId: documentId,
          previousData: document,
          userId: req.body.userId || 'system'
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // Dashboard stats
  app.get('/api/dashboard/stats', async (req: Request, res: Response) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
  });

  // Audit logs
  app.get('/api/audit-logs', async (req: Request, res: Response) => {
    try {
      const protocol = req.query.protocol as string;
      const logs = await storage.getAuditLogs(protocol);
      res.json(logs);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  // Workflow Templates
  app.get('/api/workflows', async (req: Request, res: Response) => {
    try {
      const { status, category, isActive } = req.query;
      const workflows = await storage.getWorkflowTemplates({
        status: status as string,
        category: category as string,
        isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined
      });
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching workflows:', error);
      res.status(500).json({ error: 'Failed to fetch workflows' });
    }
  });

  app.get('/api/workflows/:id', async (req: Request, res: Response) => {
    try {
      const workflow = await storage.getWorkflowTemplate(req.params.id);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      res.json(workflow);
    } catch (error) {
      console.error('Error fetching workflow:', error);
      res.status(500).json({ error: 'Failed to fetch workflow' });
    }
  });

  // Validate password for workflow editing
  app.post('/api/workflows/validate-password', async (req: Request, res: Response) => {
    try {
      const passwordSchema = z.object({
        password: z.string().min(1, 'Password is required')
      });

      const { password } = passwordSchema.parse(req.body);
      const correctPassword = process.env.SENHA;

      if (!correctPassword) {
        console.error('[SECURITY] SENHA environment variable not configured');
        return res.status(500).json({ 
          error: 'Server configuration error',
          message: 'Password authentication not configured'
        });
      }

      const isValid = password === correctPassword;

      // Log failed attempts for security
      if (!isValid) {
        logSecurityEvent('WORKFLOW_PASSWORD_FAILED', {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: new Date().toISOString()
        });
      }

      res.json({ valid: isValid });
    } catch (error) {
      console.error('Error validating password:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid data',
          details: error.errors
        });
      }
      res.status(500).json({ error: 'Failed to validate password' });
    }
  });

  app.put('/api/workflows/:id', async (req: Request, res: Response) => {
    try {
      // Zod validation schema for workflow update (now requires password)
      const updateWorkflowSchema = z.object({
        content: z.string().min(1, 'Content cannot be empty'),
        name: z.string().min(1, 'Name is required').optional(),
        description: z.string().optional(),
        updatedBy: z.string().optional(),
        password: z.string().min(1, 'Password is required for updating workflows')
      });

      // Validate request body
      const validatedData = updateWorkflowSchema.parse(req.body);
      const { content, name, description, updatedBy, password } = validatedData;

      // Validate password before allowing update
      const correctPassword = process.env.SENHA;
      if (!correctPassword) {
        console.error('[SECURITY] SENHA environment variable not configured');
        return res.status(500).json({ 
          error: 'Server configuration error',
          message: 'Password authentication not configured'
        });
      }

      if (password !== correctPassword) {
        logSecurityEvent('WORKFLOW_UPDATE_UNAUTHORIZED', {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          workflowId: req.params.id,
          timestamp: new Date().toISOString()
        });
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'Senha incorreta'
        });
      }

      // Get existing workflow to check required variables and track changes
      const existingWorkflow = await storage.getWorkflowTemplate(req.params.id);
      if (!existingWorkflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      // Validate required variables are present in content
      if (existingWorkflow.requiredVariables && existingWorkflow.requiredVariables.length > 0) {
        const missingVariables: string[] = [];
        existingWorkflow.requiredVariables.forEach(variable => {
          if (!content.includes(variable)) {
            missingVariables.push(variable);
          }
        });

        if (missingVariables.length > 0) {
          return res.status(400).json({
            error: 'Missing required variables',
            missingVariables: missingVariables
          });
        }
      }

      // Create version history before updating (only if content changed)
      if (existingWorkflow.content !== content) {
        await storage.createWorkflowVersion({
          templateId: req.params.id,
          version: existingWorkflow.version,
          content: existingWorkflow.content,
          status: existingWorkflow.status,
          changeDescription: 'Version saved before update',
          createdBy: updatedBy || 'system'
        });
      }

      // Update workflow template
      const updated = await storage.updateWorkflowTemplate(req.params.id, {
        content,
        name,
        description,
        updatedBy
      });
      
      if (!updated) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      // Invalidate ChatbotService cache so changes take effect immediately
      chatbotService.invalidateCache();

      // Create audit log
      await storage.createAuditLog({
        action: 'workflow_updated',
        entityType: 'workflow_template',
        entityId: req.params.id,
        newData: updated,
        userId: updatedBy || 'system'
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating workflow:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid data',
          details: error.errors
        });
      }
      res.status(500).json({ error: 'Failed to update workflow' });
    }
  });

  app.post('/api/workflows/:id/toggle', async (req: Request, res: Response) => {
    try {
      const { isActive, updatedBy } = req.body;

      // Get existing workflow to persist version
      const existingWorkflow = await storage.getWorkflowTemplate(req.params.id);
      if (!existingWorkflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      // Create version history before toggling status
      await storage.createWorkflowVersion({
        templateId: req.params.id,
        version: existingWorkflow.version,
        content: existingWorkflow.content,
        status: existingWorkflow.status,
        changeDescription: `Status toggled to ${isActive ? 'active' : 'inactive'}`,
        createdBy: updatedBy || 'system'
      });

      const updated = await storage.toggleWorkflowStatus(req.params.id, isActive);
      
      if (!updated) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      // Invalidate ChatbotService cache so changes take effect immediately
      chatbotService.invalidateCache();

      // Create audit log
      await storage.createAuditLog({
        action: isActive ? 'workflow_activated' : 'workflow_deactivated',
        entityType: 'workflow_template',
        entityId: req.params.id,
        newData: { isActive },
        userId: updatedBy || 'system'
      });

      res.json(updated);
    } catch (error) {
      console.error('Error toggling workflow:', error);
      res.status(500).json({ error: 'Failed to toggle workflow' });
    }
  });

  app.post('/api/workflows/:id/restore', async (req: Request, res: Response) => {
    try {
      const updated = await storage.restoreDefaultWorkflow(req.params.id);
      
      if (!updated) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      // Invalidate ChatbotService cache so changes take effect immediately
      chatbotService.invalidateCache();

      // Create audit log
      await storage.createAuditLog({
        action: 'workflow_restored',
        entityType: 'workflow_template',
        entityId: req.params.id,
        newData: updated,
        userId: req.body.updatedBy || 'system'
      });

      res.json(updated);
    } catch (error) {
      console.error('Error restoring workflow:', error);
      res.status(500).json({ error: 'Failed to restore workflow' });
    }
  });

  app.get('/api/workflows/:id/versions', async (req: Request, res: Response) => {
    try {
      const versions = await storage.getWorkflowVersions(req.params.id);
      res.json(versions);
    } catch (error) {
      console.error('Error fetching workflow versions:', error);
      res.status(500).json({ error: 'Failed to fetch workflow versions' });
    }
  });

  app.post('/api/workflows/:id/validate', async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      const workflow = await storage.getWorkflowTemplate(req.params.id);
      
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      const errors: string[] = [];
      
      // Validate required variables
      if (workflow.requiredVariables && workflow.requiredVariables.length > 0) {
        workflow.requiredVariables.forEach(variable => {
          if (!content.includes(variable)) {
            errors.push(`Variável obrigatória ausente: ${variable}`);
          }
        });
      }

      // Check if content is not empty
      if (!content || content.trim().length === 0) {
        errors.push('Conteúdo não pode estar vazio');
      }

      res.json({
        valid: errors.length === 0,
        errors
      });
    } catch (error) {
      console.error('Error validating workflow:', error);
      res.status(500).json({ error: 'Failed to validate workflow' });
    }
  });

  // System Settings endpoints
  app.get('/api/settings', async (req: Request, res: Response) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  });

  app.put('/api/settings', async (req: Request, res: Response) => {
    try {
      const validated = insertSystemSettingsSchema.parse(req.body);
      const updated = await storage.updateSystemSettings(validated);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error updating settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Flow AI Preview endpoint
  const flowStepPreviewSchema = z.object({
    promptGlobal: z.string().min(1, 'Prompt global é obrigatório'),
    etapaAtual: z.object({
      id: z.string().min(1, 'ID da etapa atual é obrigatório'),
      nome: z.string().min(1, 'Nome da etapa atual é obrigatório'),
      objetivo: z.string().min(1, 'Objetivo da etapa atual é obrigatório'),
      promptEtapa: z.string().min(1, 'Prompt da etapa atual é obrigatório'),
      instrucoesRoteamento: z.string().min(1, 'Instruções de roteamento são obrigatórias')
    }),
    etapasDefinidas: z.array(z.object({
      id: z.string().min(1, 'ID da etapa é obrigatório'),
      nome: z.string().min(1, 'Nome da etapa é obrigatório')
    })).min(1, 'Pelo menos uma etapa deve ser definida'),
    historicoConversaExemplo: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string()
    })).optional(),
    mensagemClienteExemplo: z.string().min(1, 'Mensagem de exemplo do cliente é obrigatória')
  });

  app.post('/api/ia/preview', requireAuth, async (req: Request, res: Response) => {
    try {
      const validatedData = flowStepPreviewSchema.parse(req.body);
      const response = await flowAIService.generateFlowStepPreview(validatedData);
      res.json(response);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: 'Dados inválidos',
          message: 'Os dados enviados não estão no formato esperado',
          details: error.errors 
        });
      }
      console.error('Error generating AI preview:', error);
      res.status(500).json({ error: error.message || 'Failed to generate AI preview' });
    }
  });

  // Flow Configuration endpoints
  app.get('/api/flows/active', requireAuth, async (req: Request, res: Response) => {
    try {
      const config = await storage.getActiveFlowConfig();
      if (!config) {
        return res.status(404).json({ error: 'No active flow configuration found' });
      }
      
      const keywords = await storage.getKeywordRules(config.id);
      const steps = await storage.getFlowSteps(config.id);
      
      res.json({
        ...config,
        keywords,
        steps
      });
    } catch (error) {
      console.error('Error fetching active flow config:', error);
      res.status(500).json({ error: 'Failed to fetch active flow configuration' });
    }
  });

  app.get('/api/flows/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const config = await storage.getFlowConfig(id);
      
      if (!config) {
        return res.status(404).json({ error: 'Flow configuration not found' });
      }
      
      const keywords = await storage.getKeywordRules(id);
      const steps = await storage.getFlowSteps(id);
      
      res.json({
        ...config,
        keywords,
        steps
      });
    } catch (error) {
      console.error('Error fetching flow config:', error);
      res.status(500).json({ error: 'Failed to fetch flow configuration' });
    }
  });

  app.post('/api/flows', requireAuth, async (req: Request, res: Response) => {
    try {
      const { keywords = [], steps = [], ...configData } = req.body;
      
      const validated = insertFlowConfigSchema.parse(configData);
      const config = await storage.createFlowConfig(validated);
      
      const createdKeywords = [];
      for (const keyword of keywords) {
        const validatedKeyword = insertKeywordRuleSchema.parse({
          ...keyword,
          flowConfigId: config.id
        });
        const created = await storage.createKeywordRule(validatedKeyword);
        createdKeywords.push(created);
      }
      
      const createdSteps = [];
      const normalizedSteps = normalizeFlowSteps(steps);
      for (const step of normalizedSteps) {
        const validatedStep = insertFlowStepSchema.parse({
          ...step,
          flowConfigId: config.id
        });
        const created = await storage.createFlowStep(validatedStep);
        createdSteps.push(created);
      }
      
      res.json({
        ...config,
        keywords: createdKeywords,
        steps: createdSteps
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error creating flow config:', error);
      res.status(500).json({ error: 'Failed to create flow configuration' });
    }
  });

  app.put('/api/flows/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { keywords, steps, ...configData } = req.body;
      
      if (Object.keys(configData).length > 0) {
        const validated = insertFlowConfigSchema.partial().parse(configData);
        await storage.updateFlowConfig(id, validated);
      }
      
      const config = await storage.getFlowConfig(id);
      if (!config) {
        return res.status(404).json({ error: 'Flow configuration not found' });
      }
      
      let updatedKeywords = await storage.getKeywordRules(id);
      let updatedSteps = await storage.getFlowSteps(id);
      
      // Update keywords if provided
      if (keywords && Array.isArray(keywords)) {
        // Delete existing keywords
        const existingKeywords = await storage.getKeywordRules(id);
        for (const keyword of existingKeywords) {
          await storage.deleteKeywordRule(keyword.id);
        }
        
        // Create new keywords
        updatedKeywords = [];
        for (const keyword of keywords) {
          const validatedKeyword = insertKeywordRuleSchema.parse({
            ...keyword,
            flowConfigId: id
          });
          const created = await storage.createKeywordRule(validatedKeyword);
          updatedKeywords.push(created);
        }
      }
      
      // Update steps if provided
      if (steps && Array.isArray(steps)) {
        // Delete existing steps
        const existingSteps = await storage.getFlowSteps(id);
        for (const step of existingSteps) {
          await storage.deleteFlowStep(step.id);
        }
        
        // Create new steps with position and transitions
        updatedSteps = [];
        const normalizedSteps = normalizeFlowSteps(steps);
        for (const step of normalizedSteps) {
          const validatedStep = insertFlowStepSchema.parse({
            ...step,
            flowConfigId: id
          });
          const created = await storage.createFlowStep(validatedStep);
          updatedSteps.push(created);
        }
      }
      
      res.json({
        ...config,
        keywords: updatedKeywords,
        steps: updatedSteps
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error updating flow config:', error);
      res.status(500).json({ error: 'Failed to update flow configuration' });
    }
  });

  app.post('/api/flows/:id/activate', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const config = await storage.setActiveFlowConfig(id);
      
      if (!config) {
        return res.status(404).json({ error: 'Flow configuration not found' });
      }
      
      res.json(config);
    } catch (error) {
      console.error('Error activating flow config:', error);
      res.status(500).json({ error: 'Failed to activate flow configuration' });
    }
  });

  // Keyword Rules endpoints
  app.post('/api/flows/:id/keywords', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validated = insertKeywordRuleSchema.parse({
        ...req.body,
        flowConfigId: id
      });
      
      const keyword = await storage.createKeywordRule(validated);
      res.json(keyword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error creating keyword rule:', error);
      res.status(500).json({ error: 'Failed to create keyword rule' });
    }
  });

  app.put('/api/flows/:id/keywords/:keywordId', requireAuth, async (req: Request, res: Response) => {
    try {
      const { keywordId } = req.params;
      const validated = insertKeywordRuleSchema.partial().parse(req.body);
      
      const keyword = await storage.updateKeywordRule(keywordId, validated);
      if (!keyword) {
        return res.status(404).json({ error: 'Keyword rule not found' });
      }
      
      res.json(keyword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error updating keyword rule:', error);
      res.status(500).json({ error: 'Failed to update keyword rule' });
    }
  });

  app.delete('/api/flows/:id/keywords/:keywordId', requireAuth, async (req: Request, res: Response) => {
    try {
      const { keywordId } = req.params;
      const deleted = await storage.deleteKeywordRule(keywordId);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Keyword rule not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting keyword rule:', error);
      res.status(500).json({ error: 'Failed to delete keyword rule' });
    }
  });

  // Flow Steps endpoints
  app.post('/api/flows/:id/steps', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validated = insertFlowStepSchema.parse({
        ...req.body,
        flowConfigId: id
      });
      
      const step = await storage.createFlowStep(validated);
      res.json(step);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error creating flow step:', error);
      res.status(500).json({ error: 'Failed to create flow step' });
    }
  });

  app.put('/api/flows/:id/steps/:stepId', requireAuth, async (req: Request, res: Response) => {
    try {
      const { stepId } = req.params;
      const validated = insertFlowStepSchema.partial().parse(req.body);
      
      const step = await storage.updateFlowStep(stepId, validated);
      if (!step) {
        return res.status(404).json({ error: 'Flow step not found' });
      }
      
      res.json(step);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error updating flow step:', error);
      res.status(500).json({ error: 'Failed to update flow step' });
    }
  });

  app.delete('/api/flows/:id/steps/:stepId', requireAuth, async (req: Request, res: Response) => {
    try {
      const { stepId } = req.params;
      const deleted = await storage.deleteFlowStep(stepId);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Flow step not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting flow step:', error);
      res.status(500).json({ error: 'Failed to delete flow step' });
    }
  });

  // Followup Message endpoints
  app.get('/api/followup-messages', requireAuth, async (req: Request, res: Response) => {
    try {
      const messages = await storage.getFollowupMessages();
      res.json(messages);
    } catch (error) {
      console.error('Error fetching followup messages:', error);
      res.status(500).json({ error: 'Failed to fetch followup messages' });
    }
  });

  app.get('/api/followup-messages/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const message = await storage.getFollowupMessage(id);
      
      if (!message) {
        return res.status(404).json({ error: 'Followup message not found' });
      }
      
      res.json(message);
    } catch (error) {
      console.error('Error fetching followup message:', error);
      res.status(500).json({ error: 'Failed to fetch followup message' });
    }
  });

  app.post('/api/followup-messages', requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = insertFollowupMessageSchema.parse(req.body);
      const message = await storage.createFollowupMessage(validated);
      res.json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error creating followup message:', error);
      res.status(500).json({ error: 'Failed to create followup message' });
    }
  });

  app.patch('/api/followup-messages/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validated = insertFollowupMessageSchema.partial().parse(req.body);
      
      const message = await storage.updateFollowupMessage(id, validated);
      if (!message) {
        return res.status(404).json({ error: 'Followup message not found' });
      }
      
      res.json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Error updating followup message:', error);
      res.status(500).json({ error: 'Failed to update followup message' });
    }
  });

  app.delete('/api/followup-messages/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteFollowupMessage(id);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Followup message not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting followup message:', error);
      res.status(500).json({ error: 'Failed to delete followup message' });
    }
  });

  // Trigger follow-up check manually (for testing)
  app.post('/api/followup-messages/trigger-check', requireAuth, async (req: Request, res: Response) => {
    try {
      await followupService.triggerCheck();
      res.json({ success: true, message: 'Follow-up check triggered successfully' });
    } catch (error) {
      console.error('Error triggering follow-up check:', error);
      res.status(500).json({ error: 'Failed to trigger follow-up check' });
    }
  });

  // Chatbot test endpoint - simulates incoming messages
  app.post('/api/chatbot/test-message', async (req: Request, res: Response) => {
    try {
      const { phone, message, instanceName } = req.body;
      
      if (!phone || !message) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          message: 'Phone and message are required' 
        });
      }

      // Use default instance if not provided
      const instance = instanceName || 'default';
      console.log(`[TEST-CHATBOT] Simulating message from ${phone} on instance ${instance}: ${message}`);
      
      // Process the message through the chatbot service
      await chatbotService.processIncomingMessage(
        phone,
        message,
        { 
          test: true,
          timestamp: new Date().toISOString(),
          source: 'test-interface'
        },
        instance
      );
      
      // Give the chatbot a moment to process and respond
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get the current state after processing
      const chatbotState = await storage.getChatbotStateByPhone(phone);
      
      res.json({ 
        success: true,
        message: 'Message processed',
        state: chatbotState?.currentState || 'initial',
        responses: [] // The actual responses are sent via WAHA API
      });
    } catch (error) {
      console.error('Error in test message endpoint:', error);
      res.status(500).json({ 
        error: 'Processing failed',
        message: error instanceof Error ? error.message : 'Failed to process test message'
      });
    }
  });

  // Get current chatbot state for a phone number
  app.get('/api/chatbot/state/:phone', async (req: Request, res: Response) => {
    try {
      const { phone } = req.params;
      const state = await storage.getChatbotStateByPhone(phone);
      
      res.json({
        currentState: state?.currentState || 'initial',
        collectedData: state?.collectedData || {}
      });
    } catch (error) {
      console.error('Error fetching chatbot state:', error);
      res.status(500).json({ 
        error: 'Failed to fetch state',
        message: error instanceof Error ? error.message : 'Failed to fetch chatbot state'
      });
    }
  });

  // WhatsApp Instances Management Endpoints
  app.post('/api/instancias', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Nome da instância é obrigatório' });
      }

      // Check if instance already exists in database
      const existingInstance = await storage.getInstance(name);
      if (existingInstance) {
        return res.status(400).json({ error: 'Instância já existe' });
      }

      // Create session in WAHA
      const wahaUrl = `${process.env.WAHA_API}/api/sessions`;
      const wahaResponse = await fetch(wahaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': process.env.WAHA_API_KEY || ''
        },
        body: JSON.stringify({
          name,
          config: {}
        })
      });

      if (!wahaResponse.ok) {
        const errorText = await wahaResponse.text();
        console.error('[WAHA] Error creating session:', errorText);
        return res.status(500).json({ error: 'Falha ao criar sessão no WAHA' });
      }

      const wahaData = await wahaResponse.json();
      console.log('[WAHA] Session created:', wahaData);
      
      // Use the session name returned by WAHA (may be normalized/different from requested name)
      const sessionName = wahaData.name;

      // Store instance in database
      const instance = await storage.createInstance({
        name: sessionName,
        status: wahaData.status || 'STARTING'
      });

      // Configure webhook, events and custom headers automatically
      console.log('[INSTANCE-CREATE] Configuring webhook, events and custom headers automatically...');
      
      // Build webhook URL using Replit public domain
      let domain: string;
      if (process.env.REPLIT_DEV_DOMAIN) {
        domain = `https://${process.env.REPLIT_DEV_DOMAIN}`;
      } else if (process.env.REPLIT_DOMAINS) {
        // REPLIT_DOMAINS may contain multiple domains separated by comma
        const firstDomain = process.env.REPLIT_DOMAINS.split(',')[0].trim();
        domain = `https://${firstDomain}`;
      } else {
        // Fallback to request host (for local development)
        domain = `${req.protocol}://${req.get('host')}`;
      }
      
      const webhookUrl = `${domain}/api/webhook/waha`;
      const webhooks = [webhookUrl];
      
      // Set mandatory events
      const events = ["message", "session.status"];
      
      // Set custom headers (X-Api-Key if available)
      const customHeaders: Record<string, string> = {};
      if (process.env.WAHA_API_KEY) {
        customHeaders['X-Api-Key'] = process.env.WAHA_API_KEY;
      }

      console.log('[INSTANCE-CREATE] Webhook URL:', webhookUrl);
      console.log('[INSTANCE-CREATE] Events:', events);
      console.log('[INSTANCE-CREATE] Custom headers:', Object.keys(customHeaders));

      // Configure session in WAHA API FIRST (before updating database)
      const wahaConfig = {
        webhooks: webhooks,
        events: events,
        customHeaders: customHeaders
      };

      const wahaConfigSuccess = await wahaAPI.updateSessionConfig(sessionName, wahaConfig);

      if (!wahaConfigSuccess) {
        console.error('[INSTANCE-CREATE] Failed to configure session in WAHA - rolling back...');
        
        // Rollback: Delete the session from WAHA
        try {
          const deleteUrl = `${process.env.WAHA_API}/api/sessions/${sessionName}`;
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              'X-Api-Key': process.env.WAHA_API_KEY || ''
            }
          });
          console.log('[INSTANCE-CREATE] Session deleted from WAHA');
        } catch (deleteError) {
          console.error('[INSTANCE-CREATE] Failed to delete session from WAHA:', deleteError);
        }
        
        // Rollback: Delete the instance from database
        try {
          await storage.deleteInstance(sessionName);
          console.log('[INSTANCE-CREATE] Instance deleted from database');
        } catch (deleteError) {
          console.error('[INSTANCE-CREATE] Failed to delete instance from database:', deleteError);
        }
        
        return res.status(500).json({ 
          error: 'Falha ao configurar webhook automaticamente',
          message: 'Não foi possível configurar o webhook, events e custom headers automaticamente. A instância não foi criada. Tente novamente.'
        });
      }

      console.log('[INSTANCE-CREATE] ✓ Session configured successfully in WAHA');

      // Only update database after WAHA confirms success
      const updatedInstance = await storage.updateInstanceWahaConfig(sessionName, webhooks, events, customHeaders);

      if (!updatedInstance) {
        console.error('[INSTANCE-CREATE] Failed to update instance config in database after WAHA success - rolling back...');
        
        // IMPROVED ROLLBACK: Delete entire WAHA session instead of just clearing webhooks
        // This ensures ALL configuration fields are cleaned up, not just webhooks
        try {
          const deleteSuccess = await wahaAPI.deleteSession(sessionName);
          if (deleteSuccess) {
            console.log('[INSTANCE-CREATE] ✓ WAHA session completely deleted (full rollback)');
          } else {
            console.error('[INSTANCE-CREATE] ✗ Failed to delete WAHA session during rollback');
          }
        } catch (rollbackError) {
          console.error('[INSTANCE-CREATE] ✗ Error during WAHA session deletion:', rollbackError);
        }
        
        // Delete instance from database as well
        try {
          await storage.deleteInstance(sessionName);
          console.log('[INSTANCE-CREATE] ✓ Instance deleted from database');
        } catch (deleteError) {
          console.error('[INSTANCE-CREATE] ✗ Failed to delete instance from database:', deleteError);
        }
        
        return res.status(500).json({ 
          error: 'Falha ao salvar configuração no banco de dados',
          message: 'A instância não pôde ser criada. A sessão WAHA foi removida. Tente novamente.',
          autoConfigured: false
        });
      }

      console.log('[INSTANCE-CREATE] ✓ Instance configuration saved to database');
      
      // Return enhanced response with autoConfigured flag and success message
      res.json({
        instance: updatedInstance,
        autoConfigured: true,
        message: 'Instância criada e configurada automaticamente com sucesso'
      });
    } catch (error) {
      console.error('Error creating instance:', error);
      res.status(500).json({ error: 'Falha ao criar instância' });
    }
  });

  app.get('/api/instancias', requireAuth, async (req: Request, res: Response) => {
    try {
      const instances = await storage.getInstances();
      res.json(instances);
    } catch (error) {
      console.error('Error fetching instances:', error);
      res.status(500).json({ error: 'Falha ao buscar instâncias' });
    }
  });

  app.get('/api/instancias/:name/qr', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      // Get QR code from WAHA in image format
      const wahaUrl = `${process.env.WAHA_API}/api/${name}/auth/qr?format=image`;
      const wahaResponse = await fetch(wahaUrl, {
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': process.env.WAHA_API_KEY || ''
        }
      });

      if (!wahaResponse.ok) {
        const errorText = await wahaResponse.text();
        console.error('[WAHA] Error getting QR code:', errorText);
        return res.status(500).json({ error: 'Falha ao obter QR code' });
      }

      const qrData = await wahaResponse.json();
      
      // Return QR code as base64 data URL
      if (qrData.mimetype && qrData.data) {
        res.json({
          qr: `data:${qrData.mimetype};base64,${qrData.data}`
        });
      } else {
        res.json(qrData);
      }
    } catch (error) {
      console.error('Error getting QR code:', error);
      res.status(500).json({ error: 'Falha ao obter QR code' });
    }
  });

  app.post('/api/instancias/:name/start', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      // Check if instance exists in database
      const instance = await storage.getInstance(name);
      if (!instance) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }

      // Start session in WAHA
      const wahaUrl = `${process.env.WAHA_API}/api/sessions/${name}/start`;
      const wahaResponse = await fetch(wahaUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': process.env.WAHA_API_KEY || ''
        }
      });

      if (!wahaResponse.ok) {
        const errorText = await wahaResponse.text();
        console.error('[WAHA] Error starting session:', errorText);
        return res.status(500).json({ error: 'Falha ao iniciar sessão no WAHA' });
      }

      const sessionData = await wahaResponse.json();
      
      // Update status in database
      await storage.updateInstanceStatus(name, sessionData.status || 'STARTING');

      res.json({ name, status: sessionData.status });
    } catch (error) {
      console.error('Error starting instance:', error);
      res.status(500).json({ error: 'Falha ao iniciar instância' });
    }
  });

  app.post('/api/instancias/:name/restart', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      // Check if instance exists in database
      const instance = await storage.getInstance(name);
      if (!instance) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }

      // Restart session in WAHA
      const wahaUrl = `${process.env.WAHA_API}/api/sessions/${name}/restart`;
      const wahaResponse = await fetch(wahaUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': process.env.WAHA_API_KEY || ''
        }
      });

      if (!wahaResponse.ok) {
        const errorText = await wahaResponse.text();
        console.error('[WAHA] Error restarting session:', errorText);
        return res.status(500).json({ error: 'Falha ao reiniciar sessão no WAHA' });
      }

      const sessionData = await wahaResponse.json();
      
      // Update status in database
      await storage.updateInstanceStatus(name, sessionData.status || 'STARTING');

      res.json({ name, status: sessionData.status });
    } catch (error) {
      console.error('Error restarting instance:', error);
      res.status(500).json({ error: 'Falha ao reiniciar instância' });
    }
  });

  app.get('/api/instancias/:name/status', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      // Get status from WAHA
      const wahaUrl = `${process.env.WAHA_API}/api/sessions/${name}`;
      const wahaResponse = await fetch(wahaUrl, {
        headers: {
          'X-Api-Key': process.env.WAHA_API_KEY || ''
        }
      });

      if (!wahaResponse.ok) {
        return res.status(404).json({ error: 'Instância não encontrada no WAHA' });
      }

      const sessionData = await wahaResponse.json();
      
      // Update status in database
      await storage.updateInstanceStatus(name, sessionData.status);

      res.json({ name, status: sessionData.status });
    } catch (error) {
      console.error('Error getting instance status:', error);
      res.status(500).json({ error: 'Falha ao obter status da instância' });
    }
  });

  app.patch('/api/instancias/:name/toggles', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { chatbotEnabled, followupEnabled } = req.body;

      // Check if instance exists in database
      const instance = await storage.getInstance(name);
      if (!instance) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }

      // Update toggles
      const updated = await storage.updateInstanceToggles(name, chatbotEnabled, followupEnabled);

      res.json(updated);
    } catch (error) {
      console.error('Error updating instance toggles:', error);
      res.status(500).json({ error: 'Falha ao atualizar configurações da instância' });
    }
  });

  app.patch('/api/instancias/:name/waha-config', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { webhooks } = req.body;

      // Check if instance exists in database
      const instance = await storage.getInstance(name);
      if (!instance) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }

      // Eventos obrigatórios sempre fixos no backend
      const events = ["message", "session.status"];

      // Custom Headers obrigatórios sempre fixos no backend (somente se WAHA_API_KEY estiver definida)
      const customHeaders: Record<string, string> = {};
      if (process.env.WAHA_API_KEY) {
        customHeaders['X-Api-Key'] = process.env.WAHA_API_KEY;
      }

      // Update WAHA configuration in database
      const updated = await storage.updateInstanceWahaConfig(name, webhooks, events, customHeaders);

      if (!updated) {
        return res.status(500).json({ error: 'Falha ao atualizar configuração no banco de dados' });
      }

      // Use the updated instance data for WAHA API call
      // This ensures that all current configuration is sent to WAHA
      const wahaConfig = {
        webhooks: updated.webhooks || [],
        events: updated.events || [],
        customHeaders: (updated.customHeaders as Record<string, string>) || {}
      };

      // Update configuration in WAHA API with current config
      const wahaSuccess = await wahaAPI.updateSessionConfig(name, wahaConfig);

      if (!wahaSuccess) {
        console.warn('[WAHA] Could not update session config in WAHA, but database was updated');
      }

      res.json(updated);
    } catch (error) {
      console.error('Error updating WAHA config:', error);
      res.status(500).json({ error: 'Falha ao atualizar configuração WAHA' });
    }
  });

  app.delete('/api/instancias/:name', requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      // Check if instance exists in database
      const instance = await storage.getInstance(name);
      if (!instance) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }

      // Delete session from WAHA
      const wahaUrl = `${process.env.WAHA_API}/api/sessions/${name}`;
      const wahaResponse = await fetch(wahaUrl, {
        method: 'DELETE',
        headers: {
          'X-Api-Key': process.env.WAHA_API_KEY || ''
        }
      });

      // Continue with database deletion even if WAHA deletion fails
      if (!wahaResponse.ok) {
        console.warn('[WAHA] Could not delete session from WAHA:', await wahaResponse.text());
      }

      // Delete from database
      await storage.deleteInstance(name);

      res.json({ success: true, message: 'Instância excluída com sucesso' });
    } catch (error) {
      console.error('Error deleting instance:', error);
      res.status(500).json({ error: 'Falha ao excluir instância' });
    }
  });

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        evolution: process.env.EVOLUTION_URL ? 'configured' : 'not configured'
      }
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}
