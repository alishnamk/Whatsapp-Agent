import { SYSTEM_PROMPT } from "./system-prompt";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiReplyResult {
  reply: string;
  needsHuman: boolean;
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const MODEL = process.env.OPENROUTER_MODEL || "minimax/minimax-m3:free";

// Emitted by the model (see system-prompt.ts) when the user wants
// to book something, discuss pricing/timelines, or explicitly asks
// for a human. Stripped before the customer ever sees it.
const HANDOFF_MARKER = "[[HANDOFF:HUMAN]]";

export async function generateAiReply(
  history: ChatMessage[],
  opts: { forceIntro?: boolean } = {}
): Promise<AiReplyResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const isFirstMessage =
    opts.forceIntro ??
    (history.length === 1 && history[0]?.role === "user");

  const conversationInstruction = isFirstMessage
    ? `
GIVE THE INTRODUCTION for this reply — the current message is either the very first message in this conversation, or a fresh greeting/opening-style message (see "INTRODUCTION" above). Give the full introduction described there, then respond to the user's actual message.

If the user only gives a greeting: introduce yourself, mention the services, then ask how you can help.

If the user gives a specific question along with the greeting: introduce yourself, mention the services, then answer within the scope described above.
`
    : `
THIS IS A FOLLOW-UP, NON-GREETING MESSAGE.

Do NOT introduce yourself again and do NOT repeat the service list — continue the conversation naturally, staying within the scope and handoff rules described above.
`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://swayaan.com",
      "X-Title": "Invoice Intake WhatsApp AI Agent",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT + conversationInstruction,
        },
        ...history,
      ],
      max_tokens: 500,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenRouter API error:", {
      status: response.status,
      error: data,
    });
    throw new Error(
      data?.error?.message ||
        `OpenRouter API request failed with status ${response.status}`
    );
  }

  const rawReply: string | undefined = data?.choices?.[0]?.message?.content?.trim();

  if (!rawReply) {
    return {
      reply:
        "Sorry, I couldn't process that right now. Please contact us at info@swayaan.com or +91 9845733399.",
      needsHuman: false,
    };
  }

  const needsHuman = rawReply.includes(HANDOFF_MARKER);

  // Strip the marker (and any stray surrounding whitespace/newline
  // it leaves behind) so it never reaches the customer.
  const reply = rawReply.replace(HANDOFF_MARKER, "").trim();

  return { reply, needsHuman };
}