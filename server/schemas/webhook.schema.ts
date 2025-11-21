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
  console.log('[WAHA] 📞 Extracting phone number from webhook data');
  
  // WAHA format paths (PRIORITY ORDER - most specific first)
  const wahaPaths = [
    { field: 'SenderAlt', value: data?.payload?._data?.Info?.SenderAlt },
    { field: 'Sender', value: data?.payload?._data?.Info?.Sender },
    { field: 'from', value: data?.payload?.from },
    { field: 'Chat', value: data?.payload?._data?.Info?.Chat },
    { field: 'to', value: data?.payload?.to },
    { field: 'RecipientAlt', value: data?.payload?._data?.Info?.RecipientAlt },
    { field: 'BroadcastListOwner', value: data?.payload?._data?.Info?.BroadcastListOwner }
  ];
  
  // Evolution format paths (backward compatibility)
  const evolutionPaths = [
    { field: 'remoteJid', value: data?.data?.key?.remoteJid },
    { field: 'data.remoteJid', value: data?.data?.remoteJid },
    { field: 'remoteJid', value: data?.remoteJid },
    { field: 'from', value: data?.from },
    { field: 'data.from', value: data?.data?.from }
  ];

  const allPaths = [...wahaPaths, ...evolutionPaths];

  console.log('[WAHA] 🔍 Searching in priority order:', allPaths.map(p => `${p.field}: ${p.value}`).join(', '));

  for (let i = 0; i < allPaths.length; i++) {
    const { field, value } = allPaths[i];
    
    if (value && typeof value === 'string') {
      console.log(`[WAHA] 📋 Checking field "${field}": "${value}"`);
      
      // Split by ':' first to remove ID suffix like "5512974041539:51@s.whatsapp.net"
      const beforeColon = value.split(':')[0];
      
      // Clean the phone number - remove @c.us, @s.whatsapp.net and non-digits
      const phone = beforeColon
        .replace('@c.us', '')
        .replace('@s.whatsapp.net', '')
        .replace(/\D/g, '');
      
      console.log(`[WAHA] 🧹 Cleaned "${value}" → "${phone}" (length: ${phone.length})`);
      
      if (phone.length >= 10 && phone.length <= 15) {
        console.log(`[WAHA] ✅ Found valid phone in field "${field}": ${phone}`);
        return phone;
      } else {
        console.log(`[WAHA] ⚠️ Invalid phone length in "${field}": ${phone.length} digits`);
      }
    }
  }

  console.error('[WAHA] ❌ Failed to extract phone number from any field');
  console.error('[WAHA] 📄 Full data dump:', JSON.stringify(data, null, 2));
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