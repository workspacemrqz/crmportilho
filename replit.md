# Overview

Seguro IA is a WhatsApp-based CRM and intelligent customer service system designed for the insurance industry. It automates customer interactions, manages leads, tracks conversations, and automates follow-ups directly through WhatsApp. The system aims to streamline customer relationship management and enhance customer service efficiency.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## November 23, 2025 - Fixed AI Node Message Duplication on Transitions
- **Critical Bug Fix**: Resolved issue where AI nodes sent TWO messages when transitioning to another step
- **Root Cause**: AI nodes were sending their own message AND then the next step was also sending its message
- **User Impact**: When AI detected transition (e.g., user says "de vida"), system sent both AI's message ("Perfeito, Gabriel...") AND next step's message ("VIDA")
- **Expected Behavior**: When AI detects transition to another step, it should ONLY transition without sending message. The next step sends its own message.
- **Changes Made**:
  1. **Modified processAIStep Logic**: Reordered to check transition BEFORE sending message
  2. **Transition Case**: When `proximaEtapaId !== currentStep.stepId`, do NOT send AI message, just transition
  3. **Stay-on-Step Case**: When `proximaEtapaId === currentStep.stepId` or null, SEND AI message (waiting for more user input)
  4. **Message Flow**: Next step in loop sends its own message after transition
- **Code Location**: `server/chatbot.service.ts`, method `processAIStep` (lines 1910-1953)
- **Result**: Users now receive only ONE message per interaction - either AI's message (when staying on step) OR next step's message (when transitioning)

## November 23, 2025 - Fixed AI Nodes Being Marked as Executed Prematurely
- **Critical Bug Fix**: Resolved issue where AI nodes were marked as "executed" even when staying on the same step waiting for user response
- **Root Cause**: `processFlowStep` was marking ALL steps as executed after processing, regardless of whether they transitioned to a different step
- **User Impact**: After first AI response, subsequent user messages would be ignored with log "Step already executed - skipping"
- **Example Scenario**: User says "nova" → AI asks "auto ou vida?" → marks step as executed → user says "de vida" → AI doesn't respond (step marked as executed)
- **Changes Made**:
  1. **Modified processAIStep Return Type**: Changed from `Promise<boolean>` to `Promise<{ shouldContinue: boolean; transitioned: boolean }>`
  2. **Transitioned Flag Logic**: Returns `transitioned: true` only when `proximaEtapaId !== currentStep.stepId` (actual transition to different step)
  3. **Transitioned Flag Logic**: Returns `transitioned: false` when `proximaEtapaId === currentStep.stepId` or `proximaEtapaId === null` (staying on same step)
  4. **Updated processFlowStep**: Only marks step as executed when `transitioned === true`
- **Code Location**: `server/chatbot.service.ts`, methods `processAIStep` (lines 1867-1955) and `processFlowStep` (lines 1492-1568)
- **Result**: AI nodes that wait for user response are no longer marked as executed, allowing them to process subsequent user messages correctly

## November 23, 2025 - Fixed AI Node Messages Not Being Sent During Transitions
- **Critical Bug Fix**: Resolved issue where AI-generated messages were not being sent to users when the AI detected a state transition
- **Root Cause**: The `processAIStep` method was skipping message delivery when `proximaEtapaId` (next step) was different from the current step, causing silent transitions without user feedback
- **User Impact**: Users would send messages (e.g., "para vida" after being asked about insurance type) and receive no response, creating a broken conversation flow
- **Changes Made**:
  1. **Modified processAIStep Logic**: Refactored to ALWAYS send the AI-generated message BEFORE processing any state transition
  2. **Message-First Approach**: Moved `sendMessageWithRetry` call to execute before transition logic (lines 1898-1908)
  3. **Preserved Transition Logic**: Maintained all existing transition behavior after ensuring message delivery
  4. **Fixed Missing Parameter**: Added missing `instanceName` parameter to `handleFluxoAutoDadosVeiculo` call (line 3228)
- **Code Location**: `server/chatbot.service.ts`, method `processAIStep` (lines 1864-1950)
- **Result**: Users now receive AI responses in ALL scenarios (with or without transitions), ensuring continuous conversation flow
- **Architect Review**: Approved - confirmed fix resolves the issue without introducing regressions

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