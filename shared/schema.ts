import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const leadStatusEnum = pgEnum("lead_status", [
  "novo",
  "em_atendimento",
  "aguardando_documentos",
  "encaminhado",
  "transferido_humano",
  "concluido",
  "cancelado"
]);

export const priorityEnum = pgEnum("priority", ["baixa", "normal", "alta", "urgente"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "waiting",
  "closed",
  "transferred"
]);

export const documentTypeEnum = pgEnum("document_type", [
  "CNH",
  "CRLV",
  "nota_fiscal",
  "chassi",
  "apolice",
  "outro"
]);

export const vehicleUseEnum = pgEnum("vehicle_use", [
  "particular",
  "comercial",
  "motorista_app",
  "autoescola",
  "locadora",
  "test_drive",
  "outro"
]);

export const workflowStatusEnum = pgEnum("workflow_status", [
  "draft",
  "active",
  "inactive",
  "archived"
]);

export const parkingTypeEnum = pgEnum("parking_type", [
  "garagem",
  "estacionamento",
  "rua"
]);

export const gateTypeEnum = pgEnum("gate_type", ["manual", "automatico"]);

export const insuranceTypeEnum = pgEnum("insurance_type", [
  "auto",
  "frota",
  "residencial",
  "empresarial",
  "vida",
  "viagem",
  "rc_profissional",
  "seguro_fianca",
  "equipamentos",
  "maquinas_agricolas"
]);

export const stepTypeEnum = pgEnum("step_type", ["ai", "fixed"]);

// Tables
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  protocol: varchar("protocol").notNull().unique(),
  whatsappName: text("whatsapp_name"),
  name: text("name"),
  cpf: text("cpf"),
  cnpj: text("cnpj"),
  email: text("email"),
  phone: text("phone"),
  whatsappPhone: text("whatsapp_phone").notNull(),
  status: leadStatusEnum("status").notNull().default("novo"),
  priority: priorityEnum("priority").notNull().default("normal"),
  tags: text().array().default(sql`ARRAY[]::text[]`),
  birthDate: timestamp("birth_date"),
  maritalStatus: text("marital_status"),
  profession: text("profession"),
  address: text("address"),
  cep: text("cep"),
  isPrincipalDriver: boolean("is_principal_driver"),
  driverName: text("driver_name"),
  driverCpf: text("driver_cpf"),
  hasDriverUnder25: boolean("has_driver_under_25"),
  source: text("source"),
  assignedTo: text("assigned_to"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  phoneIdx: index("leads_phone_idx").on(table.phone),
  protocolIdx: index("leads_protocol_idx").on(table.protocol),
  cpfIdx: index("leads_cpf_idx").on(table.cpf),
  statusIdx: index("leads_status_idx").on(table.status)
}));

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  protocol: varchar("protocol").notNull(),
  status: conversationStatusEnum("status").notNull().default("active"),
  currentMenu: text("current_menu"),
  currentStep: text("current_step"),
  waitingFor: text("waiting_for"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  lastActivity: timestamp("last_activity").notNull().defaultNow()
}, (table) => ({
  leadIdx: index("conversations_lead_idx").on(table.leadId),
  statusIdx: index("conversations_status_idx").on(table.status),
  protocolIdx: index("conversations_protocol_idx").on(table.protocol)
}));

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isBot: boolean("is_bot").notNull().default(false),
  messageType: varchar("message_type", { length: 50 }).default("text"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  metadata: jsonb("metadata"),
  evolutionMessageId: text("evolution_message_id"),
  status: varchar("status", { length: 50 }).default("sent")
}, (table) => ({
  conversationIdx: index("messages_conversation_idx").on(table.conversationId),
  timestampIdx: index("messages_timestamp_idx").on(table.timestamp)
}));

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  type: documentTypeEnum("type").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  size: integer("size"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow()
}, (table) => ({
  leadIdx: index("documents_lead_idx").on(table.leadId),
  typeIdx: index("documents_type_idx").on(table.type)
}));

export const chatbotStates = pgTable("chatbot_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().unique().references(() => conversations.id, { onDelete: "cascade" }),
  currentState: text("current_state").notNull(),
  context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
  menuSelections: jsonb("menu_selections").default(sql`'{}'::jsonb`),
  collectedData: jsonb("collected_data").default(sql`'{}'::jsonb`),
  pendingActions: jsonb("pending_actions").default(sql`'[]'::jsonb`),
  handoffUntil: timestamp("handoff_until"),
  isPermanentHandoff: boolean("is_permanent_handoff").default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  conversationIdx: index("chatbot_states_conversation_idx").on(table.conversationId)
}));

