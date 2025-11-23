// WAHA API Service for WhatsApp Integration
import { db } from './db';
import { messages } from '@shared/schema';

export class WAHAService {
  private baseUrl: string;
  private apiKey: string;
  private instanceName: string;

  constructor() {
    this.baseUrl = process.env.WAHA_API || '';
    this.apiKey = process.env.WAHA_API_KEY || '';
    this.instanceName = process.env.INSTANCIA || '';

    if (!this.baseUrl || !this.apiKey) {
      console.error('WAHA API configuration incomplete. Check WAHA_API and WAHA_API_KEY environment variables.');
    }
    if (!this.instanceName) {
      console.error('WAHA instance name not configured. Check INSTANCIA environment variable.');
    }
  }

  getInstanceName(): string {
    if (!this.instanceName) {
      throw new Error('WAHA instance name (INSTANCIA) is not configured. Please set the INSTANCIA environment variable with your WAHA session name.');
    }
    return this.instanceName;
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.apiKey && this.instanceName);
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey
    };
  }

  async sendText(phone: string, text: string, instanceName: string, conversationId?: string) {
    try {
      const chatId = this.formatPhone(phone);
      const url = `${this.baseUrl}/api/sendText`;  // Endpoint correto sem {session} na URL
      
      console.log(`[WAHA] Sending text to ${chatId} via ${url}`);
      console.log(`[WAHA] Message content:`, text);
      console.log(`[WAHA] Instance:`, instanceName);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          chatId,
          text,
          session: instanceName  // Session vai no body, não na URL
        })
      });

      console.log(`[WAHA] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] API Error Response:`, errorText);
        throw new Error(`WAHA API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`[WAHA] ✓ Message sent successfully:`, result);
      
      // Store message in database
      if (conversationId) {
        await db.insert(messages).values({
          conversationId,
          content: text,
          isBot: true,
          messageType: 'text',
          evolutionMessageId: result.id || result.messageId,
          status: 'sent',
          metadata: result
        });
      }

      return result;
    } catch (error) {
      console.error('[WAHA] ✗ Error sending text message:', error);
      throw error;
    }
  }

  async sendButtons(phone: string, text: string, buttons: Array<{id: string, text: string}>, instanceName: string, conversationId?: string) {
    // WAHA may not support buttons in the same way as Evolution
    // Fallback to sending text with numbered options
    try {
      console.log('[WAHA] Buttons not natively supported, sending as text with options');
      
      const buttonText = buttons.map((btn, idx) => `${idx + 1}. ${btn.text}`).join('\n');
      const fullText = `${text}\n\n${buttonText}`;
      
      return await this.sendText(phone, fullText, instanceName, conversationId);
    } catch (error) {
      console.error('[WAHA] Error sending buttons message:', error);
      throw error;
    }
  }

  async sendList(phone: string, title: string, buttonText: string, sections: Array<any>, instanceName: string, conversationId?: string) {
    // WAHA may not support lists in the same way as Evolution
    // Fallback to sending text with formatted sections
    try {
      console.log('[WAHA] Lists not natively supported, sending as formatted text');
      
      let formattedText = `${title}\n\n`;
      sections.forEach((section: any) => {
        if (section.title) {
          formattedText += `\n*${section.title}*\n`;
        }
        if (section.rows) {
          section.rows.forEach((row: any, idx: number) => {
            formattedText += `${idx + 1}. ${row.title}`;
            if (row.description) {
              formattedText += ` - ${row.description}`;
            }
            formattedText += '\n';
          });
        }
      });
      
      return await this.sendText(phone, formattedText, instanceName, conversationId);
    } catch (error) {
      console.error('[WAHA] Error sending list message:', error);
      throw error;
    }
  }

  async downloadMedia(messageId: string, instanceName: string, mediaUrl?: string): Promise<Buffer | null> {
    try {
      // If direct URL provided (from webhook), use it directly
      if (mediaUrl) {
        console.log(`[WAHA] Downloading media from direct URL: ${mediaUrl.substring(0, 100)}...`);
        const response = await fetch(mediaUrl);
        
        if (!response.ok) {
          console.error(`[WAHA] Failed to download from direct URL: ${response.status}`);
          return null;
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log(`[WAHA] Media downloaded successfully from URL, size: ${buffer.length} bytes`);
        return buffer;
      }
      
      // Fallback: Try WAHA API endpoint
      const url = `${this.baseUrl}/api/${instanceName}/files/${messageId}`;
      console.log(`[WAHA] Downloading media from WAHA API: ${url}...`);
      
      const response = await fetch(url, {
        method: 'GET', 
        headers: this.getHeaders()
      });

      if (!response.ok) {
        console.error(`[WAHA] Failed to download media from API: ${response.status}`);
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`[WAHA] Media downloaded successfully from API, size: ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      console.error('[WAHA] Error downloading media:', error);
      return null;
    }
  }

  async transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
    try {
      console.log('[WAHA] Transcribing audio using OpenAI Whisper...');
      
      // Usar OpenAI Whisper API para transcrever o áudio
      const OpenAI = await import('openai').then(m => m.default);
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      
      // Criar um arquivo temporário para o áudio
      const fs = await import('fs');
      const path = await import('path');
      const tempDir = await import('os').then(os => os.tmpdir());
      const tempFile = path.join(tempDir, `audio_${Date.now()}.ogg`);
      
      fs.writeFileSync(tempFile, audioBuffer);
      
      try {
        // Transcrever usando Whisper
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempFile),
          model: 'whisper-1',
          language: 'pt' // Português
        });
        
        console.log('[WAHA] Audio transcribed successfully:', transcription.text);
        
        // Limpar arquivo temporário
        fs.unlinkSync(tempFile);
        
        return transcription.text;
      } catch (error) {
        // Limpar arquivo temporário em caso de erro
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        throw error;
      }
    } catch (error) {
      console.error('[WAHA] Error transcribing audio:', error);
      return null;
    }
  }

  async sendImage(phone: string, imageUrl: string, caption: string, instanceName: string, filename?: string, mimeType?: string, conversationId?: string) {
    try {
      const chatId = this.formatPhone(phone);
      // IMPORTANT: WAHA /api/sendImage ONLY accepts mimetype "image/jpeg"
      // Even for PNG files, we must use "image/jpeg" for it to send as imageMessage
      const url = `${this.baseUrl}/api/sendImage`;
      
      console.log(`[WAHA] Sending image to ${chatId} via ${url}`);
      console.log(`[WAHA] Image URL: ${imageUrl}`);
      console.log(`[WAHA] Filename: ${filename}`);
      console.log(`[WAHA] Caption: ${caption}`);
      
      const payload: any = {
        chatId,
        file: {
          mimetype: 'image/jpeg', // MUST be image/jpeg according to WAHA docs
          url: imageUrl,
          filename: filename || 'image.jpg'
        },
        session: instanceName
      };
      
      // Only add caption if it's not empty
      // Empty caption = image appears clean without text in WhatsApp
      if (caption && caption.trim()) {
        payload.caption = caption;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to send image: ${response.status} - ${errorText}`);
        throw new Error(`WAHA API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[WAHA] ✓ Image sent successfully:', result);
      
      return result;
    } catch (error) {
      console.error('[WAHA] Error sending image:', error);
      throw error;
    }
  }

  async sendDocument(phone: string, documentUrl: string, caption: string, instanceName: string, filename?: string, mimeType?: string, conversationId?: string) {
    try {
      const chatId = this.formatPhone(phone);
      const url = `${this.baseUrl}/api/sendFile`;
      
      console.log(`[WAHA] Sending document to ${chatId} via ${url}`);
      console.log(`[WAHA] Document URL: ${documentUrl}`);
      console.log(`[WAHA] Caption: ${caption}`);
      console.log(`[WAHA] Filename: ${filename}`);
      console.log(`[WAHA] MimeType: ${mimeType}`);
      
      const fileObject: any = {
        url: documentUrl,
        filename: filename || caption
      };
      
      if (mimeType) {
        fileObject.mimetype = mimeType;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          chatId,
          file: fileObject,
          session: instanceName
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to send document: ${response.status} - ${errorText}`);
        throw new Error(`WAHA API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[WAHA] ✓ Document sent successfully:', result);
      
      // Note: Message is stored in database by the caller (routes.ts)
      // to avoid duplication
      
      return result;
    } catch (error) {
      console.error('[WAHA] Error sending document:', error);
      throw error;
    }
  }

  async getContactInfo(phone: string, instanceName: string): Promise<{ name: string; pushname: string } | null> {
    try {
      const contactId = phone.replace(/\D/g, '');
      const url = `${this.baseUrl}/api/contacts/about?contactId=${contactId}&session=${instanceName}`;
      
      console.log(`[WAHA] Fetching contact info for ${contactId}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        console.error(`[WAHA] Failed to get contact info: ${response.status}`);
        return null;
      }

      const contact = await response.json();
      console.log(`[WAHA] Contact info retrieved:`, { name: contact.name, pushname: contact.pushname });
      
      return {
        name: contact.name || contact.pushname || null,
        pushname: contact.pushname || contact.name || null
      };
    } catch (error) {
      console.error('[WAHA] Error fetching contact info:', error);
      return null;
    }
  }

  formatPhone(phone: string): string {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Add Brazil country code if not present
    if (cleaned.length === 10 || cleaned.length === 11) {
      cleaned = '55' + cleaned;
    }
    
    // WAHA uses @c.us format instead of @s.whatsapp.net
    return cleaned + '@c.us';
  }

  // Parse incoming WAHA webhook message
  parseWebhookMessage(data: any) {
    try {
      console.log('[WAHA] Parsing webhook message:', JSON.stringify(data, null, 2));
      
      // WAHA webhook structure: { event, session, payload }
      const payload = data.payload || data;
      const body = data.body || data;
      
      // Regex para números começando em 55
      const numRegex = /55\d{10,13}/g;
      
      // Número da própria conta (me) - para ignorar
      const meStr = body?.me?.id || body?.me?.jid || '';
      const meMatch = meStr.match(numRegex);
      const myNumber = meMatch ? meMatch[0] : null;
      
      // Campos mais prováveis para achar o número do remetente
      const candidatesFields = [
        payload._data?.Info?.SenderAlt,
        payload._data?.Info?.Sender,
        payload.from,
        payload.to,
        payload._data?.Info?.Chat,
        payload._data?.Info?.RecipientAlt,
        payload._data?.Info?.BroadcastListOwner,
      ];
      
      let phone = null;
      
      // Tentar achar o número nos campos candidatos
      for (const value of candidatesFields) {
        if (typeof value !== 'string') continue;
        
        // Limpar o formato: "5512974041539:51@s.whatsapp.net" -> "5512974041539"
        // Remove sufixos e IDs extras
        let cleanValue = value
          .split(':')[0]  // Remove ":51" e tudo depois
          .replace(/@c\.us|@s\.whatsapp\.net/g, '');  // Remove sufixos do WhatsApp
        
        const m = cleanValue.match(numRegex);
        if (!m) continue;
        const n = m[0];
        // Ignorar número da própria instância
        if (n !== myNumber) {
          phone = n;
          console.log(`[WAHA] ✓ Phone found in field: ${n} from value: ${value}`);
          break;
        }
      }
      
      // Se não achou, busca geral no JSON
      if (!phone) {
        console.log('[WAHA] ⚠️ Phone not found in priority fields, searching entire JSON...');
        
        // Limpar o JSON inteiro antes de fazer a busca
        let str = JSON.stringify(data);
        
        // Remover todos os IDs extras do formato ":51@s.whatsapp.net"
        str = str.replace(/:(\d+)@(s\.whatsapp\.net|c\.us)/g, '@$2');
        // Agora remover os sufixos
        str = str.replace(/@(s\.whatsapp\.net|c\.us)/g, '');
        
        const allMatches = str.match(numRegex) || [];
        const uniqueNumbers = Array.from(new Set(
          allMatches.filter(n => myNumber ? n !== myNumber : true)
        ));
        
        console.log('[WAHA] All numbers found in JSON:', uniqueNumbers);
        console.log('[WAHA] My number (to ignore):', myNumber);
        
        phone = uniqueNumbers[0] || null;
      }
      
      console.log('[WAHA] ✅ Final extracted phone number:', phone);
      
      // Remove sufixos do WhatsApp se existirem
      if (phone) {
        phone = phone.replace(/@c\.us|@s\.whatsapp\.net/g, '');
      }
      
      // Extract message from payload.body
      const message = payload.body || payload.text || '';
      
      // Extract contact name (pushName) from various possible locations
      // WAHA can store this in different places depending on version and setup
      const pushName = 
        payload._data?.Info?.PushName ||  // Localização correta no WAHA GOWS
        payload._data?.notifyName || 
        payload._data?.NotifyName ||
        payload._data?.PushName ||
        payload.PushName ||
        payload.pushName ||
        payload.contact?.pushname ||
        payload.contact?.pushName ||
        payload.contact?.name ||
        payload.contact?.notify ||
        null;
      
      // Extract isGroup flag
      const isGroup = payload._data?.Info?.IsGroup || false;
      
      console.log('[WAHA] Webhook payload keys:', Object.keys(payload));
      console.log('[WAHA] Webhook _data keys:', payload._data ? Object.keys(payload._data) : 'N/A');
      console.log('[WAHA] Extracted pushName:', pushName || 'NOT FOUND');
      console.log('[WAHA] IsGroup:', isGroup);
      
      return {
        phone,
        message,
        messageId: payload.id || payload.messageId,
        timestamp: payload.timestamp || Date.now(),
        isFromMe: payload.fromMe || false,
        isGroup: isGroup,
        type: this.getMessageType(payload),
        media: payload.hasMedia ? payload.media : null,
        quotedMessage: payload.quotedMsg || null,
        pushName: pushName,
        name: pushName, // Alias for backward compatibility
        source: payload.source || null // CRITICAL: Track if message came from 'api' (bot) or 'app'/'web' (human)
      };
    } catch (error) {
      console.error('[WAHA] Error parsing webhook message:', error);
      return null;
    }
  }

  private getMessageType(payload: any): string {
    if (!payload) return 'text';
    
    // Check _data.Info.MediaType first (more reliable)
    const mediaType = payload._data?.Info?.MediaType;
    if (mediaType) {
      if (mediaType === 'audio') return 'audio';
      if (mediaType === 'image') return 'image';
      if (mediaType === 'document') return 'document';
    }
    
    // Fallback: Check for media types via mimetype
    if (payload.hasMedia || payload.media) {
      const mimetype = payload.mimetype || payload.media?.mimetype;
      if (mimetype?.startsWith('image/')) return 'image';
      if (mimetype?.startsWith('audio/') || mimetype?.includes('ogg')) return 'audio';
      if (mimetype?.includes('document') || mimetype?.includes('pdf')) return 'document';
      return 'media';
    }
    
    // Default to text
    return 'text';
  }

  async getSessionStatus(instanceName: string): Promise<{ status: string; qr?: string } | null> {
    try {
      const url = `${this.baseUrl}/api/sessions/${instanceName}`;
      console.log(`[WAHA] Fetching session status from ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        console.error(`[WAHA] Failed to get session status: ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log(`[WAHA] Session status:`, data);
      
      let qr = data.qr;
      
      // Se a sessão está esperando QR code, buscar o QR atualizado
      if (data.status === 'SCAN_QR_CODE') {
        const qrData = await this.getQRCode(instanceName);
        if (qrData) {
          qr = qrData;
        }
      }
      
      return {
        status: data.status || 'UNKNOWN',
        qr: qr
      };
    } catch (error) {
      console.error('[WAHA] Error fetching session status:', error);
      return null;
    }
  }

  async getQRCode(instanceName: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/api/${instanceName}/auth/qr`;
      console.log(`[WAHA] Fetching QR code from ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        console.error(`[WAHA] Failed to get QR code: ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log(`[WAHA] QR code fetched successfully`);
      
      return data.qr || null;
    } catch (error) {
      console.error('[WAHA] Error fetching QR code:', error);
      return null;
    }
  }

  async startSession(instanceName: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/sessions/${instanceName}/start`;
      console.log(`[WAHA] Starting session at ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to start session: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[WAHA] Session started successfully`);
      return true;
    } catch (error) {
      console.error('[WAHA] Error starting session:', error);
      return false;
    }
  }

  async stopSession(instanceName: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/sessions/${instanceName}/stop`;
      console.log(`[WAHA] Stopping session at ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to stop session: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[WAHA] Session stopped successfully`);
      return true;
    } catch (error) {
      console.error('[WAHA] Error stopping session:', error);
      return false;
    }
  }

  async logoutSession(instanceName: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/sessions/${instanceName}/logout`;
      console.log(`[WAHA] Logging out session at ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to logout session: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[WAHA] Session logged out successfully`);
      return true;
    } catch (error) {
      console.error('[WAHA] Error logging out session:', error);
      return false;
    }
  }

  async deleteSession(instanceName: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/sessions/${instanceName}`;
      console.log(`[WAHA] Deleting session at ${url}`);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to delete session: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[WAHA] Session deleted successfully`);
      return true;
    } catch (error) {
      console.error('[WAHA] Error deleting session:', error);
      return false;
    }
  }

  async updateSessionConfig(
    instanceName: string,
    config: {
      webhooks?: string[];
      events?: string[];
      customHeaders?: Record<string, string>;
    }
  ): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/sessions/${instanceName}`;
      console.log(`[WAHA] Updating session config at ${url}`);
      console.log(`[WAHA] Config:`, config);
      
      // Build webhooks array in WAHA format
      const webhooks = [];
      if (config.webhooks && config.webhooks.length > 0) {
        const events = config.events && config.events.length > 0 ? config.events : ['message'];
        for (const webhookUrl of config.webhooks) {
          const webhookConfig: any = {
            url: webhookUrl,
            events: events
          };
          
          // Add customHeaders to each webhook if provided
          // IMPORTANT: WAHA expects customHeaders as array of {name, value} objects
          if (config.customHeaders && Object.keys(config.customHeaders).length > 0) {
            webhookConfig.customHeaders = Object.entries(config.customHeaders).map(([name, value]) => ({
              name,
              value
            }));
          }
          
          webhooks.push(webhookConfig);
        }
      }
      
      // WAHA expects complete session config with name and config object
      const body = {
        name: instanceName,
        config: {
          webhooks: webhooks
        }
      };
      
      console.log(`[WAHA] Sending body:`, JSON.stringify(body, null, 2));
      
      const response = await fetch(url, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WAHA] Failed to update session config: ${response.status} - ${errorText}`);
        return false;
      }

      console.log(`[WAHA] Session config updated successfully`);
      return true;
    } catch (error) {
      console.error('[WAHA] Error updating session config:', error);
      return false;
    }
  }
}
