# Overview

This is a CRM and chatbot system for "Seguro IA" (Insurance AI), designed to manage customer interactions through WhatsApp integration. The application handles lead management, conversation tracking, document uploads, and automated chatbot responses for insurance-related inquiries. Built as a full-stack TypeScript application with real-time capabilities.

# Recent Changes

**November 21, 2025 (Latest):**
- **Visual Flow Editor Performance Optimizations**: Fixed critical bugs in node positioning and connection handling
  - **Node Position Stability**: Implemented comprehensive solution to prevent nodes from moving when connections are created
    - Created `positionsRef` to store positions independently of steps state
    - Implemented structural hash comparison to detect only real structural changes
    - Used delta reconciliation instead of full rebuilds when only transitions change
    - Separate effect for updating transition counts without rebuilding entire node tree
    - Positions are now 100% preserved when connecting, editing, or rearranging nodes
  - **Horizontal Connection Flow**: Changed connection handles from vertical (top/bottom) to horizontal (left/right)
    - Input handle on left side (Position.Left)
    - Output handle on right side (Position.Right)
    - Removed top and bottom handles for cleaner horizontal flow visualization
    - Larger, more prominent handle indicators for easier connection

- **Visual Flow Editor**: Transformed `/fluxo` page into interactive node-based flow editor (similar to n8n)
  - Installed React Flow library (`@xyflow/react`) for visual node editing
  - Extended database schema with `position` (x,y coordinates) and `transitions` (node connections) fields on `flow_steps` table
  - Created new shared types: `FlowStepNode`, `NodePosition`, `StepTransition` for type-safe visual editing
  - Built `FlowEditor.tsx` component:
    - Visual canvas with draggable nodes representing conversation flow steps
    - **Enhanced Connection Visualization**:
      - Smooth animated edges with primary color styling
      - Arrow markers showing direction of flow
      - Auto-generated labels based on target step name (e.g., "→ Cotação")
      - Labels display with background for better readability
    - **Automatic Transition Creation**: Drag from one node to another to instantly:
      - Create transition in source step's configuration
      - Generate intelligent default label
      - Open edit modal immediately for customization
      - Prevent duplicate connections to same target
    - **Visual Feedback**: Transition counter badges showing number of outgoing connections
    - Start node indicator using Star icon from lucide-react (no emojis)
    - Automatic layout algorithm for initial node positioning
    - Node selection and deletion capabilities
  - Built `NodeEditPanel.tsx` component:
    - Modal popup (not side panel) for editing selected node properties
    - AI preview testing within the panel
    - Real-time updates to flow configuration
  - Simplified `/fluxo` page to contain only visual editor (removed separate sections)
  - Updated backend routes (`PUT /api/flows/:id`) to properly save/load position and transitions data
  - All visual editor elements include `data-testid` attributes for testing
  - Architecture reviewed and approved: Code follows guidelines, data persistence works end-to-end, no emojis used

**November 20, 2025:**
- **Fluxo de Atendimento (Flow) Feature**: Implemented complete intelligent WhatsApp conversation flow system
  - Created database schema with 3 new tables: `flow_configs`, `keyword_rules`, and `flow_steps`
  - Built FlowAI service (`server/flow-ai.service.ts`) integrating OpenAI for intelligent response generation
  - Implemented lazy initialization for OpenAI client (prevents server crashes when API key is missing)
  - Added complete CRUD API routes for flows, keywords, and steps with Zod validation
  - Created `/api/ia/preview` endpoint for testing AI responses in real-time
  - Built comprehensive frontend page (`client/src/pages/fluxo.tsx`) with three sections:
    - Standard Messages (welcome, institutional, important instructions)
    - Keyword-based Rules (automatic responses for specific keywords)
    - AI-powered Flow (multi-step intelligent conversations with OpenAI)
  - Pre-populated with Seguro IA context (insurance-specific flow templates)
  - Added navigation route `/fluxo` and sidebar menu item
  - All elements include proper `data-testid` attributes for testing
  - **Mobile Responsive Design**: Fully responsive layout with Tailwind breakpoints
    - Adaptive padding (p-4 on mobile, p-6 on desktop)
    - Flex layouts that stack vertically on mobile, horizontally on desktop
    - Grid layouts (2 columns on desktop, 1 column on mobile)
    - Full-width buttons on mobile, auto-width on desktop
    - Responsive text sizes and spacing
    - Break-word utilities for long text content

**Earlier Today:**
- **Complete Supabase Removal**: Fully removed all Supabase dependencies and references
  - Uninstalled `@supabase/supabase-js` package
  - Renamed `server/supabase.service.ts` to `server/storage.service.ts`
  - Renamed class `SupabaseStorageService` to `LocalStorageService`
  - Replaced all `supabasePath` field references with `storagePath` throughout codebase
  - Updated all imports in `server/routes.ts` and `server/chatbot.service.ts`
- **Complete Chatwoot Removal**: Removed all Chatwoot references from active code (historical migration preserved)
- **Database Migration Complete**: Configured new PostgreSQL database (Neon) with DATABASE_URL
- **Security Hardening**: Implemented production-ready local file storage with:
  - Server-side UUID generation for filenames (prevents path traversal attacks)
  - Path validation using realpath and relative path checks (prevents symlink vulnerabilities)
  - File existence verification before URL generation (prevents enumeration attacks)
  - Strict leadId validation using basename and alphanumeric checks
- **File Storage Location**: All uploads now stored in `/uploads` directory with organized structure
- **Database Schema**: Successfully applied all migrations - tables created: users, leads, conversations, messages, documents, chatbotStates, vehicles, quotes, auditLogs, workflowTemplates, systemSettings, flow_configs, keyword_rules, flow_steps

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