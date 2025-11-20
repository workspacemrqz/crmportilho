# Overview

This is a CRM and chatbot system for "Seguro IA" (Insurance AI), designed to manage customer interactions through WhatsApp integration. The application handles lead management, conversation tracking, document uploads, and automated chatbot responses for insurance-related inquiries. Built as a full-stack TypeScript application with real-time capabilities.

# Recent Changes

**November 20, 2025 (Latest):**
- **Database Migration Complete**: Configured new PostgreSQL database (Neon) with DATABASE_URL
- **Removed Supabase Dependency**: Replaced Supabase Storage with secure local file storage
- **Security Hardening**: Implemented production-ready file storage with:
  - Server-side UUID generation for filenames (prevents path traversal attacks)
  - Path validation using realpath and relative path checks (prevents symlink vulnerabilities)
  - File existence verification before URL generation (prevents enumeration attacks)
  - Strict leadId validation using basename and alphanumeric checks
- **File Storage Location**: All uploads now stored in `/uploads` directory with organized structure
- **Database Schema**: Successfully applied all migrations - tables created: users, leads, conversations, messages, documents, chatbotStates, vehicles, quotes, auditLogs, workflowTemplates, systemSettings

**Earlier Today:**
- Updated design system to modern dark theme with vibrant blue primary color (#3B82F6)
- Changed color palette from orange to blue across all components, charts, and UI elements
- Updated CSS variables for backgrounds, foregrounds, borders, shadows, and elevation system
- Updated scrollbars to use primary blue color
- Maintained existing component structure while applying new color scheme
- Removed the '/fluxos' (Workflows) page completely from the frontend

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:**
- React with TypeScript using Vite as the build tool
- Wouter for client-side routing (lightweight alternative to React Router)
- TanStack Query (React Query) for server state management and caching
- Shadcn/ui component library built on Radix UI primitives
- Tailwind CSS for styling with custom design tokens

**Design System:**
- Dark theme with vibrant blue primary color (#3B82F6 - Modern blue design system)
- HSL-based color system defined in CSS variables (format: H S% L%)
- Custom utility classes for elevation effects (hover-elevate, active-elevate-2)
- Responsive design with mobile-first approach
- Three-level text hierarchy: 95% (primary), 92% (secondary), 62% (tertiary)

**State Management:**
- TanStack Query handles all server state with 5-minute stale time
- React Context API for authentication state (AuthContext)
- WebSocket hook (useWebSocket) for real-time message updates
- Local component state for UI interactions

**Key Features:**
- Real-time chat interface with message bubbles
- Lead and conversation management dashboards
- Document upload with preview capabilities
- Authentication with session-based login
- WebSocket connection for live updates

## Backend Architecture

**Technology Stack:**
- Node.js with Express for HTTP server
- TypeScript with ESM modules
- WebSocket server for real-time communication
- Session management using express-session with in-memory store
- Drizzle ORM for database operations

**Database:**
- PostgreSQL database (configured for Neon hosting)
- Drizzle ORM with schema-first approach
- Schema defined in `shared/schema.ts` for type safety across frontend/backend
- Tables include: users, leads, conversations, messages, documents, chatbotStates, vehicles, quotes, auditLogs, workflowTemplates, systemSettings

**API Structure:**
- RESTful endpoints under `/api` prefix
- Session-based authentication with middleware guards
- Webhook endpoints for WhatsApp integrations (`/api/webhook/*`)
- File upload endpoints using multer middleware
- WebSocket endpoint at `/ws` for real-time features

**Security Measures:**
- Helmet.js for security headers
- Rate limiting on webhook endpoints (30 requests/minute)
- Stricter rate limiting for suspicious activity (10 requests/15 minutes)
- Webhook authentication via API keys and signatures
- Session secret validation on startup
- CSRF protection through session management

**Chatbot Service:**
- State machine-based conversation flow
- OpenAI integration for intelligent responses
- Message buffering to handle rapid incoming messages
- Support for text, image, and document message types
- Automatic lead creation and conversation tracking

**File Storage:**
- Local filesystem storage for file uploads (replaces Supabase)
- Files organized in `/uploads/leads/{leadId}/` structure
- Server-side UUID generation for secure filenames
- Support for documents, images, and other media
- Public URL generation via `/uploads` endpoint
- Production-ready security measures:
  - Path traversal protection
  - Symlink vulnerability prevention
  - File enumeration protection
  - Strict input validation

## External Dependencies

**WhatsApp Integration:**
- WAHA API (WhatsApp HTTP API) as primary integration method
- Evolution API support for backward compatibility
- Webhook-based message receiving
- Support for text, media, and document messages
- Session/instance-based connection management

**Environment Variables Required:**
- `DATABASE_URL` - PostgreSQL connection string (Neon Database)
- `SESSION_SECRET` - Express session encryption key
- `LOGIN` / `SENHA` - Admin authentication credentials
- `OPENAI_API_KEY` - For chatbot AI responses
- `WAHA_API` / `WAHA_API_KEY` / `WAHA_INSTANCIA` - WhatsApp API configuration
- `EVOLUTION_URL` / `EVOLUTION_KEY` / `INSTANCIA` - Alternative WhatsApp API

**Removed Environment Variables:**
- `SUPABASE_SERVICE_ROLE_KEY` - No longer needed (replaced with local storage)

**Third-Party Services:**
- Neon Database - PostgreSQL database hosting
- OpenAI - GPT-based chatbot responses
- WAHA/Evolution API - WhatsApp Business API integration

**Database Provider:**
- PostgreSQL via Drizzle ORM
- Configured for Neon Database
- Connection pooling with pg library (max 20 connections)
- Migrations stored in `/migrations` directory
- Schema synced using Drizzle Kit push command
- All tables successfully created and operational

**Development Tools:**
- Vite for frontend development server with HMR
- tsx for running TypeScript server code
- esbuild for production builds
- Drizzle Kit for database migrations
- Concurrently for running dev server and client simultaneously

**Proxy Configuration:**
- Development proxy routes `/api`, `/uploads`, and `/ws` to backend (localhost:3000)
- Frontend runs on port 5000
- Backend runs on port 3000
- WebSocket upgrade support for `/ws` endpoint

**WebSocket Architecture:**
- Bidirectional real-time communication
- Session-based authentication for WebSocket connections
- Heartbeat mechanism (25-second intervals)
- Automatic reconnection with exponential backoff (max 30 seconds)
- Message broadcasting for new messages and conversation updates
- User-to-connection mapping for targeted message delivery