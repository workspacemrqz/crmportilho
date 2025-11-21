import { 
  type User, 
  type InsertUser,
  type Lead,
  type InsertLead,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type Document,
  type InsertDocument,
  type ChatbotState,
  type InsertChatbotState,
  type Vehicle,
  type InsertVehicle,
  type Quote,
  type InsertQuote,
  type AuditLog,
  type InsertAuditLog,
  type WorkflowTemplate,
  type InsertWorkflowTemplate,
  type WorkflowVersion,
  type InsertWorkflowVersion,
  type WorkflowTransition,
  type InsertWorkflowTransition,
  type SystemSettings,
  type InsertSystemSettings,
  type FlowConfig,
  type InsertFlowConfig,
  type KeywordRule,
  type InsertKeywordRule,
  type FlowStep,
  type InsertFlowStep,
  users,
  leads,
  conversations,
  messages,
  documents,
  chatbotStates,
  vehicles,
  quotes,
  auditLogs,
  workflowTemplates,
  workflowVersions,
  workflowTransitions,
  systemSettings,
  flowConfigs,
  keywordRules,
  flowSteps
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, like, desc, asc, sql, gte, lte } from "drizzle-orm";

// Updated interface with all CRUD methods needed for CRM
export interface IStorage {
  // User methods (kept for compatibility)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Lead methods
  createLead(data: InsertLead): Promise<Lead>;
  getLead(id: string): Promise<Lead | undefined>;
  getLeadByPhone(phone: string): Promise<Lead | undefined>;
  getLeadByProtocol(protocol: string): Promise<Lead | undefined>;
  updateLead(id: string, data: Partial<InsertLead>): Promise<Lead | undefined>;
  getLeads(filters?: LeadFilters): Promise<Lead[]>;
  searchLeads(query: string): Promise<Lead[]>;
  clearAllLeads(): Promise<{ count: number }>;

