# Wire — WhatsApp AI Agent Console

A Next.js app that receives WhatsApp messages via the official Meta WhatsApp
Business API, replies using an AI model (through OpenRouter), stores every
conversation in Supabase, and gives you a live dashboard to watch and take
over any thread.

## 1. Install

```bash
npm install
```

## 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migration in `supabase/migrations/001_create_conversations_and_messages.sql`
   against your project — either paste it into the Supabase SQL editor, or
   apply it through the Supabase MCP server (`.mcp.json` is preconfigured for
   this; swap in your project ref and access token).
3. In **Database → Replication**, confirm the `messages` and `conversations`
   tables are added to the `supabase_realtime` publication (the migration
   does this for you, but it's worth checking).
4. Copy your project URL, anon key, and service role key from
   **Project Settings → API**.

## 3. Set up Meta WhatsApp Business API

1. Create a Meta App at [developers.facebook.com](https://developers.facebook.com)
   and add the **WhatsApp** product.
2. Grab the **Phone Number ID** and a **permanent access token** (generate
   this from a System User in Meta Business Suite — the token from the quick
   start expires in 24 hours, a System User token doesn't).
3. Pick any random string for `WHATSAPP_VERIFY_TOKEN` — you'll enter the same
   value in the Meta dashboard when you configure the webhook.

## 4. Set up OpenRouter

Create a key at [openrouter.ai](https://openrouter.ai/keys). Any
OpenAI-compatible model slug works for `OPENROUTER_MODEL` (defaults to
`openai/gpt-4o-mini`).

## 5. Environment variables

```bash
cp .env.example .env.local
```

Fill in every value in `.env.local`.

## 6. Run locally

```bash
npm run dev
```

The dashboard is at `http://localhost:3000`. To receive real WhatsApp
messages locally, tunnel the webhook with ngrok:

```bash
ngrok http 3000
```

## 7. Configure the webhook in Meta

In your Meta App → WhatsApp → Configuration:

- **Callback URL**: `https://<your-domain>/api/webhook`
- **Verify token**: the same string you set as `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the **messages** webhook field

Meta will hit `GET /api/webhook` once to verify, then start POSTing incoming
messages.

## 8. Deploy

Push to Vercel (or any Node host) and set the same environment variables
there. Update the Meta webhook Callback URL to your production domain.

## How it works

- **`app/api/webhook/route.ts`** — receives messages, stores them, and (in
  Agent mode) asks the model for a reply and sends it back over WhatsApp.
- **Agent vs. Human mode** — each conversation has a `mode`. In Agent mode
  the bot replies automatically. Flip a conversation to Human mode from the
  dashboard and the bot goes quiet — replies you type in the chat panel are
  sent directly, no AI involved.
- **Dashboard** — subscribes to Supabase Realtime, so new messages and mode
  changes appear instantly without polling.
- **Duplicate protection** — `messages.whatsapp_msg_id` is unique; Meta's
  webhook retries on a slow response just hit a constraint violation that's
  silently ignored.

## Notes / things to harden before production

- The webhook currently only handles `type: "text"` messages — images, audio,
  location, and interactive replies are ignored.
- There's no signature verification on the webhook (`X-Hub-Signature-256`).
  Worth adding if this is public-facing.
- Conversation history sent to the model is capped at the last 20 messages
  (`MAX_HISTORY_MESSAGES` in `app/api/webhook/route.ts`) — tune to taste.
- No auth on the dashboard itself — add one before deploying somewhere
  public.
