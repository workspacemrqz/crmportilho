-- Remove field length restrictions from leads table
-- This migration changes all varchar fields with length restrictions to text type

ALTER TABLE leads 
  ALTER COLUMN cpf TYPE text,
  ALTER COLUMN cnpj TYPE text,
  ALTER COLUMN phone TYPE text,
  ALTER COLUMN whatsapp_phone TYPE text,
  ALTER COLUMN cep TYPE text,
  ALTER COLUMN driver_cpf TYPE text;
