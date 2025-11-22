# Overview

This project, "Seguro IA," is a CRM and chatbot system designed to streamline customer interactions, primarily through WhatsApp, for the insurance industry. Its core purpose is to manage leads, track conversations, facilitate document uploads, and provide automated, AI-driven chatbot responses for insurance-related inquiries. The system aims to enhance customer engagement and operational efficiency for insurance businesses, built as a full-stack TypeScript application with real-time capabilities. It features configurable, visual flow-based conversation systems and an automatic follow-up system to re-engage leads.

# Recent Changes

**November 22, 2025 - Added {nome} Placeholder Support to Follow-up Messages**
- Implemented placeholder support in follow-up messages matching the flow nodes functionality
- **Feature**: Users can now use `{nome}` in follow-up message templates to personalize with first name
- **Implementation**:
  - Added `extractFirstName` method to FollowupService (same logic as chatbot nodes)
  - Added `replacePlaceholders` method to process `{nome}` placeholder before sending
  - Fetches full lead data to extract first name from `name` or `whatsappName` fields
  - Logs original and processed messages for debugging
- **UI Enhancement**: Added visual hint in form description showing `{nome}` placeholder with example
- **Example**: "Olá {nome}!" becomes "Olá Gabriel!" for lead "Gabriel Marquez"
- **Status**: ✅ Implemented - follow-up messages now support name personalization

**November 22, 2025 - Fixed AI Node Not Sending Messages**
- Resolved critical bug where AI nodes in the chatbot flow were not sending messages to leads
- **Problem**: When AI determined to stay on the same step (not transition), it was incorrectly treated as a "transition" and the message was skipped
- **Root Cause**: 
  - Logic checked if `proximaEtapaId` existed, without verifying if it was different from current step
  - When AI returned same stepId (e.g., "identificar_problema" → "identificar_problema"), code thought it was a transition
  - This caused the message to be skipped with "⏭️ Skipping AI message - just updating state"
- **Solution**: Added check `aiResponse.proximaEtapaId !== currentStep.stepId` before treating as transition
- **Fix Details**:
  - If AI returns DIFFERENT stepId: Skip message, update state, continue loop (real transition)
  - If AI returns SAME stepId or no stepId: Send message and stop loop (stay on step)
- **Status**: ✅ Fixed - AI nodes now correctly send messages when staying on current step

**November 22, 2025 - Fixed Follow-up Timing Precision**
- Resolved issue where follow-up messages were not sent at exact configured times
- **Problem**: Service was checking conversations every 5 minutes, causing up to 5-minute delays in message delivery
- **Root Cause**: 
  - Check interval (`FOLLOWUP_CHECK_INTERVAL_MINUTES = 5`) was too infrequent for precise timing
  - Interval was counted from last execution, not synchronized to clock minutes
  - Example: If check ran at 19h58, next check would be 20h03, but delays could push it to 20h07
- **Solution**: Reduced check interval to 1 minute (`FOLLOWUP_CHECK_INTERVAL_MINUTES = 1`)
- **Result**: Follow-up messages now sent within 1-minute precision of configured delays
- **Impact**: Messages configured for 5, 10, 15, 20, 25 minutes now send at approximately :58, :03, :08, :13, :18 (within ±1 minute)
- **Status**: ✅ Implemented - service now checks every 60 seconds for improved timing accuracy

**November 22, 2025 - Changed Follow-up Page to Table Layout**
- Redesigned the `/followup` page from card-based grid to table/spreadsheet format
- **New Layout**:
  - Switched from Card grid to Table component (matching `/clientes` page style)
  - Table columns: Nome, Tempo, Mensagem, Status, Ações
  - Compact and organized data presentation in rows
  - Maintained all functionality: create, edit, delete, toggle active/inactive
  - Responsive design with proper mobile handling
- **Benefits**: Better data scanning, consistent UI across pages, more professional appearance
- **Status**: ✅ Implemented - follow-up messages now displayed in table format

**November 22, 2025 - Fixed Chatbot Flow Transitions**
- Resolved critical bug where AI nodes were sending unwanted messages during transitions
- **Problem**: When an AI node determined a transition to another node, it would send both its AI-generated message AND the target node's message
- **Solution**: Implemented boolean return value system to control flow processing loop
  - AI nodes that transition now update state without sending messages
  - Only the destination node sends its configured message
  - Proper handling of all transition scenarios: AI→AI, AI→FIXED, FIXED→FIXED, FIXED→AI
- **Technical Implementation**:
  - Changed `processFlowStep`, `processAIStep`, `processFixedMessageStep` to return `Promise<boolean>`
  - Return `true` = continue loop for automatic transitions
  - Return `false` = stop loop and wait for user input
  - Loop refreshes state from database each iteration (max 10 iterations to prevent infinite loops)
- **Status**: ✅ Architect approved - transitions now work correctly without duplicate messages

**November 22, 2025 - Improved Mobile Layout for Follow-up Page**
- Standardized the /followup page layout to match /clientes page mobile experience
- **Mobile-First Improvements**:
  - **Header Layout**: Fixed header with border separator, responsive padding (p-4 sm:p-6)
  - **Typography**: Mobile-optimized sizes (text-xl sm:text-2xl for title, text-xs sm:text-sm for description)
  - **Button Behavior**: Full width on mobile (w-full sm:w-auto) for better touch targets
  - **Content Area**: Scrollable content area with proper overflow handling
  - **Dialog Width**: 95% viewport width on mobile (w-[95vw]) for better use of screen space
  - **Responsive Grid**: Consistent responsive breakpoints with /clientes page
- **Consistency**: Now both pages share the same mobile UX patterns and feel

