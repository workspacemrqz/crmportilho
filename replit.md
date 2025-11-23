# Overview

Seguro IA is a WhatsApp-based CRM and intelligent customer service system designed for the insurance industry. It automates customer interactions, manages leads, tracks conversations, and automates follow-ups directly through WhatsApp. The system aims to streamline customer relationship management and enhance customer service efficiency.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The frontend uses React 18 with TypeScript, Vite for building, Wouter for routing, and TanStack Query for server state management. UI is built with Shadcn/ui components (Radix UI primitives) and styled with Tailwind CSS, featuring a dark-themed, responsive design and a custom HSL-based color system. State management is handled via React Query for server state, WebSocket for real-time updates, and Context API for authentication.

## Backend Architecture

The backend is built with Express.js and TypeScript. It features session-based authentication, a WebSocket server for real-time communication, and security middleware (helmet, rate limiting). PostgreSQL is the primary database, accessed via Drizzle ORM for type-safe operations. Key data models include Leads, Conversations, Messages, ChatbotStates, FlowConfigs, FollowupMessages, WorkflowTemplates, and Instances. The service layer includes ChatbotService, WAHAService, EvolutionAPIService, FollowupService, FlowAIService, and LocalStorageService. Security is enforced through environment-based credentials, secure cookies, webhook authentication, and rate limiting.

## UI/UX Decisions

The system features a dark-themed design system using Tailwind CSS and Shadcn/ui components, ensuring responsiveness. The UI includes a QR code modal for WhatsApp connection with auto-refresh, status-based action buttons, and toggle switches for per-instance chatbot and follow-up control.

## Technical Implementations

- **Multi-Instance Architecture**: Supports multiple WhatsApp instances concurrently, each with independent chatbot and follow-up configurations.
- **Per-Instance Control**: Allows toggling chatbot and follow-up functionalities for individual WhatsApp instances.
- **Tag Replacement System**: Implements dynamic tag replacement in messages for current date (`[DD/MM/AAAA]`) and client protocol numbers (`[NÚMERO_DO_PROTOCOLO]`).
- **WhatsApp Instance Management**: Provides a dedicated interface for managing WhatsApp connections, including QR code scanning, status monitoring, and instance lifecycle operations (start, stop, delete).
- **Automated WAHA Configuration**: Automatically configures essential webhook events (`message`, `session.status`) and injects `X-Api-Key` headers for WAHA integration, simplifying user setup and preventing misconfigurations.

# External Dependencies

## WhatsApp Integration

- **Primary**: WAHA (WhatsApp HTTP API) for sending/receiving messages and managing instances. Configurable via `WAHA_API`, `WAHA_API_KEY`.
- **Fallback/Alternative**: Evolution API, configurable via `EVOLUTION_URL`, `EVOLUTION_KEY`.
- Uses webhook-based message reception with signature validation.

## AI Services

- OpenAI GPT integration for intelligent conversation routing, response generation, and flow step previews. Configurable via `OPENAI_API_KEY`.

## Database

- PostgreSQL, compatible with serverless solutions like Neon. Connected via `DATABASE_URL`.
- Drizzle ORM for database interactions and Drizzle Kit for migrations.

## File Storage

- Local filesystem storage in the `/uploads` directory for media and documents. Includes security validations for path and file types.

## Real-time Communication

- WebSocket server for real-time updates on conversations, messages, and lead changes, with session-based authentication and automatic reconnection.

## Environment Configuration

- **Required**: `DATABASE_URL`, `LOGIN`, `SENHA`, `SESSION_SECRET`.
- **WhatsApp**: `WAHA_API`, `WAHA_API_KEY` (for WAHA), or `EVOLUTION_URL`, `EVOLUTION_KEY` (for Evolution).
- **AI**: `OPENAI_API_KEY`.