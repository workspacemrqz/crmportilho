import { z } from 'zod';

// Schema for WAHA API webhook payload structure
export const wahaWebhookPayloadSchema = z.object({
  event: z.string(), // "message", "message.any", etc.
  session: z.string(), // Session/instance name
  payload: z.object({
    id: z.string(),
    from: z.string(), // Phone number in format "5511999999999@c.us"
    fromMe: z.boolean(),
    to: z.string().optional(),
    body: z.string().optional(), // Message text content
    timestamp: z.number(),
    hasMedia: z.boolean().optional(),
    mimetype: z.string().optional(),
    quotedMsg: z.any().optional(),
    // Include _data field for WAHA metadata (contains PushName)
    _data: z.object({
      Info: z.object({
        PushName: z.string().optional(),
        Chat: z.string().optional(),
        Sender: z.string().optional(),
        IsFromMe: z.boolean().optional(),
        IsGroup: z.boolean().optional()
      }).passthrough().optional()
    }).passthrough().optional()
  }).passthrough()
}).passthrough(); // Allow additional fields

// Schema for Evolution API webhook message structure (kept for backward compatibility)
export const evolutionWebhookMessageSchema = z.object({
  key: z.object({
    id: z.string().optional(),
    fromMe: z.boolean().optional(),
    remoteJid: z.string().optional()
  }).optional(),
  message: z.object({
    conversation: z.string().optional(),
    extendedTextMessage: z.object({
      text: z.string(),
      contextInfo: z.object({
        quotedMessage: z.any().optional()
      }).optional()
    }).optional(),
    imageMessage: z.any().optional(),
    documentMessage: z.any().optional(),
    audioMessage: z.any().optional(),
    buttonsResponseMessage: z.any().optional(),
    listResponseMessage: z.any().optional()
  }).optional(),
  messageTimestamp: z.union([z.string(), z.number()]).optional(),
  pushName: z.string().optional(),
  broadcast: z.boolean().optional(),
  status: z.string().optional(),
  participant: z.string().optional()
});

// Main webhook payload schema - supports both WAHA and Evolution formats
export const webhookPayloadSchema = z.union([
  wahaWebhookPayloadSchema,
  z.object({
    event: z.string().optional(),
    instance: z.string().optional(),
    data: evolutionWebhookMessageSchema.optional(),
    // Allow for both nested and flat structure
    remoteJid: z.string().optional(),
    from: z.string().optional(),
    text: z.string().optional(),
    messageId: z.string().optional()
  }).passthrough()
]);

// Sanitize input to prevent injection attacks
export function sanitizeWebhookData(data: any): any {
  if (typeof data === 'string') {
    // Remove potential SQL injection patterns
    return data
      .replace(/['";\\]/g, '') // Remove quotes and backslashes
      .replace(/--/g, '') // Remove SQL comments
      .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .trim();
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeWebhookData(item));
  }
  
  if (data !== null && typeof data === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip potentially dangerous keys
      if (!['__proto__', 'constructor', 'prototype'].includes(key)) {
        sanitized[key] = sanitizeWebhookData(value);
      }
    }
    return sanitized;
  }
  
  return data;
}

// Validate and sanitize webhook payload
export function validateWebhookPayload(payload: unknown) {
  try {
    // First sanitize the input
    const sanitized = sanitizeWebhookData(payload);
    
    // Then validate against schema
    const validated = webhookPayloadSchema.parse(sanitized);
    
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        success: false, 
        error: 'Invalid webhook payload structure',
        details: error.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message
        }))
      };
    }
    return { 
      success: false, 
      error: 'Failed to validate webhook payload' 
    };
  }
}

// Extract phone number from various possible locations
export function extractPhoneNumber(data: any): string | null {
  console.log('[extractPhoneNumber] Received data:', JSON.stringify(data, null, 2));
  
  // WAHA format paths (priority)
  const wahaPaths = [
    data?.payload?.from,  // WAHA: payload.from = "5511999999999@c.us"
  ];
  
  // Evolution format paths (backward compatibility)
  const evolutionPaths = [
    data?.data?.key?.remoteJid,
    data?.data?.remoteJid,
    data?.remoteJid,
    data?.from,
    data?.data?.from
  ];

  const allPaths = [...wahaPaths, ...evolutionPaths];

  console.log('[extractPhoneNumber] Checking paths:', {
    'data.payload.from (WAHA)': data?.payload?.from,
    'data.data.key.remoteJid': data?.data?.key?.remoteJid,
    'data.data.remoteJid': data?.data?.remoteJid,
    'data.remoteJid': data?.remoteJid,
    'data.from': data?.from,
    'data.data.from': data?.data?.from
  });

  for (let i = 0; i < allPaths.length; i++) {
    const path = allPaths[i];
    console.log(`[extractPhoneNumber] Path ${i}: ${path} (type: ${typeof path})`);
    
    if (path && typeof path === 'string') {
      // Handle both @c.us (WAHA) and @s.whatsapp.net (Evolution) formats
      const phone = path
        .replace('@c.us', '')
        .replace('@s.whatsapp.net', '')
        .replace(/\D/g, '');
      
      console.log(`[extractPhoneNumber] Extracted phone from path ${i}: ${phone} (length: ${phone.length})`);
      
      if (phone.length >= 10) {
        console.log(`[extractPhoneNumber] ✓ Success! Returning phone: ${phone}`);
        return phone;
      }
    }
  }

  console.error('[extractPhoneNumber] ✗ Failed to extract phone number from any path');
  return null;
}

// Extract message content from various possible locations
export function extractMessageContent(data: any): string {
  // WAHA format paths (priority)
  const wahaPaths = [
    data?.payload?.body,  // WAHA: payload.body
  ];
  
  // Evolution format paths (backward compatibility)
  const evolutionPaths = [
    data?.data?.message?.conversation,
    data?.data?.message?.extendedTextMessage?.text,
    data?.message?.conversation,
    data?.message?.extendedTextMessage?.text,
    data?.text,
    data?.data?.text
  ];

  const allPaths = [...wahaPaths, ...evolutionPaths];

  for (const path of allPaths) {
    if (path && typeof path === 'string' && path.trim()) {
      return sanitizeWebhookData(path);
    }
  }

  return '';
}