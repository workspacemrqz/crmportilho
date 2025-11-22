# Overview

This project, "Seguro IA," is a CRM and chatbot system designed to streamline customer interactions, primarily through WhatsApp, for the insurance industry. Its core purpose is to manage leads, track conversations, facilitate document uploads, and provide automated, AI-driven chatbot responses for insurance-related inquiries. The system aims to enhance customer engagement and operational efficiency for insurance businesses, built as a full-stack TypeScript application with real-time capabilities. It features configurable, visual flow-based conversation systems and an automatic follow-up system to re-engage leads.

# Recent Changes

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