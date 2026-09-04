import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase";

import {
  parseIncomingMessage,
  sendWhatsAppMessage,
  uploadMediaToStorage,
  getMediaCategory,
} from "@/lib/whatsapp";

import {
  ChatMessage,
  generateAiReply,
} from "@/lib/ai";

const MAX_HISTORY_MESSAGES = 20;
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;

const OPENING_PATTERNS = [
  /^(hi+|hey+|hello+|yo|hii+|helo+|namaste|namaskar|hola|start|menu)\b/,
  /^good\s+(morning|afternoon|evening|day)\b/,
  /^(who|what)\s+(are|is)\s+(you|this)\b/,
  /\bwhat\s+(do|does)\s+you\s+do\b/,
  /\btell\s+me\s+about\s+(you|this)\b/,
  /\bhow\s+(do|does)\s+this\s+work\b/,
];

// Detect URLs in plain text messages
function extractUrls(text: string): string[] {
  const urlPattern = /(?:https?:\/\/|www\.)[^\s]+/gi;
  return text.match(urlPattern) || [];
}

function isOpeningMessage(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");

  return OPENING_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

// ---------------------------------------------------------
// Meta webhook verification
// ---------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, {
      status: 200,
    });
  }

  return new NextResponse("Forbidden", {
    status: 403,
  });
}

// ---------------------------------------------------------
// WhatsApp webhook
// ---------------------------------------------------------

export async function POST(req: NextRequest) {
  let payload: unknown;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({
      ok: true,
    });
  }

  const incoming = parseIncomingMessage(payload);

  if (!incoming) {
    return NextResponse.json({
      ok: true,
    });
  }

  try {
    await handleIncomingMessage(incoming);
  } catch (err) {
    console.error(
      "Error handling incoming WhatsApp message",
      err
    );
  }

  // Always return 200 to Meta.
  return NextResponse.json({
    ok: true,
  });
}

// ---------------------------------------------------------
// Main incoming-message handler
// ---------------------------------------------------------

