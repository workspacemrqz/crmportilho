import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ChatbotService } from "./chatbot.service";
import { WAHAService } from "./waha.service";
import { SupabaseStorageService } from "./supabase.service";
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
  type Message
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

// Initialize services
const chatbotService = new ChatbotService();
const wahaAPI = new WAHAService();
const supabaseStorage = new SupabaseStorageService();

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

// Configure file upload (using memory storage for Supabase upload)
const upload = multer({
  storage: multer.memoryStorage(),
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
        
        // Check for human intervention - if message is from me (WhatsApp Business) but NOT from bot
        if (parsedMessage.isFromMe) {
          console.log('[WAHA-WEBHOOK] Message is from WhatsApp Business account (isFromMe: true)');
          
          // Check if this is a bot-sent message by checking recent messages
          const lead = await storage.getLeadByPhone(phone.replace(/\D/g, ''));
          if (lead) {
            const conversations = await storage.getConversations({ leadId: lead.id, status: 'active' });
            if (conversations.length > 0) {
              const conversation = conversations[0];
              
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
                console.log('[WAHA-WEBHOOK] 🚨 HUMAN INTERVENTION DETECTED! Marking conversation as permanently handed off.');
                
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
                  await storage.createMessage({
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
                  
                  // Store the human's message too
                  await storage.createMessage({
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
                  
                  console.log(`[WAHA-WEBHOOK] Lead ${lead.protocol} permanently handed off to human agent`);
                }
              } else {
                console.log('[WAHA-WEBHOOK] Message was sent by bot, ignoring echo');
              }
            }
          }
          
          return res.status(200).json({ status: 'processed', reason: 'human-intervention-check' });
        }

        console.log('[WAHA-WEBHOOK] 🔍 Parsed message type:', parsedMessage.type);
        console.log('[WAHA-WEBHOOK] 🔍 Parsed message ID:', parsedMessage.messageId);
        console.log('[WAHA-WEBHOOK] 🔍 Has media:', parsedMessage.media ? 'YES' : 'NO');

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
              await wahaAPI.sendText(phone, '🎤 Desculpe, não consegui entender o áudio. Por favor, envie um texto ou tente novamente.', undefined);
              return res.status(200).json({ status: 'processed', message: 'audio-transcription-failed' });
            }
          } else {
            console.error('[WAHA-WEBHOOK] ❌ Failed to download audio');
            await wahaAPI.sendText(phone, '🎤 Desculpe, não consegui baixar o áudio. Por favor, envie um texto ou tente novamente.', undefined);
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
          const contactInfo = await wahaAPI.getContactInfo(phone);
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

        // Process message through chatbot
        await chatbotService.processIncomingMessage(
          phone,
          messageContent || parsedMessage.message,
          parsedMessage
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
            supabasePath: metadata?.supabasePath || null
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
      
      // Step 1: Try downloading from Supabase Storage (cache)
      if (documentInfo.supabasePath) {
        console.log('[DOWNLOAD] ☁️ Attempting to download from Supabase cache:', documentInfo.supabasePath);
        try {
          fileBuffer = await supabaseStorage.downloadDocument(documentInfo.supabasePath);
          console.log('[DOWNLOAD] ✅ Successfully downloaded from Supabase cache, size:', fileBuffer.length);
        } catch (supabaseError) {
          console.log('[DOWNLOAD] ⚠️ Failed to download from Supabase cache, will try WAHA API:', supabaseError);
          fileBuffer = null;
        }
      } else {
        console.log('[DOWNLOAD] No Supabase cache path found, will try WAHA API');
      }
      
      // Step 2: If not in Supabase, try downloading from WAHA API
      if (!fileBuffer) {
        console.log('[DOWNLOAD] 📥 Attempting to download from WAHA API');
        const wahaDownloadAPI = new WAHAService();
        fileBuffer = await wahaDownloadAPI.downloadMedia(documentInfo.messageId, documentInfo.mediaUrl);
        
        if (!fileBuffer) {
          console.log('[DOWNLOAD] ❌ Failed to download file from WAHA API');
          return res.status(404).json({ error: 'File not available for download' });
        }
        
        console.log('[DOWNLOAD] ✅ File downloaded from WAHA API, size:', fileBuffer.length);
        
        // Step 3: Save to Supabase for future downloads (if not already cached)
        if (!documentInfo.supabasePath) {
          try {
            console.log('[DOWNLOAD] ☁️ Saving to Supabase cache for future downloads');
            const supabasePath = await supabaseStorage.uploadDocument(
              fileBuffer,
              documentInfo.filename,
              leadId,
              documentInfo.mimeType
            );
            
            console.log('[DOWNLOAD] ✅ Successfully cached in Supabase:', supabasePath);
            
            // Update message metadata with Supabase path
            if (docMessage) {
              const updatedMetadata = {
                ...(docMessage.metadata as any),
                supabasePath: supabasePath
              };
              
              // Import db and messages at the top if not already imported
              const { db } = await import('./db');
              const { messages: messagesTable } = await import('@shared/schema');
              const { eq } = await import('drizzle-orm');
              
              await db.update(messagesTable)
                .set({ metadata: updatedMetadata })
                .where(eq(messagesTable.id, docMessage.id));
              
              console.log('[DOWNLOAD] 📝 Updated message metadata with Supabase path');
            }
          } catch (supabaseError) {
            console.error('[DOWNLOAD] ⚠️ Failed to cache in Supabase (non-fatal):', supabaseError);
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

  // Clear all leads and their history
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
        isBot: false,
        messageType: type,
        metadata: { manual: true, sentBy: req.body.userId || 'agent' }
      });

      // PERMANENTLY DISABLE CHATBOT when manual message is sent
      const chatbotState = await storage.getChatbotState(conversationId);
      if (chatbotState) {
        // Mark as permanently handed off
        await storage.updateChatbotState(chatbotState.id, {
          isPermanentHandoff: true
        });
        
        console.log(`[API] 🔇 Mensagem manual enviada. Bot PERMANENTEMENTE desativado para lead ${lead.protocol}`);
        
        // Store system message about the permanent handoff
        await storage.createMessage({
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

      // Create public URL for the file
      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      const caption = req.body.caption || req.file.originalname;

      // Send file via WAHA API
      const result = await wahaAPI.sendDocument(lead.whatsappPhone, fileUrl, caption, conversationId);

      // Store message in database
      const storedMessage = await storage.createMessage({
        conversationId,
        content: caption,
        isBot: false,
        messageType: 'document',
        metadata: { 
          manual: true, 
          sentBy: req.body.userId || 'agent',
          filename: req.file.originalname,
          fileUrl,
          mimeType: req.file.mimetype,
          size: req.file.size
        }
      });

      // PAUSE CHATBOT for 24 hours when manual message is sent
      const chatbotState = await storage.getChatbotState(conversationId);
      if (chatbotState) {
        const handoffUntil = new Date();
        handoffUntil.setHours(handoffUntil.getHours() + 24);
        
        await storage.updateChatbotState(chatbotState.id, {
          handoffUntil
        });
        
        console.log(`[API] 🔇 Arquivo enviado manualmente. Bot pausado até ${handoffUntil.toISOString()} para lead ${lead.protocol}`);
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

      console.log('[UPLOAD] Uploading document to Supabase:', req.file.originalname);

      // Upload file to Supabase Storage bucket 'portilho'
      const supabasePath = await supabaseStorage.uploadDocument(
        req.file.buffer,
        req.file.originalname,
        leadId,
        req.file.mimetype
      );

      console.log('[UPLOAD] Document uploaded to Supabase:', supabasePath);

      // Store document info in database with Supabase path
      const document = await storage.createDocument({
        leadId,
        filename: req.file.originalname,
        type: type as any,
        url: supabasePath, // Store Supabase path instead of local path
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

      console.log('[DOWNLOAD] Downloading document from Supabase:', document.url);

      // Download file from Supabase Storage
      const fileBuffer = await supabaseStorage.downloadDocument(document.url);

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

  // WhatsApp/WAHA Session Management endpoints
  app.get('/api/whatsapp/status', requireAuth, async (req: Request, res: Response) => {
    try {
      const status = await wahaAPI.getSessionStatus();
      if (!status) {
        return res.status(500).json({ error: 'Failed to get WhatsApp session status' });
      }
      res.json(status);
    } catch (error) {
      console.error('Error fetching WhatsApp status:', error);
      res.status(500).json({ error: 'Failed to fetch WhatsApp status' });
    }
  });

  app.post('/api/whatsapp/start', requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await wahaAPI.startSession();
      if (!success) {
        return res.status(500).json({ error: 'Failed to start WhatsApp session' });
      }
      res.json({ success: true, message: 'Session started successfully' });
    } catch (error) {
      console.error('Error starting WhatsApp session:', error);
      res.status(500).json({ error: 'Failed to start WhatsApp session' });
    }
  });

  app.post('/api/whatsapp/stop', requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await wahaAPI.stopSession();
      if (!success) {
        return res.status(500).json({ error: 'Failed to stop WhatsApp session' });
      }
      res.json({ success: true, message: 'Session stopped successfully' });
    } catch (error) {
      console.error('Error stopping WhatsApp session:', error);
      res.status(500).json({ error: 'Failed to stop WhatsApp session' });
    }
  });

  app.post('/api/whatsapp/logout', requireAuth, async (req: Request, res: Response) => {
    try {
      const success = await wahaAPI.logoutSession();
      if (!success) {
        return res.status(500).json({ error: 'Failed to logout WhatsApp session' });
      }
      res.json({ success: true, message: 'Session logged out successfully' });
    } catch (error) {
      console.error('Error logging out WhatsApp session:', error);
      res.status(500).json({ error: 'Failed to logout WhatsApp session' });
    }
  });

  // Chatbot test endpoint - simulates incoming messages
  app.post('/api/chatbot/test-message', async (req: Request, res: Response) => {
    try {
      const { phone, message } = req.body;
      
      if (!phone || !message) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          message: 'Phone and message are required' 
        });
      }

      console.log(`[TEST-CHATBOT] Simulating message from ${phone}: ${message}`);
      
      // Process the message through the chatbot service
      await chatbotService.processIncomingMessage(
        phone,
        message,
        { 
          test: true,
          timestamp: new Date().toISOString(),
          source: 'test-interface'
        }
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
