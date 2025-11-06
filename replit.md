# Seguro IA - CRM & Chatbot System

## Overview

This is a full-stack CRM and intelligent chatbot system built for insurance sales automation. The application enables automated WhatsApp interactions with leads, manages customer conversations, handles document collection, and provides workflow management for insurance quote processing. The system features real-time communication, state machine-based chatbot flows, and comprehensive lead tracking.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript
- Vite as the build tool and dev server
- TanStack Query (React Query) for server state management
- Wouter for routing
- shadcn/ui component library with Radix UI primitives
- Tailwind CSS for styling with custom design tokens

**Design Decisions:**
- Single-page application (SPA) with client-side routing
- Component-based architecture with reusable UI components
- Real-time updates via WebSocket connection for live message synchronization
- Custom theming system with dark mode support using CSS variables
- Responsive design with mobile-first approach

**Key Features:**
- Dashboard with analytics and statistics visualization using Recharts
- Lead management with filtering, sorting, and CRUD operations
- Real-time conversation interface with message history
- Workflow template management for chatbot automation
- Settings panel for system configuration

### Backend Architecture

**Technology Stack:**
- Node.js with Express.js
- TypeScript for type safety
- Drizzle ORM for database interactions
- PostgreSQL database (configured via Neon serverless)
- WebSocket (ws library) for real-time communication
- Session-based authentication using express-session

**Design Decisions:**
- RESTful API design with `/api` prefix
- Middleware-based request processing (security, authentication, rate limiting)
- Service-oriented architecture separating concerns (ChatbotService, WAHAService, SupabaseStorageService, ChatwootService)
- State machine pattern for chatbot conversation flows
- Webhook-based integration for receiving WhatsApp messages

**Core Services:**

1. **ChatbotService** - Manages conversational AI logic, state transitions, and automated responses using OpenAI API
2. **WAHAService** - Handles WhatsApp message sending and receiving via WAHA API
3. **EvolutionService** - Alternative WhatsApp integration (backward compatibility)
4. **SupabaseStorageService** - Manages file uploads and media storage
5. **ChatwootService** - Integration with Chatwoot for human agent handoff

**Security Architecture:**
- Rate limiting on webhook and API endpoints
- Session-based authentication with secure cookies
- Webhook authentication using API keys
- Security headers via helmet middleware
- Failed authentication attempt tracking
- Message deduplication to prevent duplicate processing

**Real-time Communication:**
- WebSocket server for bidirectional client-server communication
- Session-based WebSocket authentication
- Heartbeat mechanism for connection health monitoring
- Automatic reconnection with exponential backoff
- Event broadcasting for new messages and conversation updates

### Data Storage

**Database Schema (Drizzle ORM):**

Key tables include:
- `users` - System user accounts
- `leads` - Customer/lead information with status tracking
- `conversations` - Chat conversation metadata
- `messages` - Individual message records with type support (text, image, document)
- `chatbotStates` - State machine tracking for each conversation
- `vehicles` - Vehicle information for insurance quotes
- `quotes` - Insurance quote records
- `documents` - Document metadata and file references
- `workflowTemplates` - Chatbot flow definitions
- `workflowVersions` - Version control for workflow templates
- `workflowTransitions` - State transition rules
- `auditLogs` - System activity tracking
- `systemSettings` - Application configuration

**Database Design Decisions:**
- PostgreSQL for relational data with JSONB support for flexible metadata
- Enum types for status fields ensuring data consistency
- Timestamp tracking for created/updated records
- Indexed fields for common queries (phone numbers, protocols, status)
- Soft delete pattern with nullable fields instead of hard deletes

**File Storage:**
- Supabase Storage for media files (images, documents, PDFs)
- Local uploads directory for temporary file processing
- URL-based file access with authentication

### External Dependencies

**Third-party Services:**

1. **WAHA (WhatsApp HTTP API)** - Primary WhatsApp integration
   - Endpoint: Configured via `WAHA_API` environment variable
   - Authentication: API key via `WAHA_API_KEY`
   - Supports text messages, media uploads, and webhook callbacks

2. **Evolution API** - Alternative WhatsApp integration (backward compatibility)
   - Endpoint: Configured via `EVOLUTION_URL`
   - Authentication: API key via `EVOLUTION_KEY`
   - Webhook secret for request verification

3. **OpenAI API** - Natural language processing and AI responses
   - Used for intelligent chatbot responses and document analysis
   - Authentication: API key via `OPENAI_API_KEY`

4. **Supabase** - File storage and hosting
   - Automatically configured from `DATABASE_URL`
   - Service role key required via `SUPABASE_SERVICE_ROLE_KEY`
   - Bucket: 'portilho' for file storage

5. **Chatwoot** - Customer support platform integration
   - Contact and conversation synchronization
   - Human agent handoff capability
   - Configuration via environment variables (URL, token, account/inbox IDs)

**Database Provider:**
- Neon Serverless PostgreSQL
- Connection pooling for production reliability
- Connection string via `DATABASE_URL` environment variable

**Development Tools:**
- Drizzle Kit for database migrations
- ESBuild for server bundling in production
- tsx for development server with hot reload
- Concurrently for running dev server and client simultaneously

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `WAHA_API` / `WAHA_API_KEY` / `WAHA_INSTANCIA` - WhatsApp integration
- `EVOLUTION_URL` / `EVOLUTION_KEY` / `INSTANCIA` - Alternative WhatsApp
- `OPENAI_API_KEY` - AI integration
- `SUPABASE_SERVICE_ROLE_KEY` - File storage
- `LOGIN` / `SENHA` - Admin credentials
- `SESSION_SECRET` - Session encryption key