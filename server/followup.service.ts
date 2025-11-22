import { db } from './db';
import { conversations, messages, followupMessages, followupSent, leads } from '@shared/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';
import { WAHAService } from './waha.service';
import { EvolutionAPIService } from './evolution.service';

export class FollowupService {
  private wahaService: WAHAService | null = null;
  private evolutionService: EvolutionAPIService | null = null;
  private checkIntervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    // Read configurable check interval from environment variable
    const intervalMinutes = parseInt(process.env.FOLLOWUP_CHECK_INTERVAL_MINUTES || '5', 10);
    this.checkIntervalMs = intervalMinutes * 60 * 1000;

    // Initialize messaging services based on environment
    const whatsappAPI = process.env.WHATSAPP_API || 'evolution';
    
    if (whatsappAPI === 'waha') {
      try {
        this.wahaService = new WAHAService();
        console.log('[Followup] Initialized with WAHA API');
      } catch (error) {
        console.warn('[Followup] Failed to initialize WAHA service:', error);
      }
    } else {
      try {
        this.evolutionService = new EvolutionAPIService();
        console.log('[Followup] Initialized with Evolution API');
      } catch (error) {
        console.warn('[Followup] Failed to initialize Evolution service:', error);
      }
    }
  }

  /**
   * Start the follow-up service interval
   */
  start() {
    if (this.intervalId) {
      console.log('[Followup] Service already running');
      return;
    }

    console.log(`[Followup] Starting service with check interval: ${this.checkIntervalMs / 1000}s`);
    
    // Run immediately on start
    this.checkAndSendFollowups().catch(err => {
      console.error('[Followup] Error on initial check:', err);
    });

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.checkAndSendFollowups().catch(err => {
        console.error('[Followup] Error on periodic check:', err);
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stop the follow-up service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Followup] Service stopped');
    }
  }

  /**
   * Main function to check conversations and send follow-ups
   */
  async checkAndSendFollowups() {
    try {
      console.log('[Followup] Checking for conversations needing follow-up...');

      // Get all active follow-up messages
      const activeFollowups = await db
        .select()
        .from(followupMessages)
        .where(eq(followupMessages.isActive, true));

      if (activeFollowups.length === 0) {
        console.log('[Followup] No active follow-up messages configured');
        return;
      }

      console.log(`[Followup] Found ${activeFollowups.length} active follow-up message(s)`);

      // Get all active conversations
      const activeConversations = await db
        .select({
          id: conversations.id,
          leadId: conversations.leadId,
          protocol: conversations.protocol,
          lastActivity: conversations.lastActivity,
          leadPhone: leads.phone,
          leadName: leads.name,
        })
        .from(conversations)
        .leftJoin(leads, eq(conversations.leadId, leads.id))
        .where(
          and(
            eq(conversations.status, 'active'),
            isNull(conversations.endedAt)
          )
        );

      console.log(`[Followup] Found ${activeConversations.length} active conversation(s)`);

      for (const conversation of activeConversations) {
        await this.processConversation(conversation, activeFollowups);
      }

      console.log('[Followup] Check completed');
    } catch (error) {
      console.error('[Followup] Error checking follow-ups:', error);
      throw error;
    }
  }

  /**
   * Process a single conversation to check if it needs follow-up
   */
  private async processConversation(
    conversation: {
      id: string;
      leadId: string;
      protocol: string;
      lastActivity: Date | null;
      leadPhone: string | null;
      leadName: string | null;
    },
    activeFollowups: Array<{
      id: string;
      name: string;
      message: string;
      delayMinutes: number;
      isActive: boolean;
    }>
  ) {
    try {
      // Get the last message in this conversation
      const lastMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(desc(messages.timestamp))
        .limit(1);

      if (lastMessages.length === 0) {
        // No messages in conversation yet
        return;
      }

      const lastMessage = lastMessages[0];

      // If the last overall message is from the lead, don't send follow-up (they responded)
      if (!lastMessage.isBot) {
        // Last message was from the lead, no follow-up needed
        return;
      }

      // Get the last message from the lead (where isBot = false)
      const lastLeadMessages = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.isBot, false)
          )
        )
        .orderBy(desc(messages.timestamp))
        .limit(1);

      if (lastLeadMessages.length === 0) {
        // No lead messages yet, can't determine follow-up timing
        return;
      }

      const lastLeadMessage = lastLeadMessages[0];
      const leadLastMessageAt = new Date(lastLeadMessage.timestamp);

      // Calculate time since the last LEAD message (not the bot message)
      const now = new Date();
      const minutesSinceLeadMessage = (now.getTime() - leadLastMessageAt.getTime()) / (1000 * 60);

      // Check each active follow-up message
      for (const followup of activeFollowups) {
        // Check if enough time has passed since the lead's last message
        if (minutesSinceLeadMessage < followup.delayMinutes) {
          continue;
        }

        // RULE: A specific follow-up message can only be sent ONCE per conversation
        // Even if the lead responds and stops responding again, we don't send the same message twice
        const alreadySent = await db
          .select()
          .from(followupSent)
          .where(
            and(
              eq(followupSent.conversationId, conversation.id),
              eq(followupSent.followupMessageId, followup.id)
            )
          )
          .limit(1);

        if (alreadySent.length > 0) {
          // This follow-up message has already been sent to this conversation
          // We never send the same message twice, regardless of timing
          continue;
        }

        // Send the follow-up message with the lead's last message timestamp
        await this.sendFollowup(conversation, followup, leadLastMessageAt);
      }
    } catch (error) {
      console.error(`[Followup] Error processing conversation ${conversation.id}:`, error);
    }
  }

  /**
   * Send a follow-up message to a lead
   */
  private async sendFollowup(
    conversation: {
      id: string;
      leadId: string;
      protocol: string;
      leadPhone: string | null;
      leadName: string | null;
    },
    followup: {
      id: string;
      name: string;
      message: string;
      delayMinutes: number;
    },
    leadLastMessageAt: Date
  ) {
    try {
      if (!conversation.leadPhone) {
        console.error(`[Followup] Cannot send follow-up to conversation ${conversation.id}: no phone number`);
        return;
      }

      console.log(`[Followup] Sending follow-up "${followup.name}" to ${conversation.leadPhone} (conversation: ${conversation.id})`);

      // Send message via the appropriate service
      if (this.wahaService) {
        await this.wahaService.sendText(
          conversation.leadPhone,
          followup.message,
          conversation.id
        );
      } else if (this.evolutionService) {
        await this.evolutionService.sendText(
          conversation.leadPhone,
          followup.message,
          conversation.id
        );
      } else {
        throw new Error('No messaging service configured');
      }

      // Record that we sent this follow-up
      await db.insert(followupSent).values({
        conversationId: conversation.id,
        followupMessageId: followup.id,
        leadLastMessageAt: leadLastMessageAt,
      });

      // Update conversation last activity
      await db
        .update(conversations)
        .set({ lastActivity: new Date() })
        .where(eq(conversations.id, conversation.id));

      console.log(`[Followup] Successfully sent follow-up "${followup.name}" to conversation ${conversation.id}`);
    } catch (error) {
      console.error(`[Followup] Error sending follow-up to conversation ${conversation.id}:`, error);
      // Don't update lastActivity if send failed - rethrow to prevent it
      throw error;
    }
  }

  /**
   * Manually trigger a follow-up check (useful for testing)
   */
  async triggerCheck() {
    return this.checkAndSendFollowups();
  }
}

// Export a singleton instance
export const followupService = new FollowupService();
