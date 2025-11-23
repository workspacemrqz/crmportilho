# Overview

Seguro IA is a CRM and chatbot system designed for the insurance industry to streamline customer interactions, primarily via WhatsApp. It manages leads, tracks conversations, facilitates document uploads, and provides AI-driven chatbot responses for insurance inquiries. The system aims to enhance customer engagement and operational efficiency through a full-stack TypeScript application with real-time capabilities, featuring configurable, visual flow-based conversation systems and an automatic follow-up system for lead re-engagement.

# Recent Updates

**November 23, 2025 - Flow Editor: Removed Auto-Repositioning**
- Fixed issue where nodes were being automatically repositioned after saving
- Nodes now maintain their EXACT position as placed by the user
- Only brand new nodes without saved positions use the default grid layout
- Implementation: Enhanced position preservation logic in FlowEditor.tsx to strictly respect saved coordinates from database

**November 23, 2025 - Node Execution Deduplication**
- Implemented `executedSteps` tracking to prevent nodes from executing multiple times per conversation
- Each chatbot flow node now executes exactly once per conversation
- Prevents duplicate messages when leads send multiple responses to the last node in a workflow
- Status/priority changes and message sending only happen on first node execution

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:** React with TypeScript (Vite), Wouter for routing, TanStack Query for server state, Shadcn/ui components, and Tailwind CSS for styling.

**Design System:** Modern dark theme with a vibrant blue primary color, HSL-based color system, mobile-first responsive design, and a three-level text hierarchy.

**State Management:** TanStack Query for server state, React Context API for authentication, and `useWebSocket` hook for real-time updates.

**Key Features:** Real-time chat interface, lead and conversation dashboards, document upload with previews, session-based authentication, and live updates via WebSockets.

## Backend Architecture

**Technology Stack:** Node.js with Express, TypeScript (ESM modules), WebSocket server, `express-session` for session management, and Drizzle ORM for database interactions.

**Database:** PostgreSQL (Neon hosting) managed with Drizzle ORM. Key tables include: users, leads, conversations, messages, documents, chatbotStates, vehicles, quotes, auditLogs, workflowTemplates, systemSettings, `flow_configs`, `keyword_rules`, `flow_steps`, `followup_messages`, and `followup_sent`.

**API Structure:** RESTful endpoints (`/api`), session-based authentication middleware, webhook endpoints for WhatsApp (`/api/webhook/*`), file upload endpoints (Multer), and a WebSocket endpoint (`/ws`).

**Security Measures:** Helmet.js for security headers, rate limiting on webhook endpoints, webhook authentication via API keys, and session secret validation.

**Chatbot Service:** Configurable, visual flow-based conversation system with OpenAI integration. It uses `globalPrompt`, `stepPrompt`, `objective`, and `routingInstructions`. Features message buffering, supports text, image, and document messages, and includes automatic lead creation, conversation tracking, and intelligent next-step determination using OpenAI with structured JSON output. Supports AI-powered and fixed message nodes. Includes logic to prevent duplicate node execution and allows automatic lead status and priority updates based on flow nodes.

**Automatic Follow-up System:** Configurable automatic messages sent to re-engage leads based on delays. Prevents sending the same follow-up message multiple times to the same conversation. Supports `{nome}` placeholder for personalization.

**File Storage:** Local filesystem storage (`/uploads`) with UUID generation for filenames, path traversal protection, and input validation.

**Visual Flow Editor:** Interactive node-based editor using `@xyflow/react`. Supports drag-and-drop, connection management, editable node properties, and visualizes transitions. Stores node `position` and `transitions` in `flow_steps`.

# External Dependencies

**WhatsApp Integration:** WAHA API (WhatsApp HTTP API) and Evolution API. Uses webhook-based message reception.

**Environment Variables:** `DATABASE_URL`, `SESSION_SECRET`, `LOGIN`, `SENHA`, `OPENAI_API_KEY`, `WAHA_API`, `WAHA_API_KEY`, `WAHA_INSTANCIA`, `EVOLUTION_URL`, `EVOLUTION_KEY`, `INSTANCIA`.

**Third-Party Services:**
- **Neon Database:** PostgreSQL hosting.
- **OpenAI:** GPT-based chatbot responses.
- **WAHA/Evolution API:** WhatsApp Business API integration.

**Database Provider:** PostgreSQL via Drizzle ORM, configured for Neon Database, with connection pooling via `pg` library.