**November 22, 2025 - Added No-Duplicate Follow-up Rule**
- Implemented strict rule to prevent leads from receiving the same follow-up message multiple times
- **Critical Rule**: Once a specific follow-up message is sent to a lead, it will NEVER be sent again to that same conversation, even if the lead responds and stops responding again later
- **Implementation**: Simplified deduplication logic to check only if the message was ever sent to that conversation, removing temporal conditions
- **User Benefit**: Prevents annoying repetition and maintains professional communication standards

**November 22, 2025 - Fixed Follow-up Service Not Sending Messages**
- Diagnosed and resolved critical bugs preventing automatic follow-up messages from being sent
- **Root Causes Identified**:
  - **Bug 1**: Service was querying incorrect field names (`leads.phone` and `leads.name` instead of `leads.whatsappPhone` and `leads.whatsappName`), causing it to find 0 active conversations
  - **Bug 2**: Missing `WHATSAPP_API=waha` environment variable caused service to use unconfigured Evolution API instead of WAHA API
- **Fixes Applied**:
  - Updated `followup.service.ts` to use correct field names from leads table
  - Set `WHATSAPP_API=waha` environment variable in development
- **Verification**: Successfully sent follow-up message "Teste" to Gabriel Marquez (protocol 2025-818) and confirmed database record in `followup_sent` table
- **Status**: ✅ Follow-up service now working correctly - finds active conversations and sends messages via WAHA API

**November 22, 2025 - Cleaned Up Empty State UI**
- Removed the "Criar Primeira Mensagem" button from the empty state
- Changed the chat icon to a clock icon for better visual consistency with the follow-up feature
- **Changes**:
  - Removed redundant CTA button (users can use the header button instead)
  - Updated icon from MessageSquare to Clock for thematic consistency
  - Streamlined empty state message

**November 22, 2025 - Enhanced Follow-up Form UX**
- Improved the follow-up message creation dialog with intuitive controls and visual feedback
- **Key Improvements**:
  - **Quick Selection Buttons**: 5 preset time options (4h, 8h, 12h, 24h, 48h) with descriptions
  - **Visual Preview**: Real-time display showing when message will be sent
  - **Better Labels**: Changed technical terms to user-friendly questions
  - **Example Placeholder**: Added sample message to guide users
  - **Simplified Flow**: Reorganized fields for natural configuration process

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:** React with TypeScript (Vite), Wouter for routing, TanStack Query for server state, Shadcn/ui components, and Tailwind CSS for styling.

**Design System:** Modern dark theme with a vibrant blue primary color, HSL-based color system for elevation effects, mobile-first responsive design, and a three-level text hierarchy.

**State Management:** TanStack Query for server state (5-minute stale time), React Context API for authentication, and `useWebSocket` hook for real-time updates.

**Key Features:** Real-time chat interface, lead and conversation dashboards, document upload with previews, session-based authentication, and live updates via WebSockets.

## Backend Architecture

**Technology Stack:** Node.js with Express, TypeScript (ESM modules), WebSocket server, `express-session` for session management, and Drizzle ORM for database interactions.

**Database:** PostgreSQL database (Neon hosting) managed with Drizzle ORM. Key tables include: users, leads, conversations, messages, documents, chatbotStates, vehicles, quotes, auditLogs, workflowTemplates, systemSettings, `flow_configs`, `keyword_rules`, `flow_steps`, `followup_messages`, and `followup_sent`.

**API Structure:** RESTful endpoints (`/api`), session-based authentication middleware, webhook endpoints for WhatsApp (`/api/webhook/*`), file upload endpoints (Multer), and a WebSocket endpoint (`/ws`).

**Security Measures:** Helmet.js for security headers, rate limiting on webhook endpoints, webhook authentication via API keys, and session secret validation.

**Chatbot Service:** Configurable, visual flow-based conversation system with OpenAI integration for intelligent responses. It utilizes `globalPrompt`, `stepPrompt`, `objective`, and `routingInstructions`. Features message buffering with configurable per-node buffer times (including instant delivery for buffer=0), supports text, image, and document messages, and includes automatic lead creation, conversation tracking, and intelligent next-step determination using OpenAI with structured JSON output. Supports two types of flow nodes: AI-powered and fixed message nodes.

**Automatic Follow-up System:** Configurable automatic messages sent to re-engage leads who stop responding, based on configurable delays. Tracks sent follow-ups to prevent duplicates.

**File Storage:** Local filesystem storage (`/uploads`) with server-side UUID generation for filenames, path traversal protection, and strict input validation.

**Visual Flow Editor:** Interactive node-based flow editor using `@xyflow/react`. Supports drag-and-drop, connection management, editable node properties (`NodeEditPanel`), and visualizes transitions. Stores node `position` and `transitions` in `flow_steps`. Includes automatic step ID generation from titles.

# External Dependencies

**WhatsApp Integration:** WAHA API (WhatsApp HTTP API) and Evolution API (alternative). Uses webhook-based message reception.

**Environment Variables:** `DATABASE_URL`, `SESSION_SECRET`, `LOGIN`, `SENHA`, `OPENAI_API_KEY`, `WAHA_API`, `WAHA_API_KEY`, `WAHA_INSTANCIA`, `EVOLUTION_URL`, `EVOLUTION_KEY`, `INSTANCIA`.

**Third-Party Services:**
- **Neon Database:** PostgreSQL hosting.
- **OpenAI:** GPT-based chatbot responses.
- **WAHA/Evolution API:** WhatsApp Business API integration.

**Database Provider:** PostgreSQL via Drizzle ORM, configured for Neon Database, with connection pooling via `pg` library and migrations managed by Drizzle Kit.