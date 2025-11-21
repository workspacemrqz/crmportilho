# Overview

This project is a CRM and chatbot system named "Seguro IA" (Insurance AI), designed to streamline customer interactions primarily through WhatsApp. Its core purpose is to manage leads, track conversations, facilitate document uploads, and provide automated, AI-driven chatbot responses for insurance-related inquiries. The system aims to enhance customer engagement and operational efficiency for insurance businesses. It's built as a full-stack TypeScript application with real-time capabilities.

# Recent Changes

**November 21, 2025 - Implemented Two Types of Flow Nodes (COMPLETE)**
- Implemented support for two distinct types of conversation nodes in the visual flow editor
- **Feature**: Diferenciação entre nodes com IA e nodes com mensagem fixa
- **Implementation Details**:
  - **Database Schema**:
    * Added `stepType` enum ('ai' | 'fixed') to flow_steps table
    * Default value: 'ai' (maintains backward compatibility)
  - **Frontend - Editor Interface**:
    * Two creation buttons: "Mensagem com IA" (Sparkles icon) and "Mensagem fixa" (MessageSquare icon)
    * Visual differentiation: AI nodes (blue background/border) vs Fixed nodes (green background/border)
    * Badge indicators on nodes showing "IA" or "Fixa"
  - **Frontend - Edit Panel**:
    * Conditional field rendering based on stepType
    * AI nodes: Show all fields (stepPrompt, routingInstructions, AI testing)
    * Fixed nodes: Show simplified fields (stepName, objective, buffer, transitions)
    * Fixed nodes use "Mensagem Fixa" textarea field instead of AI prompts
  - **Backend Processing**:
    * `processFlowStep()`: Routes to appropriate handler based on stepType
    * `processFixedMessageStep()`: Sends fixed message directly, no AI call
    * `processAIStep()`: Maintains existing AI-powered logic
    * Intelligent transition handling for both types (auto-advance or wait for user response)
  - **Seed Script**:
    * Created `server/seed-templates.ts` to ensure MENSAGEM1/MENSAGEM2 templates exist
    * Command: `npm run db:seed` to populate welcome message templates
- **User Experience**: Create AI-powered or fixed message nodes, edit them with appropriate controls, and the backend processes each type correctly. Fixed message nodes send predefined text without AI costs.

**November 21, 2025 - Configured Prevline Welcome Messages (COMPLETE)**
- Created MENSAGEM1 (Prevline company introduction) and MENSAGEM2 (IAGO assistant greeting) templates
- Templates stored in `workflow_templates` database table
- ChatbotService automatically sends both messages sequentially when conversation starts
- Buffer configured to 0 seconds for immediate delivery

**November 21, 2025 - Implemented Automatic Step ID Generation System (COMPLETE)**
- Implemented automatic generation of step IDs based on step titles in the visual flow editor
- **Feature**: Step IDs are automatically generated from titles (e.g., "Identificação Inicial" → "identificacao_inicial")
- **Implementation Details**:
  - **generateStepId() utility**: Normalizes Unicode (removes accents), converts to lowercase, replaces spaces/special chars with underscores, validates uniqueness with numeric suffix
  - **Read-only step ID field**: Campo stepId é disabled para garantir que todas as mudanças passem pelo sistema coordenado
  - **"Gerar ID a partir do Título" button**: RefreshCw icon triggers coordinated ID regeneration
  - **Robust forwardRef Architecture**:
    * FlowEditor uses forwardRef + useImperativeHandle to expose `applyStepIdRename(mapping, updatedSteps)`
    * Coordinator pattern: fluxo.tsx's `handleRegenerateStepId` orchestrates ALL updates atomically
  - **Atomic Coordinated Updates**:
    1. Generate newStepId with collision detection
    2. Build updatedSteps with ALL transitions updated (including self-referential loops)
    3. Call flowEditorRef.applyStepIdRename() SYNCHRONOUSLY:
       - Migrates positionsRef and nodesMapRef
       - Updates React Flow nodes state immediately
       - Reconstructs edges IMMEDIATELY from updatedSteps (no flickering)
       - Uses node state as fallback if cache missing
    4. Migrate previewResults Map
    5. Update parent states (setSteps, setSelectedNodeId)
  - **Structures Updated Atomically**:
    * React Flow nodes state (via setNodes)
    * React Flow edges state (via setEdges - rebuilt immediately)
    * positionsRef cache
    * nodesMapRef cache
    * steps[].stepId (renamed step)
    * steps[].transitions[].targetStepId (ALL transitions including self-loops)
    * previewResults Map
    * selectedNodeId
- **User Experience**: Click refresh button to generate clean IDs from titles while preserving all connections, layout, and cache. Edges appear immediately without visual glitches. Saving flow persists correct IDs.

**November 21, 2025 - Fixed Visual Flow Editor Node Deletion Bug**
- Fixed a critical bug in the visual flow editor (`/fluxo`) where deleted nodes would reappear when clicking "Adicionar Etapa" (Add Step)
- Root cause: Two related issues:
  1. The `handleAddNode` callback in `FlowEditor.tsx` was capturing a stale reference to the `steps` array due to JavaScript closure
  2. When users deleted nodes using the Delete key (React Flow native functionality), the `handleNodesChange` handler wasn't updating the parent component's `steps` state
- Solution:
  - Modified `onStepsChange` prop type to accept both array values and functional updaters: `(steps: FlowStep[] | ((prev: FlowStep[]) => FlowStep[]) => void`
  - Updated `handleAddNode` to use functional update pattern: `onStepsChange((currentSteps) => [...currentSteps, newStep])`
  - Added handler for `change.type === 'remove'` events in `handleNodesChange` to properly sync node deletions with parent state
  - Converted both position updates and node removals in `handleNodesChange` to use functional updates, preventing stale data issues
- Node deletion now works correctly via both Delete key and the edit panel's delete button

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