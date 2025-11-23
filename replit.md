# Overview

Seguro IA is a WhatsApp-based CRM and intelligent customer service system designed for the insurance industry. It automates customer interactions, manages leads, tracks conversations, and automates follow-ups directly through WhatsApp. The system aims to streamline customer relationship management and enhance customer service efficiency.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## November 23, 2025 - Fixed "Session Default Does Not Exist" Error
- **Critical Bug Fix**: Resolved error where chatbot was trying to send messages to a non-existent WAHA session named "default"
- **Root Cause**: Code was using `conversation.instanceName` from database (outdated/default value) instead of the `instanceName` parameter from webhooks (current/correct value)
- **Changes Made**:
  1. **WAHAService Enhancement**: Added support for `INSTANCIA` environment variable (similar to EvolutionAPIService)
  2. **Added getInstanceName() Method**: Returns configured instance name with validation
  3. **Added isConfigured() Method**: Checks if all required WAHA configuration is present
  4. **Fixed routes.ts**: Now uses `wahaAPI.getInstanceName()` instead of hardcoded "default" fallback
  5. **Fixed processAIStep**: Changed 2 occurrences from `conversation.instanceName` to `instanceName` parameter
  6. **Fixed processStateMachine**: Changed 40+ occurrences from `conversation.instanceName` to `instanceName` parameter in all helper methods
- **Environment Variable**: Configured `INSTANCIA=Marquez` to match the actual WAHA session name
- **Result**: All messages now correctly route to the "Marquez" WAHA instance instead of failing with "Session default does not exist"

## November 23, 2025 - Automatic WAHA Configuration on Instance Creation
- **Feature Enhancement**: Instances now auto-configure webhook, events, and custom headers on creation
- **Webhook URL**: Automatically constructed using Replit public domain (from `REPLIT_DEV_DOMAIN` or `REPLIT_DOMAINS` env vars)
  - Format: `https://{replit-domain}/api/webhook/waha`
  - Falls back to request host for local development
  - Ensures webhooks work in production without manual configuration
- **Events**: Fixed set `["message", "session.status"]` configured automatically
- **Custom Headers**: `X-Api-Key` header injected automatically if `WAHA_API_KEY` is available
- **Rollback Mechanism**: Complete rollback on failure (deletes WAHA session + DB instance) to prevent inconsistent state
- **Frontend Feedback**: Response includes `autoConfigured: true/false` flag and descriptive messages
- **New WAHAService Method**: `deleteSession()` for complete WAHA session removal during rollbacks
- **Architecture Decision**: Configuration happens BEFORE database update; on failure, both WAHA and DB are cleaned up
- **Result**: Users no longer need to manually configure webhook/events/headers for new instances

## November 23, 2025 - Fixed ChatbotService Instance Name Parameter Bug
- **Critical Bug Fix**: Resolved 42+ function calls in ChatbotService that were passing incorrect parameters, causing "Session does not exist" errors
- **Root Cause**: Functions were passing conversation UUIDs instead of instance names to WAHA API
- **Error Symptom**: WAHA returned 422 errors: `Session "xxx-xxx-xxx" does not exist`
- **Changes Made (3 Rounds)**:
  1. **Round 1**: Fixed 41+ direct `sendMessageWithRetry` calls (3 params → 4 params with instanceName)
  2. **Round 2**: Updated `sendMessagesInBackground` to accept and propagate `instanceName` parameter
  3. **Round 3**: Fixed all remaining parameter mismatches via subagent (34 TypeScript errors resolved)
     - Added missing `instanceName` to `handleHumanHandoff` calls
     - Removed extraneous `instanceName` from handlers that don't accept it
     - Fixed `processFlowStep` missing `instanceName` parameter
- **Defensive Validation**: Added guard in `sendMessageWithRetry` that validates `instanceName` is never null/undefined/empty before calling WAHA API
- **Database Check**: Verified zero conversations have null `instance_name` values
- **Result**: All chatbot messages now correctly route to proper WAHA instances with validated instance names

# System Architecture

## Frontend Architecture

The frontend uses React 18 with TypeScript, Vite for building, Wouter for routing, and TanStack Query for server state management. UI is built with Shadcn/ui components (Radix UI primitives) and styled with Tailwind CSS, featuring a dark-themed, responsive design and a custom HSL-based color system. State management is handled via React Query for server state, WebSocket for real-time updates, and Context API for authentication.

## Backend Architecture

The backend is built with Express.js and TypeScript. It features session-based authentication, a WebSocket server for real-time communication, and security middleware (helmet, rate limiting). PostgreSQL is the primary database, accessed via Drizzle ORM for type-safe operations. Key data models include Leads, Conversations, Messages, ChatbotStates, FlowConfigs, FollowupMessages, WorkflowTemplates, and Instances. The service layer includes ChatbotService, WAHAService, EvolutionAPIService, FollowupService, FlowAIService, and LocalStorageService. Security is enforced through environment-based credentials, secure cookies, webhook authentication, and rate limiting.

## UI/UX Decisions

The system features a dark-themed design system using Tailwind CSS and Shadcn/ui components, ensuring responsiveness. The UI includes a QR code modal for WhatsApp connection with auto-refresh, status-based action buttons, and toggle switches for per-instance chatbot and follow-up control.

## Technical Implementations

- **Multi-Instance Architecture**: Supports multiple WhatsApp instances concurrently, each with independent chatbot and follow-up configurations.
- **Per-Instance Control**: Allows toggling chatbot and follow-up functionalities for individual WhatsApp instances.
- **Tag Replacement System**: Implements dynamic tag replacement in messages for current date (`[DD/MM/AAAA]`) and client protocol numbers (`[NÚMERO_DO_PROTOCOLO]`).
- **WhatsApp Instance Management**: Provides a dedicated interface for managing WhatsApp connections, including QR code scanning, status monitoring, and instance lifecycle operations (start, stop, delete).
- **Automated WAHA Configuration**: Automatically configures essential webhook events (`message`, `session.status`) and injects `X-Api-Key` headers for WAHA integration, simplifying user setup and preventing misconfigurations.

# External Dependencies

## WhatsApp Integration

- **Primary**: WAHA (WhatsApp HTTP API) for sending/receiving messages and managing instances. Configurable via `WAHA_API`, `WAHA_API_KEY`.
- **Fallback/Alternative**: Evolution API, configurable via `EVOLUTION_URL`, `EVOLUTION_KEY`.
- Uses webhook-based message reception with signature validation.

## AI Services

- OpenAI GPT integration for intelligent conversation routing, response generation, and flow step previews. Configurable via `OPENAI_API_KEY`.

## Database

- PostgreSQL, compatible with serverless solutions like Neon. Connected via `DATABASE_URL`.
- Drizzle ORM for database interactions and Drizzle Kit for migrations.

## File Storage

- Local filesystem storage in the `/uploads` directory for media and documents. Includes security validations for path and file types.

## Real-time Communication

- WebSocket server for real-time updates on conversations, messages, and lead changes, with session-based authentication and automatic reconnection.

## Environment Configuration

- **Required**: `DATABASE_URL`, `LOGIN`, `SENHA`, `SESSION_SECRET`.
- **WhatsApp**: `WAHA_API`, `WAHA_API_KEY` (for WAHA), or `EVOLUTION_URL`, `EVOLUTION_KEY` (for Evolution).
- **AI**: `OPENAI_API_KEY`.