# Overview

This project is a CRM and chatbot system named "Seguro IA" (Insurance AI), designed to streamline customer interactions primarily through WhatsApp. Its core purpose is to manage leads, track conversations, facilitate document uploads, and provide automated, AI-driven chatbot responses for insurance-related inquiries. The system aims to enhance customer engagement and operational efficiency for insurance businesses. It's built as a full-stack TypeScript application with real-time capabilities.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:**
- React with TypeScript, using Vite.
- Wouter for routing.
- TanStack Query for server state management.
- Shadcn/ui for components.
- Tailwind CSS for styling.

**Design System:**
- Modern dark theme with a vibrant blue primary color (#3B82F6).
- HSL-based color system with custom utility classes for elevation effects.
- Mobile-first responsive design.
- Three-level text hierarchy for readability.

**State Management:**
- TanStack Query handles server state with a 5-minute stale time.
- React Context API for authentication.
- `useWebSocket` hook for real-time updates.

**Key Features:**
- Real-time chat interface.
- Lead and conversation dashboards.
- Document upload with previews.
- Session-based authentication.
- Live updates via WebSockets.

## Backend Architecture

**Technology Stack:**
- Node.js with Express.
- TypeScript with ESM modules.
- WebSocket server for real-time communication.
- `express-session` for session management.
- Drizzle ORM for database interactions.

**Database:**
- PostgreSQL database (Neon hosting).
- Drizzle ORM with a schema-first approach (`shared/schema.ts`).
- Tables include: users, leads, conversations, messages, documents, chatbotStates, vehicles, quotes, auditLogs, workflowTemplates, systemSettings, `flow_configs`, `keyword_rules`, and `flow_steps`.

**API Structure:**
- RESTful endpoints under `/api`.
- Session-based authentication middleware.
- Webhook endpoints for WhatsApp (`/api/webhook/*`).
- File upload endpoints using Multer.
- WebSocket endpoint at `/ws`.

**Security Measures:**
- Helmet.js for security headers.
- Rate limiting on webhook endpoints.
- Webhook authentication via API keys.
- Session secret validation and CSRF protection.

**Chatbot Service:**
- Configurable, visual flow-based conversation system.
- OpenAI integration for intelligent responses, incorporating `globalPrompt`, `stepPrompt`, `objective`, and `routingInstructions`.
- Message buffering to handle rapid incoming messages, with configurable per-node buffer times.
- Supports text, image, and document messages.
- Automatic lead creation and conversation tracking.
- Intelligent next-step determination using OpenAI with structured JSON output.

**File Storage:**
- Local filesystem storage (`/uploads` directory).
- Server-side UUID generation for filenames.
- Path traversal and symlink vulnerability protection.
- File existence verification and strict input validation.

**Visual Flow Editor:**
- Interactive node-based flow editor using `@xyflow/react` (similar to n8n).
- Supports drag-and-drop node editing, connection creation, and deletion.
- Nodes represent conversation steps with editable properties (`NodeEditPanel`).
- Visualizes transitions with smooth edges, arrow markers, and auto-generated labels.
- Stores node `position` and `transitions` in the `flow_steps` database table.
- Implements position stability to prevent unintended node movement during editing.
- Connections are displayed horizontally (left/right handles).

# External Dependencies

**WhatsApp Integration:**
- WAHA API (WhatsApp HTTP API)
- Evolution API (alternative/backward compatibility)
- Webhook-based message reception.

**Environment Variables:**
- `DATABASE_URL` (PostgreSQL/Neon)
- `SESSION_SECRET`
- `LOGIN`, `SENHA` (Admin credentials)
- `OPENAI_API_KEY`
- `WAHA_API`, `WAHA_API_KEY`, `WAHA_INSTANCIA`
- `EVOLUTION_URL`, `EVOLUTION_KEY`, `INSTANCIA`

**Third-Party Services:**
- Neon Database (PostgreSQL hosting)
- OpenAI (GPT-based chatbot responses)
- WAHA/Evolution API (WhatsApp Business API integration)

**Database Provider:**
- PostgreSQL via Drizzle ORM, configured for Neon Database.
- Connection pooling with `pg` library.
- Migrations managed via Drizzle Kit.

**Development Tools:**
- Vite (frontend dev server)
- tsx (server execution)
- esbuild (production builds)
- Drizzle Kit (database migrations)
- Concurrently (running dev processes)