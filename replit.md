# Seguro IA - WhatsApp CRM with AI Chatbot

## Overview
Seguro IA is a comprehensive CRM system designed for managing leads and customer interactions through WhatsApp. It features an AI-powered chatbot for automated customer service and integrates with WhatsApp Business APIs (WAHA and Evolution API) for seamless communication. The project aims to streamline insurance lead management, automate customer engagement, and provide a robust platform for sales and support teams.

## User Preferences
- Language: Portuguese (Brazilian)
- Application name: "Seguro IA" (Insurance AI)
- Login credentials: Username "1", Password "1" (for development)

## System Architecture

### Core Technologies
- **Frontend**: React + Vite + TypeScript, Tailwind CSS, shadcn/ui components, Wouter for routing, TanStack Query for state management.
- **Backend**: Express.js + Node.js with TypeScript, REST API, WebSocket support, Multer for file uploads.
- **Database**: PostgreSQL with Drizzle ORM for schema management and interactions.
- **AI**: OpenAI GPT integration for advanced conversational AI capabilities.

### Key Features
- **Lead Management**: Comprehensive tracking of customer leads, including status, priority, documents, vehicle information, and quotes.
- **WhatsApp Integration**: Bidirectional messaging, audio transcription, media handling, and session management via WAHA or Evolution API.
- **AI-Powered Chatbot**:
    - Intelligent Menu Recognition (100% local, offline): Recognizes numbers (digits, written, emojis), greetings, and keywords.
    - Optional OpenAI GPT integration for advanced conversational flows, context-aware responses, and data extraction.
    - Workflow-based conversation flows with conditional logic.
    - Smart data extraction using OpenAI GPT-4 for partial data collection (e.g., name, CPF, address).
- **Workflow Automation**: Customizable, templated conversation flows with versioning and AI-generated suggestions.
- **Dashboard & Analytics**: Real-time metrics, conversion rate tracking, lead distribution, and visual charts.
- **Conversation Management**: Active conversation view, message history, and real-time updates.

### Design and Security
- **UI/UX**: Modern and responsive design utilizing shadcn/ui components and Tailwind CSS.
- **Authentication**: Session-based authentication with secure cookies, admin username "1" and password "1" for development.
- **Security**: Helmet security headers, rate limiting, webhook signature validation, and file upload restrictions. Sensitive configurations are managed via environment variables.

## External Dependencies

- **WhatsApp Business APIs**:
    - **WAHA API**: For WhatsApp communication (`WAHA_API`, `WAHA_API_KEY`, `WAHA_INSTANCIA`).
    - **Evolution API**: Alternative WhatsApp communication API (`EVOLUTION_URL`, `EVOLUTION_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `INSTANCIA`).
- **OpenAI**: For advanced AI chatbot features and smart data extraction (`OPENAI_API_KEY`).
- **Supabase**:
    - **Supabase Storage**: For document management (bucket "portilho", `SUPABASE_SERVICE_ROLE_KEY`).
    - **Supabase PostgreSQL**: As an optional target for database migrations (`SUPABASE_DATABASE_URL`).
- **Chatwoot**: For CRM integration, including contact and conversation management (`CHATWOOT_API_URL`, `CHATWOOT_API_TOKEN`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID`).