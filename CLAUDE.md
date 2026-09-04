# CLAUDE.md — WhatsApp AI Agent (Wire)

This file tells Claude Code how to work in this repository.

## Project overview

Wire is a Next.js 14 App Router app that:

- Receives WhatsApp messages via Meta's WhatsApp Business Cloud API
- Replies automatically using an AI model via OpenRouter
- Stores all conversations and messages in Supabase PostgreSQL
- Uses Supabase Realtime for the dashboard
- Provides a real-time dashboard to view and take over conversations
- Supports incoming WhatsApp media
- Downloads WhatsApp media from Meta and stores it in Supabase Storage
- Detects links sent through WhatsApp text messages
- Stores detected links in Supabase Storage
- Stores both the original link and the Supabase Storage URL

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14+ App Router |
| Language | TypeScript |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage |
| Realtime | Supabase Realtime |
| WhatsApp | Meta WhatsApp Business Cloud API |
| AI | OpenRouter |
| AI Model | MiniMax M3 |
| Styling | Tailwind CSS |
| Deployment | Vercel or any Node.js host |

## Key commands

```bash
npm install
npm run dev
npm run build
npm run lint