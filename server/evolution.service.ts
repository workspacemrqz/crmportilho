// Evolution API Service for WhatsApp Integration
import { db } from './db';
import { messages } from '@shared/schema';

export class EvolutionAPIService {
  private baseUrl: string;
  private apiKey: string;
  private instanceName: string;

  constructor() {
    this.baseUrl = process.env.EVOLUTION_URL || '';
    this.apiKey = process.env.EVOLUTION_KEY || '';
    this.instanceName = process.env.INSTANCIA || '';

    if (!this.baseUrl || !this.apiKey || !this.instanceName) {
      console.error('Evolution API configuration incomplete. Check EVOLUTION_URL, EVOLUTION_KEY, and INSTANCIA environment variables.');
    }
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  async sendText(phone: string, text: string, conversationId?: string) {
    try {
      const response = await fetch(`${this.baseUrl}/message/sendText/${this.instanceName}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: this.formatPhone(phone),
          text: text
        })
      });

      const result = await response.json();
      
      // Store message in database
      if (conversationId) {
        await db.insert(messages).values({
          conversationId,
          content: text,
          isBot: true,
          messageType: 'text',
          evolutionMessageId: result.messageId,
          status: 'sent',
          metadata: result
        });
      }

      return result;
    } catch (error) {
      console.error('Error sending text message:', error);
      throw error;
    }
  }

  async sendButtons(phone: string, text: string, buttons: Array<{id: string, text: string}>, conversationId?: string) {
    try {
      const response = await fetch(`${this.baseUrl}/message/sendButtons/${this.instanceName}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: this.formatPhone(phone),
          title: text,
          buttons: buttons.map(btn => ({
            buttonId: btn.id,
            buttonText: { displayText: btn.text }
          }))
        })
      });

      const result = await response.json();
      
      // Store message in database
      if (conversationId) {
        await db.insert(messages).values({
          conversationId,
          content: text,
          isBot: true,
          messageType: 'buttons',
          evolutionMessageId: result.messageId,
          status: 'sent',
          metadata: { buttons, result }
        });
      }

      return result;
    } catch (error) {
      console.error('Error sending buttons message:', error);
      throw error;
    }
  }

  async sendList(phone: string, title: string, buttonText: string, sections: Array<any>, conversationId?: string) {
    try {
      const response = await fetch(`${this.baseUrl}/message/sendList/${this.instanceName}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: this.formatPhone(phone),
          title,
          description: '',
          buttonText,
          sections
        })
      });

      const result = await response.json();
      
      // Store message in database
      if (conversationId) {
        await db.insert(messages).values({
          conversationId,
          content: title,
          isBot: true,
          messageType: 'list',
          evolutionMessageId: result.messageId,
          status: 'sent',
          metadata: { sections, result }
        });
      }

      return result;
    } catch (error) {
      console.error('Error sending list message:', error);
      throw error;
    }
  }

  async sendDocument(phone: string, documentUrl: string, caption: string, conversationId?: string) {
    try {
      const response = await fetch(`${this.baseUrl}/message/sendMedia/${this.instanceName}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: this.formatPhone(phone),
          mediatype: 'document',
          media: documentUrl,
          caption
        })
      });

      const result = await response.json();
      
      // Store message in database
      if (conversationId) {
        await db.insert(messages).values({
          conversationId,
          content: caption,
          isBot: true,
          messageType: 'document',
          evolutionMessageId: result.messageId,
          status: 'sent',
          metadata: { documentUrl, result }
        });
      }

      return result;
    } catch (error) {
      console.error('Error sending document:', error);
      throw error;
    }
  }

  private formatPhone(phone: string): string {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Add Brazil country code if not present
    if (cleaned.length === 10 || cleaned.length === 11) {
      cleaned = '55' + cleaned;
    }
    
    return cleaned + '@s.whatsapp.net';
  }

  // Parse incoming webhook message
  parseWebhookMessage(data: any) {
    try {
      const messageData = data.data || data;
      
      return {
        phone: messageData.remoteJid?.replace('@s.whatsapp.net', '') || messageData.from,
        message: messageData.message?.conversation || 
                 messageData.message?.extendedTextMessage?.text ||
                 messageData.text || '',
        messageId: messageData.key?.id || messageData.messageId,
        timestamp: messageData.messageTimestamp || Date.now(),
        isFromMe: messageData.key?.fromMe || false,
        type: this.getMessageType(messageData.message),
        media: messageData.message?.imageMessage || 
               messageData.message?.documentMessage ||
               messageData.message?.audioMessage,
        quotedMessage: messageData.message?.extendedTextMessage?.contextInfo?.quotedMessage
      };
    } catch (error) {
      console.error('Error parsing webhook message:', error);
      return null;
    }
  }

  private getMessageType(message: any): string {
    if (!message) return 'text';
    if (message.conversation || message.extendedTextMessage) return 'text';
    if (message.imageMessage) return 'image';
    if (message.documentMessage) return 'document';
    if (message.audioMessage) return 'audio';
    if (message.buttonsResponseMessage) return 'button_response';
    if (message.listResponseMessage) return 'list_response';
    return 'unknown';
  }
}