export const vehicles = pgTable("vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  plate: varchar("plate", { length: 10 }),
  chassis: varchar("chassis", { length: 20 }),
  model: text("model"),
  year: varchar("year", { length: 4 }),
  parkingType: parkingTypeEnum("parking_type"),
  gateType: gateTypeEnum("gate_type"),
  workStudyUse: text("work_study_use"),
  residenceType: text("residence_type"),
  reserveCar: varchar("reserve_car", { length: 10 }),
  towing: boolean("towing"),
  hasDriverUnder25: boolean("has_driver_under_25"),
  useType: vehicleUseEnum("use_type"),
  hasWithCustomer: boolean("has_with_customer"),
  pickupDate: timestamp("pickup_date"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  leadIdx: index("vehicles_lead_idx").on(table.leadId),
  plateIdx: index("vehicles_plate_idx").on(table.plate),
  chassisIdx: index("vehicles_chassis_idx").on(table.chassis)
}));

export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  insuranceType: insuranceTypeEnum("insurance_type").notNull(),
  policyReceived: boolean("policy_received").default(false),
  keepPolicyData: boolean("keep_policy_data"),
  status: varchar("status", { length: 50 }).default("em_analise"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  leadIdx: index("quotes_lead_idx").on(table.leadId),
  statusIdx: index("quotes_status_idx").on(table.status)
}));

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  protocol: varchar("protocol"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  previousData: jsonb("previous_data"),
  newData: jsonb("new_data"),
  userId: text("user_id"),
  timestamp: timestamp("timestamp").notNull().defaultNow()
}, (table) => ({
  protocolIdx: index("audit_logs_protocol_idx").on(table.protocol),
  timestampIdx: index("audit_logs_timestamp_idx").on(table.timestamp),
  entityIdx: index("audit_logs_entity_idx").on(table.entityType, table.entityId)
}));

export const workflowTemplates = pgTable("workflow_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentId: varchar("parent_id"),
  templateKey: varchar("template_key", { length: 100 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  defaultContent: text("default_content").notNull(),
  category: varchar("category", { length: 50 }),
  requiredVariables: text("required_variables").array().default(sql`ARRAY[]::text[]`),
  status: workflowStatusEnum("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  templateKeyIdx: index("workflow_templates_key_idx").on(table.templateKey),
  statusIdx: index("workflow_templates_status_idx").on(table.status),
  categoryIdx: index("workflow_templates_category_idx").on(table.category),
  parentIdx: index("workflow_templates_parent_idx").on(table.parentId)
}));

export const workflowVersions = pgTable("workflow_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => workflowTemplates.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  status: workflowStatusEnum("status").notNull(),
  changeDescription: text("change_description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow()
}, (table) => ({
  templateIdx: index("workflow_versions_template_idx").on(table.templateId),
  versionIdx: index("workflow_versions_version_idx").on(table.templateId, table.version)
}));

export const workflowTransitions = pgTable("workflow_transitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromState: varchar("from_state", { length: 100 }).notNull(),
  toState: varchar("to_state", { length: 100 }).notNull(),
  triggerTemplateKey: varchar("trigger_template_key", { length: 100 }),
  condition: text("condition"),
  priority: integer("priority").default(0),
  isActive: boolean("is_active").notNull().default(true),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  fromStateIdx: index("workflow_transitions_from_idx").on(table.fromState),
  toStateIdx: index("workflow_transitions_to_idx").on(table.toState)
}));

export const followupMessages = pgTable("followup_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  message: text("message").notNull(),
  delayMinutes: integer("delay_minutes").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  isActiveIdx: index("followup_messages_is_active_idx").on(table.isActive)
}));

export const followupSent = pgTable("followup_sent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  followupMessageId: varchar("followup_message_id").notNull().references(() => followupMessages.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  leadLastMessageAt: timestamp("lead_last_message_at").notNull()
}, (table) => ({
  conversationIdx: index("followup_sent_conversation_idx").on(table.conversationId),
  followupIdx: index("followup_sent_followup_idx").on(table.followupMessageId),
  uniqueConversationFollowup: uniqueIndex("followup_sent_unique_idx").on(table.conversationId, table.followupMessageId)
}));

// Relations
export const leadsRelations = relations(leads, ({ many }) => ({
  conversations: many(conversations),
  documents: many(documents),
  vehicles: many(vehicles),
  quotes: many(quotes)
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  lead: one(leads, {
    fields: [conversations.leadId],
    references: [leads.id]
  }),
  messages: many(messages),
  chatbotState: one(chatbotStates, {
    fields: [conversations.id],
    references: [chatbotStates.conversationId]
  })
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id]
  })
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  lead: one(leads, {
    fields: [documents.leadId],
    references: [leads.id]
  })
}));

export const chatbotStatesRelations = relations(chatbotStates, ({ one }) => ({
  conversation: one(conversations, {
    fields: [chatbotStates.conversationId],
    references: [conversations.id]
  })
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  lead: one(leads, {
    fields: [vehicles.leadId],
    references: [leads.id]
  })
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  lead: one(leads, {
    fields: [quotes.leadId],
    references: [leads.id]
  })
}));

export const workflowTemplatesRelations = relations(workflowTemplates, ({ many }) => ({
  versions: many(workflowVersions)
}));

export const workflowVersionsRelations = relations(workflowVersions, ({ one }) => ({
  template: one(workflowTemplates, {
    fields: [workflowVersions.templateId],
    references: [workflowTemplates.id]
  })
}));