  // Conversation methods
  createConversation(data: InsertConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | undefined>;
  getActiveConversation(leadId: string): Promise<Conversation | undefined>;
  updateConversation(id: string, data: Partial<InsertConversation>): Promise<Conversation | undefined>;
  getConversations(filters?: ConversationFilters): Promise<Conversation[]>;

  // Message methods
  createMessage(data: InsertMessage): Promise<Message>;
  getMessages(conversationId: string, limit?: number): Promise<Message[]>;
  getMessageById(id: string): Promise<Message | undefined>;

  // Document methods
  createDocument(data: InsertDocument): Promise<Document>;
  getDocuments(leadId: string): Promise<Document[]>;
  getDocument(id: string): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<boolean>;

  // ChatbotState methods
  createChatbotState(data: InsertChatbotState): Promise<ChatbotState>;
  getChatbotState(conversationId: string): Promise<ChatbotState | undefined>;
  updateChatbotState(id: string, data: Partial<InsertChatbotState>): Promise<ChatbotState | undefined>;

  // Vehicle methods
  createVehicle(data: InsertVehicle): Promise<Vehicle>;
  getVehicles(leadId: string): Promise<Vehicle[]>;
  updateVehicle(id: string, data: Partial<InsertVehicle>): Promise<Vehicle | undefined>;

  // Quote methods
  createQuote(data: InsertQuote): Promise<Quote>;
  getQuotes(leadId: string): Promise<Quote[]>;
  getQuote(id: string): Promise<Quote | undefined>;
  updateQuote(id: string, data: Partial<InsertQuote>): Promise<Quote | undefined>;

  // Audit log methods
  createAuditLog(data: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(protocol?: string): Promise<AuditLog[]>;

  // Workflow Template methods
  getWorkflowTemplates(filters?: WorkflowFilters): Promise<WorkflowTemplate[]>;
  getWorkflowTemplate(id: string): Promise<WorkflowTemplate | undefined>;
  getWorkflowByKey(templateKey: string): Promise<WorkflowTemplate | undefined>;
  createWorkflowTemplate(data: InsertWorkflowTemplate): Promise<WorkflowTemplate>;
  updateWorkflowTemplate(id: string, data: Partial<InsertWorkflowTemplate>): Promise<WorkflowTemplate | undefined>;
  toggleWorkflowStatus(id: string, isActive: boolean): Promise<WorkflowTemplate | undefined>;
  restoreDefaultWorkflow(id: string): Promise<WorkflowTemplate | undefined>;

  // Workflow Version methods
  createWorkflowVersion(data: InsertWorkflowVersion): Promise<WorkflowVersion>;
  getWorkflowVersions(templateId: string): Promise<WorkflowVersion[]>;
  getWorkflowVersion(id: string): Promise<WorkflowVersion | undefined>;

  // Workflow Transition methods
  getWorkflowTransitions(fromState?: string): Promise<WorkflowTransition[]>;
  createWorkflowTransition(data: InsertWorkflowTransition): Promise<WorkflowTransition>;
  updateWorkflowTransition(id: string, data: Partial<InsertWorkflowTransition>): Promise<WorkflowTransition | undefined>;

  // System Settings methods
  getSystemSettings(): Promise<SystemSettings>;
  updateSystemSettings(data: Partial<InsertSystemSettings>): Promise<SystemSettings>;

  // Flow Configuration methods
  getActiveFlowConfig(): Promise<FlowConfig | undefined>;
  getFlowConfig(id: string): Promise<FlowConfig | undefined>;
  createFlowConfig(data: InsertFlowConfig): Promise<FlowConfig>;
  updateFlowConfig(id: string, data: Partial<InsertFlowConfig>): Promise<FlowConfig | undefined>;
  setActiveFlowConfig(id: string): Promise<FlowConfig | undefined>;

  // Keyword Rule methods
  getKeywordRules(flowConfigId: string): Promise<KeywordRule[]>;
  createKeywordRule(data: InsertKeywordRule): Promise<KeywordRule>;
  updateKeywordRule(id: string, data: Partial<InsertKeywordRule>): Promise<KeywordRule | undefined>;
  deleteKeywordRule(id: string): Promise<boolean>;

  // Flow Step methods
  getFlowSteps(flowConfigId: string): Promise<FlowStep[]>;
  createFlowStep(data: InsertFlowStep): Promise<FlowStep>;
  updateFlowStep(id: string, data: Partial<InsertFlowStep>): Promise<FlowStep | undefined>;
  deleteFlowStep(id: string): Promise<boolean>;

  // Dashboard stats
  getDashboardStats(): Promise<DashboardStats>;
}

// Filter interfaces
export interface LeadFilters {
  status?: string;
  priority?: string;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  assignedTo?: string;
}

export interface ConversationFilters {
  status?: string;
  leadId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface WorkflowFilters {
  status?: string;
  category?: string;
  isActive?: boolean;
}

export interface DashboardStats {
  totalLeads: number;
  activeConversations: number;
  pendingDocuments: number;
  urgentLeads: number;
  todayMessages: number;
  conversionRate: number;
  leadsByStatus: Record<string, number>;
  leadsByPriority: Record<string, number>;
}

// From database integration blueprint - PostgreSQL implementation
export class PgStorage implements IStorage {
  // User methods (kept for compatibility)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Lead methods
  async createLead(data: InsertLead): Promise<Lead> {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  }

  async getLead(id: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead || undefined;
  }

  async getLeadByPhone(phone: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.phone, phone));
    return lead || undefined;
  }

  async getLeadByProtocol(protocol: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.protocol, protocol));
    return lead || undefined;
  }

  async updateLead(id: string, data: Partial<InsertLead>): Promise<Lead | undefined> {
    const [updated] = await db
      .update(leads)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    return updated || undefined;
  }

  async getLeads(filters?: LeadFilters): Promise<Lead[]> {
    let query = db.select().from(leads).$dynamic();
    
    if (filters) {
      const conditions = [];
      if (filters.status) conditions.push(eq(leads.status, filters.status as any));
      if (filters.priority) conditions.push(eq(leads.priority, filters.priority as any));
      if (filters.assignedTo) conditions.push(eq(leads.assignedTo, filters.assignedTo));
      if (filters.dateFrom) conditions.push(gte(leads.createdAt, filters.dateFrom));
      if (filters.dateTo) conditions.push(lte(leads.createdAt, filters.dateTo));
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
    }
    
    return await query.orderBy(desc(leads.createdAt));
  }

  async searchLeads(query: string): Promise<Lead[]> {
    const searchPattern = `%${query}%`;
    return await db.select().from(leads).where(
      or(
        like(leads.name, searchPattern),
        like(leads.phone, searchPattern),
        like(leads.email, searchPattern),
        like(leads.cpf, searchPattern),
        like(leads.protocol, searchPattern)
      )
    ).orderBy(desc(leads.createdAt));
  }

  async clearAllLeads(): Promise<{ count: number }> {
    // Get count before deletion
    const allLeads = await db.select().from(leads);
    const count = allLeads.length;
    
    // Delete all leads (cascade will delete conversations, messages, documents, vehicles, chatbot states)
    await db.delete(leads);
    
    return { count };
  }

  // Conversation methods
  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [conversation] = await db.insert(conversations).values(data).returning();
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation || undefined;
  }

  async getActiveConversation(leadId: string): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations)
      .where(and(
        eq(conversations.leadId, leadId),
        eq(conversations.status, 'active')
      ));
    return conversation || undefined;
  }

  async updateConversation(id: string, data: Partial<InsertConversation>): Promise<Conversation | undefined> {
    const [updated] = await db
      .update(conversations)
      .set({ ...data, lastActivity: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return updated || undefined;
  }

  async getConversations(filters?: ConversationFilters): Promise<Conversation[]> {
    let query = db.select().from(conversations).$dynamic();
    
    if (filters) {
      const conditions = [];
      if (filters.status) conditions.push(eq(conversations.status, filters.status as any));
      if (filters.leadId) conditions.push(eq(conversations.leadId, filters.leadId));
      if (filters.dateFrom) conditions.push(gte(conversations.startedAt, filters.dateFrom));
      if (filters.dateTo) conditions.push(lte(conversations.startedAt, filters.dateTo));
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
    }
    
    return await query.orderBy(desc(conversations.lastActivity));
  }

  // Message methods
  async createMessage(data: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(data).returning();
    return message;
  }

  async getMessages(conversationId: string, limit: number = 100): Promise<Message[]> {
    return await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.timestamp))
      .limit(limit);
  }

  async getMessageById(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message || undefined;
  }

  // Document methods
  async createDocument(data: InsertDocument): Promise<Document> {
    const [document] = await db.insert(documents).values(data).returning();
    return document;
  }

  async getDocuments(leadId: string): Promise<Document[]> {
    return await db.select().from(documents)
      .where(eq(documents.leadId, leadId))
      .orderBy(desc(documents.uploadedAt));
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    return document || undefined;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const result = await db.delete(documents).where(eq(documents.id, id));
    return true;
  }

  // ChatbotState methods
  async createChatbotState(data: InsertChatbotState): Promise<ChatbotState> {
    const [state] = await db.insert(chatbotStates).values(data).returning();
    return state;
  }

  async getChatbotState(conversationId: string): Promise<ChatbotState | undefined> {
    const [state] = await db.select().from(chatbotStates)
      .where(eq(chatbotStates.conversationId, conversationId));
    return state || undefined;
  }

  async getChatbotStateByPhone(phone: string): Promise<ChatbotState | undefined> {
    // First find the lead by phone
    const [lead] = await db.select().from(leads)
      .where(eq(leads.phone, phone))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    
    if (!lead) return undefined;
    
    // Find the latest conversation for this lead
    const [conversation] = await db.select().from(conversations)
      .where(eq(conversations.leadId, lead.id))
      .orderBy(desc(conversations.startedAt))
      .limit(1);
    
    if (!conversation) return undefined;
    
    // Get the chatbot state for this conversation
    const [state] = await db.select().from(chatbotStates)
      .where(eq(chatbotStates.conversationId, conversation.id));
    return state || undefined;
  }

  async updateChatbotState(id: string, data: Partial<InsertChatbotState>): Promise<ChatbotState | undefined> {
    const [updated] = await db
      .update(chatbotStates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chatbotStates.id, id))
      .returning();
    return updated || undefined;
  }

  // Vehicle methods
  async createVehicle(data: InsertVehicle): Promise<Vehicle> {
    const [vehicle] = await db.insert(vehicles).values(data).returning();
    return vehicle;
  }

  async getVehicles(leadId: string): Promise<Vehicle[]> {
    return await db.select().from(vehicles)
      .where(eq(vehicles.leadId, leadId))
      .orderBy(desc(vehicles.createdAt));
  }

  async updateVehicle(id: string, data: Partial<InsertVehicle>): Promise<Vehicle | undefined> {
    const [updated] = await db
      .update(vehicles)
      .set(data)
      .where(eq(vehicles.id, id))
      .returning();
    return updated || undefined;
  }

  // Quote methods
  async createQuote(data: InsertQuote): Promise<Quote> {
    const [quote] = await db.insert(quotes).values(data).returning();
    return quote;
  }

  async getQuotes(leadId: string): Promise<Quote[]> {
    return await db.select().from(quotes)
      .where(eq(quotes.leadId, leadId))
      .orderBy(desc(quotes.createdAt));
  }

  async getQuote(id: string): Promise<Quote | undefined> {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
    return quote || undefined;
  }

  async updateQuote(id: string, data: Partial<InsertQuote>): Promise<Quote | undefined> {
    const [updated] = await db
      .update(quotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning();
    return updated || undefined;
  }

  // Audit log methods
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async getAuditLogs(protocol?: string): Promise<AuditLog[]> {
    let query = db.select().from(auditLogs).$dynamic();
    
    if (protocol) {
      query = query.where(eq(auditLogs.protocol, protocol));
    }
    
    return await query.orderBy(desc(auditLogs.timestamp));
  }

  // Dashboard stats - optimized with fewer queries
  // Workflow Template methods
  async getWorkflowTemplates(filters?: WorkflowFilters): Promise<WorkflowTemplate[]> {
    let query = db.select().from(workflowTemplates).$dynamic();
    
    if (filters) {
      const conditions = [];
      if (filters.status) conditions.push(eq(workflowTemplates.status, filters.status as any));
      if (filters.category) conditions.push(eq(workflowTemplates.category, filters.category));
      if (filters.isActive !== undefined) conditions.push(eq(workflowTemplates.isActive, filters.isActive));
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
    }
    
    return await query.orderBy(asc(workflowTemplates.category), asc(workflowTemplates.name));
  }

  async getWorkflowTemplate(id: string): Promise<WorkflowTemplate | undefined> {
    const [template] = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, id));
    return template || undefined;
  }

  async getWorkflowByKey(templateKey: string): Promise<WorkflowTemplate | undefined> {
    const [template] = await db.select().from(workflowTemplates)
      .where(and(
        eq(workflowTemplates.templateKey, templateKey),
        eq(workflowTemplates.isActive, true)
      ));
    return template || undefined;
  }

  async createWorkflowTemplate(data: InsertWorkflowTemplate): Promise<WorkflowTemplate> {
    const [template] = await db.insert(workflowTemplates).values(data).returning();
    return template;
  }

  async updateWorkflowTemplate(id: string, data: Partial<InsertWorkflowTemplate>): Promise<WorkflowTemplate | undefined> {
    // Get current version
    const current = await this.getWorkflowTemplate(id);
    if (!current) return undefined;

    // Create version history before updating
    await this.createWorkflowVersion({
      templateId: id,
      version: current.version,
      content: current.content,
      status: current.status,
      changeDescription: data.content !== current.content ? 'Content updated' : 'Metadata updated',
      createdBy: data.updatedBy || 'system'
    });

    // Update template with incremented version
    const [updated] = await db
      .update(workflowTemplates)
      .set({ 
        ...data, 
        version: current.version + 1,
        updatedAt: new Date() 
      })
      .where(eq(workflowTemplates.id, id))
      .returning();
    return updated || undefined;
  }

  async toggleWorkflowStatus(id: string, isActive: boolean): Promise<WorkflowTemplate | undefined> {
    const [updated] = await db
      .update(workflowTemplates)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(workflowTemplates.id, id))
      .returning();
    return updated || undefined;
  }

  async restoreDefaultWorkflow(id: string): Promise<WorkflowTemplate | undefined> {
    const current = await this.getWorkflowTemplate(id);
    if (!current) return undefined;

    // Create version history before restoring
    await this.createWorkflowVersion({
      templateId: id,
      version: current.version,
      content: current.content,
      status: current.status,
      changeDescription: 'Restored to default',
      createdBy: 'system'
    });

    // Restore to default content
    const [updated] = await db
      .update(workflowTemplates)
      .set({ 
        content: current.defaultContent,
        version: current.version + 1,
        updatedAt: new Date() 
      })
      .where(eq(workflowTemplates.id, id))
      .returning();
    return updated || undefined;
  }

  // Workflow Version methods
  async createWorkflowVersion(data: InsertWorkflowVersion): Promise<WorkflowVersion> {
    const [version] = await db.insert(workflowVersions).values(data).returning();
    return version;
  }

  async getWorkflowVersions(templateId: string): Promise<WorkflowVersion[]> {
    return await db.select().from(workflowVersions)
      .where(eq(workflowVersions.templateId, templateId))
      .orderBy(desc(workflowVersions.version));
  }

  async getWorkflowVersion(id: string): Promise<WorkflowVersion | undefined> {
    const [version] = await db.select().from(workflowVersions).where(eq(workflowVersions.id, id));
    return version || undefined;
  }

  // Workflow Transition methods
  async getWorkflowTransitions(fromState?: string): Promise<WorkflowTransition[]> {
    if (fromState) {
      return await db.select().from(workflowTransitions)
        .where(and(
          eq(workflowTransitions.fromState, fromState),
          eq(workflowTransitions.isActive, true)
        ))
        .orderBy(desc(workflowTransitions.priority));
    }
    return await db.select().from(workflowTransitions)
      .where(eq(workflowTransitions.isActive, true))
      .orderBy(asc(workflowTransitions.fromState), desc(workflowTransitions.priority));
  }

  async createWorkflowTransition(data: InsertWorkflowTransition): Promise<WorkflowTransition> {
    const [transition] = await db.insert(workflowTransitions).values(data).returning();
    return transition;
  }

  async updateWorkflowTransition(id: string, data: Partial<InsertWorkflowTransition>): Promise<WorkflowTransition | undefined> {
    const [updated] = await db
      .update(workflowTransitions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(workflowTransitions.id, id))
      .returning();
    return updated || undefined;
  }

  // System Settings methods
  async getSystemSettings(): Promise<SystemSettings> {
    const settings = await db.select().from(systemSettings).limit(1);
    
    if (settings.length === 0) {
      const [newSettings] = await db.insert(systemSettings).values({
        bufferTimeoutSeconds: 30,
        updatedBy: 'system'
      }).returning();
      return newSettings;
    }
    
    return settings[0];
  }

  async updateSystemSettings(data: Partial<InsertSystemSettings>): Promise<SystemSettings> {
    const current = await this.getSystemSettings();
    
    const [updated] = await db.update(systemSettings)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(systemSettings.id, current.id))
      .returning();
    
    return updated;
  }

  // Flow Configuration methods
  async getActiveFlowConfig(): Promise<FlowConfig | undefined> {
    const [config] = await db.select()
      .from(flowConfigs)
      .where(eq(flowConfigs.isActive, true))
      .orderBy(desc(flowConfigs.createdAt))
      .limit(1);
    return config || undefined;
  }

  async getFlowConfig(id: string): Promise<FlowConfig | undefined> {
    const [config] = await db.select()
      .from(flowConfigs)
      .where(eq(flowConfigs.id, id));
    return config || undefined;
  }

  async createFlowConfig(data: InsertFlowConfig): Promise<FlowConfig> {
    const [config] = await db.insert(flowConfigs)
      .values(data)
      .returning();
    return config;
  }

  async updateFlowConfig(id: string, data: Partial<InsertFlowConfig>): Promise<FlowConfig | undefined> {
    const [updated] = await db.update(flowConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(flowConfigs.id, id))
      .returning();
    return updated || undefined;
  }

  async setActiveFlowConfig(id: string): Promise<FlowConfig | undefined> {
    await db.update(flowConfigs)
      .set({ isActive: false });
    
    const [updated] = await db.update(flowConfigs)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(flowConfigs.id, id))
      .returning();
    return updated || undefined;
  }

  // Keyword Rule methods
  async getKeywordRules(flowConfigId: string): Promise<KeywordRule[]> {
    const rules = await db.select()
      .from(keywordRules)
      .where(eq(keywordRules.flowConfigId, flowConfigId))
      .orderBy(asc(keywordRules.createdAt));
    return rules;
  }

  async createKeywordRule(data: InsertKeywordRule): Promise<KeywordRule> {
    const [rule] = await db.insert(keywordRules)
      .values(data)
      .returning();
    return rule;
  }

  async updateKeywordRule(id: string, data: Partial<InsertKeywordRule>): Promise<KeywordRule | undefined> {
    const [updated] = await db.update(keywordRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(keywordRules.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteKeywordRule(id: string): Promise<boolean> {
    const result = await db.delete(keywordRules)
      .where(eq(keywordRules.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Flow Step methods
  async getFlowSteps(flowConfigId: string): Promise<FlowStep[]> {
    const steps = await db.select()
      .from(flowSteps)
      .where(eq(flowSteps.flowConfigId, flowConfigId))
      .orderBy(asc(flowSteps.order), asc(flowSteps.createdAt));
    
    // Debug: verificar se buffer está presente (linha adicionada para diagnóstico)
    if (steps.length > 0) {
      console.log('[PgStorage] getFlowSteps returned:', steps.map(s => ({
        stepId: s.stepId,
        stepName: s.stepName,
        buffer: (s as any).buffer,
        hasBuffer: 'buffer' in s
      })));
    }
    
    return steps;
  }

  async createFlowStep(data: InsertFlowStep): Promise<FlowStep> {
    const [step] = await db.insert(flowSteps)
      .values(data)
      .returning();
    return step;
  }

  async updateFlowStep(id: string, data: Partial<InsertFlowStep>): Promise<FlowStep | undefined> {
    const [updated] = await db.update(flowSteps)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(flowSteps.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteFlowStep(id: string): Promise<boolean> {
    const result = await db.delete(flowSteps)
      .where(eq(flowSteps.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Single optimized query for all lead stats using aggregation
    const leadStats = await db
      .select({
        totalLeads: sql<number>`COUNT(*)`,
        urgentLeads: sql<number>`COUNT(*) FILTER (WHERE ${leads.priority} = 'urgente')`,
        pendingDocs: sql<number>`COUNT(*) FILTER (WHERE ${leads.status} = 'aguardando_documentos')`,
      })
      .from(leads);

    // Get active conversations count
    const [activeConvs] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(conversations)
      .where(eq(conversations.status, 'active'));

    // Get today's messages count
    const [todayMsgs] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(messages)
      .where(gte(messages.timestamp, today));

    // Get leads by status - single query
    const leadsByStatusResult = await db
      .select({
        status: leads.status,
        count: sql<number>`COUNT(*)`
      })
      .from(leads)
      .groupBy(leads.status);

    // Get leads by priority - single query
    const leadsByPriorityResult = await db
      .select({
        priority: leads.priority,
        count: sql<number>`COUNT(*)`
      })
      .from(leads)
      .groupBy(leads.priority);

    // Convert to objects
    const leadsByStatus: Record<string, number> = {};
    leadsByStatusResult.forEach((row) => {
      leadsByStatus[row.status] = Number(row.count);
    });

    const leadsByPriority: Record<string, number> = {};
    leadsByPriorityResult.forEach((row) => {
      leadsByPriority[row.priority] = Number(row.count);
    });

    const totalLeads = Number(leadStats[0]?.totalLeads || 0);
    const convertedLeads = leadsByStatus['concluido'] || 0;
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    return {
      totalLeads,
      activeConversations: Number(activeConvs?.count || 0),
      pendingDocuments: Number(leadStats[0]?.pendingDocs || 0),
      urgentLeads: Number(leadStats[0]?.urgentLeads || 0),
      todayMessages: Number(todayMsgs?.count || 0),
      conversionRate,
      leadsByStatus,
      leadsByPriority
    };
  }
}

// Export PgStorage as the storage implementation
export const storage = new PgStorage();
