# AGENTS.md — WhatsApp AI Agent (Wire)

Guidelines for AI coding agents (Codex, Copilot, etc.) working in this repo.

## What this project does

Wire is a production-ready WhatsApp AI agent built on Next.js 14. It replaces
n8n-style automation with a single app that handles the Meta webhook, calls an
AI model, and provides a real-time operator dashboard.

## Repository layout

```
app/api/webhook/        Core webhook: Meta verification + message handling
app/api/conversations/  REST endpoints for the dashboard frontend
app/page.tsx            Dashboard UI (client, uses Supabase Realtime)
components/             Sidebar (conversation list) + ChatPanel (thread view)
lib/                    Shared utilities: Supabase clients, WhatsApp API, AI
types/                  Shared TypeScript interfaces
supabase/migrations/    SQL schema — apply once to your Supabase project
```

## How to run

```bash
npm install
cp .env.example .env.local   # fill in all values
npm run dev                  # http://localhost:3000
```

For local webhook testing, expose port 3000 with ngrok:
```bash
ngrok http 3000
# Use the https URL as your Meta webhook Callback URL
```

## Required environment variables

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business Suite → System Users → Generate Token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta App → WhatsApp → API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Any random string — enter the same value in Meta webhook config |
| `OPENROUTER_API_KEY` | openrouter.ai/keys |
| `OPENROUTER_MODEL` | e.g. `openai/gpt-4o-mini` (default) |

## Core logic — do not break these invariants

1. **Webhook always returns 200.** Meta retries on non-2xx. Catch errors,
   log them, but always respond 200 to the webhook POST.

2. **Duplicate protection via `whatsapp_msg_id`.** The `messages` table has a
   unique constraint on this column. A conflict (code `23505`) means Meta
   retried a message we already handled — ignore it silently.

3. **Respect `conversation.mode`.** Only call the AI and send a reply when
   `mode === 'agent'`. When `mode === 'human'`, store the inbound message and
   stop — a human replies from the dashboard.

4. **Never import `getSupabaseServerClient` in client components.** It uses
   the service role key which must stay server-side only.

## Key files to understand first

- `app/api/webhook/route.ts` — the heart of the app
- `lib/whatsapp.ts` — `parseIncomingMessage()` and `sendWhatsAppMessage()`
- `lib/ai.ts` — `generateAiReply()` with the system prompt
- `types/index.ts` — shared types used everywhere

## Database

Tables: `conversations`, `messages`. Schema is in
`supabase/migrations/001_create_conversations_and_messages.sql`.

Apply it via the Supabase SQL editor or the Supabase MCP server
(`apply_migration` tool, configured in `.mcp.json`).

## Coding conventions

- TypeScript strict mode — no `any` unless unavoidable
- App Router only — no Pages Router patterns
- Tailwind for all styling — no CSS modules or inline styles
- `"use client"` only where genuinely needed (data fetching, subscriptions, event handlers)
- One responsibility per file — don't add unrelated logic to existing route handlers

## Out of scope for this repo

- SMS / email channels
- Multi-tenant / per-user configurations
- Payment or order management
- Voice messages (WhatsApp audio) — currently ignored at the webhook level

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
