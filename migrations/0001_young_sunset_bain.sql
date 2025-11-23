ALTER TABLE "instances" ADD COLUMN "webhooks" text[] DEFAULT ARRAY[]::text[];--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "events" text[] DEFAULT ARRAY[]::text[];--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "custom_headers" jsonb DEFAULT '{}'::jsonb;