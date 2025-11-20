-- Remove Chatwoot columns from leads table if they exist
ALTER TABLE "leads" DROP COLUMN IF EXISTS "chatwoot_contact_id";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "chatwoot_conversation_id";
