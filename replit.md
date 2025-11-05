# Seguro IA - WhatsApp CRM with AI Chatbot

## Overview
This is a comprehensive CRM (Customer Relationship Management) system designed for managing leads and customer interactions through WhatsApp. The application features an AI-powered chatbot for automated customer service and integrates with WhatsApp Business APIs (WAHA and Evolution API) for seamless communication.

## Project Type
Full-stack TypeScript application with:
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js + Node.js
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT integration for conversational AI
- **WhatsApp**: WAHA/Evolution API integration

## Architecture

### Frontend (Port 5000)
- Modern React application with TypeScript
- Routing with Wouter
- State management with TanStack Query
- Beautiful UI components from shadcn/ui
- Responsive design with Tailwind CSS

### Backend (Port 3000)
- Express.js REST API
- Session-based authentication
- WebSocket support for real-time features
- File upload handling with Multer
- Security: Helmet, rate limiting, webhook authentication

### Database
- PostgreSQL with Drizzle ORM
- Schema-based migrations
- Tables: leads, conversations, messages, documents, chatbot_states, vehicles, quotes, workflows, audit_logs, system_settings

## Key Features

### 1. Lead Management
- Create, view, edit, and track customer leads
- Lead status tracking (novo, em_atendimento, aguardando_documentos, etc.)
- Priority management (baixa, normal, alta, urgente)
- Document attachments
- Vehicle and quote information

### 2. WhatsApp Integration
- Send/receive messages through WAHA or Evolution API
- Audio transcription
- Media file handling (images, documents)
- Session management
- Webhook processing for incoming messages

### 3. AI-Powered Chatbot
- **Intelligent Menu Recognition** (100% local, no API dependency):
  - Recognizes direct numbers (1, 2, 3...)
  - Recognizes written numbers in Portuguese (um, dois, três...)
  - Recognizes emoji numbers (1️⃣, 2️⃣...)
  - Recognizes greetings as option 1 default (oi, olá, bom dia...)
  - Keyword-based intent detection for all menu options
  - Automatic accent normalization for better matching
- Optional OpenAI GPT integration for advanced conversational AI
- Workflow-based conversation flows
- Context-aware responses
- Data extraction from conversations
- Message buffering and intelligent batching

### 4. Workflow Automation
- Customizable conversation flows
- Step-by-step customer interaction
- Conditional logic and branching
- Template management with versioning
- AI-generated workflow suggestions

### 5. Dashboard & Analytics
- Real-time metrics (total leads, active conversations)
- Conversion rate tracking
- Lead distribution by status and priority
- Visual charts and graphs (Recharts)
- Activity monitoring

### 6. Conversation Management
- Active conversation view
- Message history
- Real-time updates (5-second polling)
- Chat interface for customer interactions

## Environment Variables

### Required (Core Application)
- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned by Replit)
- `LOGIN` - Admin username for authentication (default: "1")
- `SENHA` - Admin password for authentication (default: "1")
- `SESSION_SECRET` - Express session secret for secure cookies (auto-generated)

### Optional (Database Migration)
- `SUPABASE_DATABASE_URL` - Supabase PostgreSQL connection string for database migration