async function handleIncomingMessage(
  incoming: NonNullable<
    ReturnType<typeof parseIncomingMessage>
  >
) {
  const supabase = getSupabaseServerClient();

  // ---------------------------------------------------------
  // 1. Find or create conversation
  // ---------------------------------------------------------

  const {
    data: existing,
    error: findErr,
  } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone", incoming.from)
    .maybeSingle();

  if (findErr) {
    throw findErr;
  }

  let conversation = existing;

  if (!conversation) {
    const {
      data: created,
      error: createErr,
    } = await supabase
      .from("conversations")
      .insert({
        phone: incoming.from,
        name: incoming.contactName,
      })
      .select("*")
      .single();

    if (createErr) {
      throw createErr;
    }

    conversation = created;
  } else if (
    incoming.contactName &&
    conversation.name !== incoming.contactName
  ) {
    await supabase
      .from("conversations")
      .update({
        name: incoming.contactName,
      })
      .eq("id", conversation.id);
  }

  // ---------------------------------------------------------
  // 2. Detect media / links
  // ---------------------------------------------------------

  let mediaUrl: string | null = null;

  let mediaCategory = getMediaCategory(
    incoming.mimeType
  );

  let extractedUrls: string[] = [];

  // ---------------------------------------------------------
  // 2A. Detect URLs (metadata only — links are never saved to
  // disk; this is a receipts/invoice intake system and only
  // photos/documents get written to local storage, see 2B).
  // ---------------------------------------------------------

  if (
    incoming.type === "text" &&
    incoming.text
  ) {
    extractedUrls = extractUrls(
      incoming.text
    );

    if (extractedUrls.length > 0) {
      mediaCategory = "link" as typeof mediaCategory;
    }
  }

  // ---------------------------------------------------------
  // 2B. Download and save receipts (photos/documents only) —
  // uploadMediaToStorage() itself skips audio/video/stickers.
  // ---------------------------------------------------------

  if (
    incoming.type !== "text" &&
    incoming.mediaId
  ) {
    console.log(
      `Downloading ${incoming.type} from Meta...`,
      {
        mediaId: incoming.mediaId,
        mimeType: incoming.mimeType,
      }
    );

    const result =
      await uploadMediaToStorage(
        supabase,
        incoming
      );

    mediaUrl = result.mediaUrl;

    if (mediaUrl) {
      console.log(
        `✅ Receipt saved locally: ${mediaUrl}`
      );
    } else {
      console.log(
        `ℹ️ No local file saved for this ${incoming.type} message (only photos/documents are stored as receipts) — metadata only`
      );
    }
  }

  // ---------------------------------------------------------
  // 3. Store incoming message
  // ---------------------------------------------------------

  const {
    error: insertErr,
  } = await supabase
    .from("messages")
    .insert({
      conversation_id:
        conversation.id,

      role: "user",

      content:
        incoming.text ??
        incoming.caption ??
        null,

      whatsapp_msg_id:
        incoming.whatsappMsgId,

      message_type:
        incoming.type,

      media_id:
        incoming.mediaId,

      mime_type:
        incoming.mimeType,

      filename:
        incoming.filename,

      media_caption:
        incoming.caption,

      media_sha256:
        incoming.sha256,

      // Local receipt file path (photos/documents only — see
      // uploadMediaToStorage). null for text, links, audio, video,
      // and stickers.
      media_url:
        mediaUrl,

      // Original URL
      link_url:
        extractedUrls.length > 0
          ? extractedUrls[0]
          : null,

      media_category:
        incoming.type === "text"
          ? extractedUrls.length > 0
            ? "link"
            : "text"
          : mediaCategory,
    });

  if (insertErr) {
    // Meta retry protection
    if (insertErr.code === "23505") {
      console.log(
        "Duplicate WhatsApp message ignored:",
        incoming.whatsappMsgId
      );

      return;
    }

    throw insertErr;
  }

  // ---------------------------------------------------------
  // 4. Media messages
  // ---------------------------------------------------------

  if (incoming.type !== "text") {
    console.log(
      `Stored ${incoming.type}. media_url: ${
        mediaUrl ?? "null"
      }`
    );

    if (conversation.mode === "agent") {
      // Only photos and documents are actually saved as receipts
      // (see uploadMediaToStorage) — the acknowledgment reflects
      // that: a confirmation when it was saved, or a plain "not
      // accepted, please resend" when it wasn't (audio/video/
      // stickers).
      const UNSUPPORTED_MEDIA_REPLY =
        "Sorry, we don't accept that type of file here. Please send your receipt/invoice as a photo or a document (PDF).";

      const ackMessages: Record<
        string,
        string
      > = {
        image: mediaUrl
          ? "🧾 Receipt received, thank you!"
          : "We couldn't save that image. Please resend it as a clear photo of the receipt/invoice.",

        document: mediaUrl
          ? `🧾 Receipt received${
              incoming.filename
                ? ` (${incoming.filename})`
                : ""
            }, thank you!`
          : `We couldn't save that document${
              incoming.filename
                ? ` (${incoming.filename})`
                : ""
            }. Please resend it as a photo or a document (e.g. PDF).`,

        video: UNSUPPORTED_MEDIA_REPLY,
        audio: UNSUPPORTED_MEDIA_REPLY,
        sticker: UNSUPPORTED_MEDIA_REPLY,
      };

      const ack =
        ackMessages[incoming.type] ?? UNSUPPORTED_MEDIA_REPLY;

      await sendWhatsAppMessage(
        incoming.from,
        ack
      );

      await supabase
        .from("messages")
        .insert({
          conversation_id:
            conversation.id,

          role: "assistant",

          sender: "ai",

          content: ack,

          message_type: "text",

          media_category: "text",
        });
    }

    return;
  }

  // ---------------------------------------------------------
  // 5. Respect conversation mode
  // ---------------------------------------------------------

  if (conversation.mode !== "agent") {
    return;
  }

  // ---------------------------------------------------------
  // 6. Get conversation history
  // ---------------------------------------------------------

  const {
    data: historyRows,
    error: historyErr,
  } = await supabase
    .from("messages")
    .select(
      "role, content, created_at"
    )
    .eq(
      "conversation_id",
      conversation.id
    )
    .order("created_at", {
      ascending: false,
    })
    .limit(
      MAX_HISTORY_MESSAGES
    );

  if (historyErr) {
    throw historyErr;
  }

  const ordered =
    (historyRows ?? [])
      .slice()
      .reverse();

  const history: ChatMessage[] =
    ordered.map((message) => ({
      role: message.role as
        | "user"
        | "assistant",

      content:
        message.content ?? "",
    }));

  // ---------------------------------------------------------
  // 7. Check idle time
  // ---------------------------------------------------------

  const previous =
    ordered[
      ordered.length - 2
    ];

  const idleMs = previous
    ? Date.now() -
      new Date(
        previous.created_at
      ).getTime()
    : Infinity;

  // ---------------------------------------------------------
  // 8. Generate AI reply
  // ---------------------------------------------------------

  const { reply: replyText, needsHuman } =
    await generateAiReply(
      history,
      {
        forceIntro:
          history.length === 1 ||
          idleMs > SESSION_IDLE_MS ||
          isOpeningMessage(
            incoming.text ?? ""
          ),
      }
    );

  // ---------------------------------------------------------
  // 9. Send AI reply
  // ---------------------------------------------------------

  const sendResult =
    await sendWhatsAppMessage(
      incoming.from,
      replyText
    );

  if (!sendResult.ok) {
    console.error(
      "Failed to deliver AI reply via WhatsApp",
      sendResult
    );
  }

  // ---------------------------------------------------------
  // 10. Store AI reply
  // ---------------------------------------------------------

  const {
    error: replyInsertErr,
  } = await supabase
    .from("messages")
    .insert({
      conversation_id:
        conversation.id,

      role: "assistant",

      sender: "ai",

      content: replyText,

      message_type: "text",

      media_category: "text",
    });

  if (replyInsertErr) {
    throw replyInsertErr;
  }

  // ---------------------------------------------------------
  // 11. Hand off to a human if the AI flagged it
  // ---------------------------------------------------------

  if (needsHuman) {
    const { error: handoffErr } = await supabase
      .from("conversations")
      .update({ mode: "human" })
      .eq("id", conversation.id);

    if (handoffErr) {
      console.error(
        "Failed to switch conversation to human mode after handoff",
        handoffErr
      );
    }
  }
}