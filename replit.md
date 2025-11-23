# Overview

Seguro IA is a WhatsApp-based CRM and intelligent customer service system tailored for the insurance industry. Its core purpose is to automate customer interactions, streamline lead management, track conversations, and automate follow-ups directly through the WhatsApp platform. The system aims to significantly enhance customer relationship management and improve the efficiency of customer service operations.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The frontend leverages React 18 with TypeScript, built using Vite. It employs Wouter for routing and TanStack Query for server state management. UI components are crafted with Shadcn/ui (based on Radix UI primitives) and styled using Tailwind CSS, featuring a responsive, dark-themed design with a custom HSL-based color system. State management integrates React Query for server data, WebSockets for real-time updates, and the Context API for authentication.

## Backend Architecture

The backend is developed with Express.js and TypeScript, incorporating session-based authentication, a WebSocket server for real-time communication, and security middleware (helmet, rate limiting). PostgreSQL serves as the primary database, managed through Drizzle ORM for type-safe operations. Key data models include Leads, Conversations, Messages, ChatbotStates, FlowConfigs, FollowupMessages, WorkflowTemplates, and Instances. The service layer encompasses ChatbotService, WAHAService, EvolutionAPIService, FollowupService, FlowAIService, and LocalStorageService. Security measures include environment-based credentials, secure cookies, webhook authentication, and rate limiting.

## UI/UX Decisions

The system employs a dark-themed design system using Tailwind CSS and Shadcn/ui components, ensuring responsiveness across devices. Key UI elements include a QR code modal for WhatsApp connection with auto-refresh, status-dependent action buttons, and toggle switches for controlling chatbot and follow-up functionalities per instance.

## Technical Implementations

- **Multi-Instance Architecture**: Supports simultaneous operation of multiple WhatsApp instances, each with independent chatbot and follow-up configurations.
- **Per-Instance Control**: Provides granular control to enable or disable chatbot and follow-up functionalities for individual WhatsApp instances.
- **Tag Replacement System**: Implements dynamic tag replacement in messages for elements like current date (`[DD/MM/AAAA]`) and client protocol numbers (`[NÚMERO_DO_PROTOCOLO]`).
- **WhatsApp Instance Management**: Offers a dedicated interface for managing WhatsApp connections, including QR code scanning, status monitoring, and instance lifecycle operations (start, stop, delete).
- **Automated WAHA Configuration**: Automatically configures essential webhook events (`message`, `session.status`) and injects `X-Api-Key` headers for WAHA integration, simplifying setup and preventing misconfigurations.

# External Dependencies

## WhatsApp Integration

- **Primary**: WAHA (WhatsApp HTTP API) for message exchange and instance management. Configuration uses `WAHA_API` and `WAHA_API_KEY`.
- **Alternative**: Evolution API, configurable via `EVOLUTION_URL` and `EVOLUTION_KEY`.
- Utilizes webhook-based message reception with signature validation.

## AI Services

- OpenAI GPT for intelligent conversation routing, response generation, and flow step previews. Configured with `OPENAI_API_KEY`.

## Database

- PostgreSQL, compatible with serverless solutions (e.g., Neon). Connection via `DATABASE_URL`.
- Drizzle ORM for database interactions and Drizzle Kit for schema migrations.

## File Storage

- Local filesystem storage in the `/uploads` directory for media and documents, with security validations for path and file types.

## Real-time Communication

- WebSocket server facilitates real-time updates for conversations, messages, and lead changes, featuring session-based authentication and automatic reconnection.

## Environment Configuration

- **Required**: `DATABASE_URL`, `LOGIN`, `SENHA`, `SESSION_SECRET`.
- **WhatsApp**: `WAHA_API`, `WAHA_API_KEY` (for WAHA), or `EVOLUTION_URL`, `EVOLUTION_KEY` (for Evolution).
- **AI**: `OPENAI_API_KEY`.