// Insert schemas and types
export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  startedAt: true,
  lastActivity: true
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  timestamp: true
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadedAt: true
});

export const insertChatbotStateSchema = createInsertSchema(chatbotStates).omit({
  id: true,
  updatedAt: true
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true
});

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true
});

export const insertWorkflowTemplateSchema = createInsertSchema(workflowTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertWorkflowVersionSchema = createInsertSchema(workflowVersions).omit({
  id: true,
  createdAt: true
});

export const insertWorkflowTransitionSchema = createInsertSchema(workflowTransitions).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertFollowupMessageSchema = createInsertSchema(followupMessages).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// Type exports
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type ChatbotState = typeof chatbotStates.$inferSelect;
export type InsertChatbotState = z.infer<typeof insertChatbotStateSchema>;
export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type WorkflowTemplate = typeof workflowTemplates.$inferSelect;
export type InsertWorkflowTemplate = z.infer<typeof insertWorkflowTemplateSchema>;
export type WorkflowVersion = typeof workflowVersions.$inferSelect;
export type InsertWorkflowVersion = z.infer<typeof insertWorkflowVersionSchema>;
export type WorkflowTransition = typeof workflowTransitions.$inferSelect;
export type InsertWorkflowTransition = z.infer<typeof insertWorkflowTransitionSchema>;
export type FollowupMessage = typeof followupMessages.$inferSelect;
export type InsertFollowupMessage = z.infer<typeof insertFollowupMessageSchema>;

// Keep old user table for compatibility if needed
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// System Settings
export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bufferTimeoutSeconds: integer("buffer_timeout_seconds").notNull().default(30),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by")
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettings).omit({
  id: true,
  updatedAt: true
});

export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;
export type SystemSettings = typeof systemSettings.$inferSelect;

// Flow Configuration Tables
export const flowConfigs = pgTable("flow_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  welcomeMessage: text("welcome_message").notNull(),
  institutionalMessage: text("institutional_message").notNull(),
  importantInstructions: text("important_instructions").notNull(),
  globalPrompt: text("global_prompt").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

export const keywordRules = pgTable("keyword_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  flowConfigId: varchar("flow_config_id").notNull().references(() => flowConfigs.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  response: text("response").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  flowConfigIdx: index("keyword_rules_flow_config_idx").on(table.flowConfigId)
}));

export const flowSteps = pgTable("flow_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  flowConfigId: varchar("flow_config_id").notNull().references(() => flowConfigs.id, { onDelete: "cascade" }),
  stepId: text("step_id").notNull(),
  stepName: text("step_name").notNull(),
  objective: text("objective").notNull(),
  stepPrompt: text("step_prompt").notNull(),
  routingInstructions: text("routing_instructions").notNull(),
  buffer: integer("buffer").notNull().default(30),
  stepType: stepTypeEnum("step_type").notNull().default("ai"),
  changeStatusTo: leadStatusEnum("change_status_to"),
  changePriorityTo: priorityEnum("change_priority_to"),
  order: integer("order").notNull().default(0),
  position: jsonb("position").default(sql`'{"x": 0, "y": 0}'`),
  transitions: jsonb("transitions").default(sql`'[]'`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  flowConfigIdx: index("flow_steps_flow_config_idx").on(table.flowConfigId),
  stepIdIdx: index("flow_steps_step_id_idx").on(table.stepId)
}));

// Flow Configuration Insert Schemas
export const insertFlowConfigSchema = createInsertSchema(flowConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertKeywordRuleSchema = createInsertSchema(keywordRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertFlowStepSchema = createInsertSchema(flowSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// Flow Configuration Types
export type FlowConfig = typeof flowConfigs.$inferSelect;
export type InsertFlowConfig = z.infer<typeof insertFlowConfigSchema>;
export type KeywordRule = typeof keywordRules.$inferSelect;
export type InsertKeywordRule = z.infer<typeof insertKeywordRuleSchema>;
export type FlowStep = typeof flowSteps.$inferSelect;
export type InsertFlowStep = z.infer<typeof insertFlowStepSchema>;

// Visual Flow Editor Types
export type NodePosition = {
  x: number;
  y: number;
};

export type StepTransition = {
  id: string;
  label: string;
  targetStepId: string;
};

export type FlowStepNode = FlowStep & {
  position: NodePosition;
  transitions: StepTransition[];
};

// WhatsApp Instances Table
export const instances = pgTable("instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(),
  status: varchar("status", { length: 50 }).notNull(),
  chatbotEnabled: boolean("chatbot_enabled").notNull().default(false),
  followupEnabled: boolean("followup_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  nameIdx: index("instances_name_idx").on(table.name),
  statusIdx: index("instances_status_idx").on(table.status)
}));

export const insertInstanceSchema = createInsertSchema(instances).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export type Instance = typeof instances.$inferSelect;
export type InsertInstance = z.infer<typeof insertInstanceSchema>;