### Optional (WhatsApp Integration - WAHA)
- `WAHA_API` - WAHA API endpoint URL (e.g., https://waha.evolutiaoficial.com)
- `WAHA_API_KEY` - WAHA API authentication key (**REQUIRED** if using WAHA)
- `WAHA_INSTANCIA` - WAHA instance/session name (default: "ChatwootApi")

### Optional (WhatsApp Integration - Evolution API)
- `EVOLUTION_URL` - Evolution API endpoint URL
- `EVOLUTION_KEY` - Evolution API authentication key
- `EVOLUTION_WEBHOOK_SECRET` - Webhook signature validation secret
- `INSTANCIA` - Evolution instance name

### Optional (AI Features)
- `OPENAI_API_KEY` - OpenAI API key for advanced chatbot functionality

### Security Notes
- **NEVER** hardcode secrets or API keys in the code
- All sensitive values must be stored in Replit Secrets
- Scripts will fail with clear error messages if required secrets are missing
- Rotate all API keys and passwords after any suspected exposure

## Project Structure

```
├── client/               # Frontend React application
│   ├── src/
│   │   ├── components/  # UI components (shadcn/ui)
│   │   ├── contexts/    # React contexts (Auth)
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utilities and query client
│   │   ├── pages/       # Main application pages
│   │   └── assets/      # Images and static assets
│   └── index.html
├── server/              # Backend Express application
│   ├── middleware/      # Auth, security, webhook validation
│   ├── schemas/         # Validation schemas
│   ├── tests/          # Environment and service tests
│   ├── chatbot.service.ts  # AI chatbot logic
│   ├── waha.service.ts     # WhatsApp API integration
│   ├── evolution.service.ts # Evolution API integration
│   ├── routes.ts        # API endpoints
│   ├── storage.ts       # Database operations
│   ├── db.ts           # Database connection
│   └── index.ts        # Server entry point
├── shared/              # Shared types and schemas
│   └── schema.ts       # Drizzle ORM schema definitions
└── uploads/            # User-uploaded files

```

## Database Schema

### Core Tables
- **leads** - Customer information and contact details
- **conversations** - Active chat sessions with customers
- **messages** - Chat message history
- **chatbot_states** - Conversation state machine
- **documents** - Uploaded files (PDFs, images)
- **vehicles** - Vehicle information for insurance quotes
- **quotes** - Insurance quote details
- **workflow_templates** - Chatbot conversation flows
- **workflow_versions** - Version history for workflows
- **workflow_transitions** - State machine transitions
- **system_settings** - Application configuration
- **audit_logs** - Activity tracking

## Development

### Running Locally
```bash
npm install        # Install dependencies
npm run db:push    # Push database schema
npm run dev        # Start both frontend and backend
```

### Database Migrations
- Never write SQL migrations manually
- Use `npm run db:push` to sync schema changes
- Use `npm run db:push --force` if data loss warnings appear

### Available Scripts
- `npm run dev` - Run frontend and backend concurrently
- `npm run dev:server` - Run backend only (port 3000)
- `npm run dev:client` - Run frontend only (port 5000)
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run db:push` - Push database schema changes
- `npm run check` - TypeScript type checking

## Recent Changes (November 2025)

### Supabase Database Migration (November 5, 2025)
- **FEATURE**: Complete database migration system to Supabase PostgreSQL
- **Migration Scripts**: Created automated migration pipeline with 4 stages:
  1. Data export from current database (DATABASE_URL)
  2. Schema application (tables, enums, indices, foreign keys)
  3. Data import with automatic camelCase to snake_case conversion
  4. Integrity verification and validation
- **Security**: All database credentials stored in environment variables (Replit Secrets)
- **Documentation**: Comprehensive migration guide in `DATABASE_MIGRATION.md`
- **Results**: Successfully migrated 128 records across 13 tables with 32 indices and 7 foreign keys
- **Environment Variable**: Added `SUPABASE_DATABASE_URL` for Supabase connection
- **Scripts Available**:
  - `test-db-connection.ts` - Test Supabase connectivity
  - `migrate-to-supabase.ts` - Full migration pipeline
  - `verify-supabase-db.ts` - Detailed database verification
- See `DATABASE_MIGRATION.md` for complete documentation and usage instructions

### Smart Data Extraction with OpenAI (November 5, 2025)
- **FEATURE**: Intelligent partial data extraction using OpenAI GPT-4
- **AI-Powered Extraction**: OpenAI GPT-4 for advanced natural language understanding
  - Extracts: nome, CPF, email, CEP, telefone, data de nascimento, profissão, endereço, estado civil
  - Handles multiple input patterns: "Gabriel Alves Marques, 54498358848"
  - Supports natural phrasings: "Meu nome é João Silva, sou engenheiro"
  - Understands context and intent for accurate field mapping
- **Progressive Collection**: System saves partial data and requests only missing fields
- **Validation**: Checks completeness before advancing workflow states
- **Error Handling**: When OpenAI is unavailable, bot directs customer to human agent
- **IMPORTANT**: Requires active OpenAI API key with credits
- Fixed message prefix bug ("Mensagem N:") that broke menu recognition

### Menu Intent Recognition System (November 5, 2025)
- **CRITICAL FIX**: Replaced OpenAI-dependent menu recognition with robust local pattern matching
- System now works 100% reliably without requiring OpenAI API quota
- Comprehensive recognition capabilities:
  - Direct numbers: "1", "2", "3"
  - Written numbers: "um", "dois", "três", "primeiro", "segunda"
  - Emoji numbers: 1️⃣, 2️⃣, 3️⃣
  - Greetings default to option 1: "oi", "olá", "bom dia", "boa tarde"
  - Keyword matching for all 6 menu options with accent normalization
- Fixed all LSP errors in webhook configuration files
- Added detailed logging for debugging menu selection process

### Initial Replit Setup
- Configured Vite for Replit environment with proper host settings (0.0.0.0)
- **CRITICAL FIX**: Added `allowedHosts: true` to Vite config to allow Replit proxy domains
- Set up HMR (Hot Module Reload) to work with Replit's proxy
- Provisioned PostgreSQL database and pushed schema
- Configured concurrent workflow for frontend (port 5000) and backend (port 3000)
- Updated environment variables for authentication

### Configuration Notes
- The `allowedHosts: true` setting in `vite.config.ts` is **essential** for Replit - without it, Vite blocks requests from the dynamic Replit preview domains
- Minor WebSocket HMR connection warnings in console are expected and don't affect functionality
- Menu recognition works entirely offline - OpenAI API key is optional and only used for advanced conversational features

## User Preferences
- Language: Portuguese (Brazilian)
- Application name: "Seguro IA" (Insurance AI)
- Login credentials: Username "1", Password "1" (for development)

## Security Notes
- Session-based authentication with secure cookies
- Helmet security headers enabled
- Rate limiting on API endpoints
- Webhook signature validation
- File upload restrictions (10MB, specific file types)
- Audit logging for sensitive operations

## Technologies Used
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Radix UI, Framer Motion
- **Backend**: Express, TypeScript, OpenAI SDK, Multer, Passport
- **Database**: PostgreSQL, Drizzle ORM
- **UI Components**: shadcn/ui (complete component library)
- **Charts**: Recharts
- **Date Handling**: date-fns
- **Form Handling**: React Hook Form + Zod validation
- **HTTP Client**: TanStack Query (React Query)
