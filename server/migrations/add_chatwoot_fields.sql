-- Add Chatwoot integration fields to leads table
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS chatwoot_contact_id INTEGER,
ADD COLUMN IF NOT EXISTS chatwoot_conversation_id INTEGER;

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS leads_chatwoot_contact_id_idx ON leads(chatwoot_contact_id);
CREATE INDEX IF NOT EXISTS leads_chatwoot_conversation_id_idx ON leads(chatwoot_conversation_id);
