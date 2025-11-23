# Overview

This is a WhatsApp-based CRM and intelligent customer service system called "Seguro IA" (Insurance AI). The application manages customer interactions through WhatsApp, providing automated chatbot responses, lead management, conversation tracking, and follow-up automation for an insurance business.

The system uses a full-stack TypeScript architecture with React + Vite on the frontend and Express.js on the backend, with PostgreSQL as the primary database and WebSocket support for real-time updates.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## November 23, 2025 - Enhanced Tag Replacement System
- Added two new functional tags for chatbot and follow-up messages:
  - `[DD/MM/AAAA]`: Automatically replaced with current date in São Paulo timezone (DD/MM/YYYY format)
  - `[NÚMERO_DO_PROTOCOLO]`: Automatically replaced with client's protocol number (auto-generates in YYYY-NNN format if missing)
- Modified `replacePlaceholders` method in ChatbotService and FollowupService to support new tags
- All tag replacement operations are now async to support protocol generation via database queries
- Updated UI documentation in NodeEditPanel (fluxo page) and followup page to list all available tags
- Existing `{nome}` tag functionality preserved and working
- Note: Protocol generation uses sequential numbering per year; consider adding locking mechanism for high-concurrency scenarios

## November 23, 2025 - WhatsApp Instance Management & QR Code Connection
- Added new "Instâncias" page for managing WhatsApp connections via WAHA API
- Implemented database schema for tracking instances (UUID-based with status and timestamps)
- Created REST API endpoints for instance management:
  - POST /api/instancias - Create new instance
  - GET /api/instancias - List all instances
  - GET /api/instancias/:name/qr - Get QR code in base64 format
  - GET /api/instancias/:name/status - Get instance status
  - POST /api/instancias/:name/start - Start stopped instance
  - POST /api/instancias/:name/restart - Restart failed instance
  - DELETE /api/instancias/:name - Delete instance (removes from WAHA and database)
- Built frontend interface with:
  - QR code modal with auto-refresh every 5 seconds and auto-close on successful connection
  - Status-based action buttons (Start, Restart, Connect, Delete)
  - "Tentar Novamente" button for failed connections
  - "Excluir Instância" button with confirmation dialog to prevent accidental deletion
  - Real-time status updates and success notifications
- Status mapping: WORKING (Conectado), SCAN_QR_CODE/SCAN_QR (Aguardando QR), STARTING (Iniciando), STOPPED (Parado), FAILED (Falha)
- All endpoints protected with session-based authentication

# System Architecture

## Frontend Architecture

**Framework & Build System:**
- React 18 with TypeScript for type safety
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching

**UI Component Library:**
- Shadcn/ui components based on Radix UI primitives
- Tailwind CSS for styling with a dark-themed design system
- Custom HSL-based color system with support for semantic color tokens
- Responsive design with mobile-first breakpoints

**State Management Pattern:**
- Server state handled through React Query with 5-minute cache stale time
- WebSocket integration for real-time updates (conversations, messages)
- Context API for authentication state
- Local component state for UI interactions

**Key Design Decisions:**
- Modular component architecture with separation of concerns
- Form validation using React Hook Form + Zod schemas
- Real-time synchronization through WebSocket with automatic reconnection
- Proxy configuration routes API requests to backend during development

## Backend Architecture

**Server Framework:**
- Express.js with TypeScript for type-safe HTTP server
- Session-based authentication using express-session with MemoryStore
- WebSocket server for real-time bidirectional communication
- Security middleware including helmet, rate limiting, and custom webhook authentication

**Database Layer:**
- PostgreSQL as the primary relational database
- Drizzle ORM for type-safe database operations
- Schema-first design with shared TypeScript types between client and server
- Connection pooling (max 20 connections) for production scalability

**Data Models:**
- **Leads**: Customer records with status (novo, em_atendimento, aguardando_documentos, etc.) and priority levels
- **Conversations**: Active chat sessions linked to leads with state tracking
- **Messages**: Individual messages with support for text, images, documents, and metadata
- **ChatbotStates**: State machine for tracking conversation flow and collected data
- **FlowConfigs**: Configurable chatbot flows with AI-powered routing
- **FollowupMessages**: Automated follow-up scheduling based on conversation inactivity
- **WorkflowTemplates**: Reusable message templates with versioning
- **Instances**: WhatsApp instance management with status tracking and QR code authentication

**Service Layer Pattern:**
- **ChatbotService**: Core conversation logic with state machine implementation
- **WAHAService**: WhatsApp HTTP API integration (primary)
- **EvolutionAPIService**: Alternative WhatsApp API (backward compatibility)
- **FollowupService**: Automated follow-up scheduling with configurable intervals
- **FlowAIService**: OpenAI integration for intelligent conversation routing
- **LocalStorageService**: File upload/download with security validations

**Authentication & Security:**
- Environment-based login credentials (LOGIN/SENHA variables)
- Session-based authentication with secure cookie handling
- Webhook authentication supporting multiple API providers (WAHA, Evolution)
- Rate limiting on webhook endpoints (30 req/min standard, 10 req/15min for suspicious)
- Security headers via helmet middleware
- Raw body parsing for webhook signature verification
- IP tracking and security event logging

## External Dependencies

**WhatsApp Integration:**
- Primary: WAHA (WhatsApp HTTP API) - configurable via WAHA_API, WAHA_API_KEY, WAHA_INSTANCIA
- Fallback: Evolution API - configurable via EVOLUTION_URL, EVOLUTION_KEY, INSTANCIA
- Webhook-based message reception with signature validation
- Support for text, image, document, and media messages
- Real-time message status tracking (sent, delivered, read)

**AI Services:**
- OpenAI GPT integration for intelligent conversation routing and response generation
- Configurable via OPENAI_API_KEY environment variable
- Used for flow step preview, automated routing decisions, and natural language understanding
- Fallback to manual flows when AI is unavailable

**Database:**
- PostgreSQL (Neon serverless compatible via @neondatabase/serverless)
- Connection via DATABASE_URL environment variable
- Drizzle Kit for schema migrations (stored in ./migrations)
- Schema defined in shared/schema.ts for type safety across client/server

**File Storage:**
- Local filesystem storage in /uploads directory
- Security: Strict path validation to prevent directory traversal
- Support for lead-specific subdirectories
- File type validation and size limits
- Files served via Express static middleware with security headers

**Real-time Communication:**
- WebSocket server mounted on Express HTTP server
- Session-based authentication for WebSocket connections
- Heartbeat mechanism (25-second intervals) for connection health
- Automatic reconnection with exponential backoff (max 30 seconds)
- Broadcast patterns for new messages, conversation updates, and lead changes

**Environment Configuration:**
- Required: DATABASE_URL, LOGIN, SENHA, SESSION_SECRET
- Optional WhatsApp: WAHA_API, WAHA_API_KEY, WAHA_INSTANCIA (or Evolution equivalents)
- Optional AI: OPENAI_API_KEY
- Optional: FOLLOWUP_CHECK_INTERVAL_MINUTES (default: 5)
- Validation on startup ensures critical variables are present

**Development Tools:**
- TSX for TypeScript execution in development
- Vite HMR with WebSocket proxying to backend
- Concurrently for running frontend and backend in parallel
- ESBuild for production server bundling