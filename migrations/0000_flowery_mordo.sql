CREATE TYPE "public"."conversation_status" AS ENUM('active', 'waiting', 'closed', 'transferred');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('CNH', 'CRLV', 'nota_fiscal', 'chassi', 'apolice', 'outro');--> statement-breakpoint
CREATE TYPE "public"."gate_type" AS ENUM('manual', 'automatico');--> statement-breakpoint
CREATE TYPE "public"."insurance_type" AS ENUM('auto', 'frota', 'residencial', 'empresarial', 'vida', 'viagem', 'rc_profissional', 'seguro_fianca', 'equipamentos', 'maquinas_agricolas');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('novo', 'em_atendimento', 'aguardando_documentos', 'encaminhado', 'transferido_humano', 'concluido', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."parking_type" AS ENUM('garagem', 'estacionamento', 'rua');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('baixa', 'normal', 'alta', 'urgente');--> statement-breakpoint
CREATE TYPE "public"."vehicle_use" AS ENUM('particular', 'comercial', 'motorista_app', 'autoescola', 'locadora', 'test_drive', 'outro');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('draft', 'active', 'inactive', 'archived');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" varchar,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"previous_data" jsonb,
	"new_data" jsonb,
	"user_id" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_states" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"current_state" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"menu_selections" jsonb DEFAULT '{}'::jsonb,
	"collected_data" jsonb DEFAULT '{}'::jsonb,
	"pending_actions" jsonb DEFAULT '[]'::jsonb,
	"handoff_until" timestamp,
	"is_permanent_handoff" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chatbot_states_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"protocol" varchar NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"current_menu" text,
	"current_step" text,
	"waiting_for" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"last_activity" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"filename" text NOT NULL,
	"type" "document_type" NOT NULL,
	"url" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"welcome_message" text NOT NULL,
	"institutional_message" text NOT NULL,
	"important_instructions" text NOT NULL,
	"global_prompt" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_config_id" varchar NOT NULL,
	"step_id" text NOT NULL,
	"step_name" text NOT NULL,
	"objective" text NOT NULL,
	"step_prompt" text NOT NULL,
	"routing_instructions" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"position" jsonb DEFAULT '{"x": 0, "y": 0}',
	"transitions" jsonb DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_config_id" varchar NOT NULL,
	"keyword" text NOT NULL,
	"response" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol" varchar NOT NULL,
	"whatsapp_name" text,
	"name" text,
	"cpf" text,
	"cnpj" text,
	"email" text,
	"phone" text,
	"whatsapp_phone" text NOT NULL,
	"status" "lead_status" DEFAULT 'novo' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"birth_date" timestamp,
	"marital_status" text,
	"profession" text,
	"address" text,
	"cep" text,
	"is_principal_driver" boolean,
	"driver_name" text,
	"driver_cpf" text,
	"has_driver_under_25" boolean,
	"source" text,
	"assigned_to" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leads_protocol_unique" UNIQUE("protocol")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar NOT NULL,
	"content" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"message_type" varchar(50) DEFAULT 'text',
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"evolution_message_id" text,
	"status" varchar(50) DEFAULT 'sent'
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"insurance_type" "insurance_type" NOT NULL,
	"policy_received" boolean DEFAULT false,
	"keep_policy_data" boolean,
	"status" varchar(50) DEFAULT 'em_analise',
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buffer_timeout_seconds" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" varchar NOT NULL,
	"plate" varchar(10),
	"chassis" varchar(20),
	"model" text,
	"year" varchar(4),
	"parking_type" "parking_type",
	"gate_type" "gate_type",
	"work_study_use" text,
	"residence_type" text,
	"reserve_car" varchar(10),
	"towing" boolean,
	"has_driver_under_25" boolean,
	"use_type" "vehicle_use",
	"has_with_customer" boolean,
	"pickup_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" varchar,
	"template_key" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"default_content" text NOT NULL,
	"category" varchar(50),
	"required_variables" text[] DEFAULT ARRAY[]::text[],
	"status" "workflow_status" DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_templates_template_key_unique" UNIQUE("template_key")
);
--> statement-breakpoint
CREATE TABLE "workflow_transitions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_state" varchar(100) NOT NULL,
	"to_state" varchar(100) NOT NULL,
	"trigger_template_key" varchar(100),
	"condition" text,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"status" "workflow_status" NOT NULL,
	"change_description" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbot_states" ADD CONSTRAINT "chatbot_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_flow_config_id_flow_configs_id_fk" FOREIGN KEY ("flow_config_id") REFERENCES "public"."flow_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rules" ADD CONSTRAINT "keyword_rules_flow_config_id_flow_configs_id_fk" FOREIGN KEY ("flow_config_id") REFERENCES "public"."flow_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_protocol_idx" ON "audit_logs" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "chatbot_states_conversation_idx" ON "chatbot_states" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_lead_idx" ON "conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversations_protocol_idx" ON "conversations" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "documents_lead_idx" ON "documents" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "flow_steps_flow_config_idx" ON "flow_steps" USING btree ("flow_config_id");--> statement-breakpoint
CREATE INDEX "flow_steps_step_id_idx" ON "flow_steps" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "keyword_rules_flow_config_idx" ON "keyword_rules" USING btree ("flow_config_id");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "leads_protocol_idx" ON "leads" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "leads_cpf_idx" ON "leads" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_timestamp_idx" ON "messages" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "quotes_lead_idx" ON "quotes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vehicles_lead_idx" ON "vehicles" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "vehicles_plate_idx" ON "vehicles" USING btree ("plate");--> statement-breakpoint
CREATE INDEX "vehicles_chassis_idx" ON "vehicles" USING btree ("chassis");--> statement-breakpoint
CREATE INDEX "workflow_templates_key_idx" ON "workflow_templates" USING btree ("template_key");--> statement-breakpoint
CREATE INDEX "workflow_templates_status_idx" ON "workflow_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_templates_category_idx" ON "workflow_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "workflow_templates_parent_idx" ON "workflow_templates" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_transitions_from_idx" ON "workflow_transitions" USING btree ("from_state");--> statement-breakpoint
CREATE INDEX "workflow_transitions_to_idx" ON "workflow_transitions" USING btree ("to_state");--> statement-breakpoint
CREATE INDEX "workflow_versions_template_idx" ON "workflow_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "workflow_versions_version_idx" ON "workflow_versions" USING btree ("template_id","version");