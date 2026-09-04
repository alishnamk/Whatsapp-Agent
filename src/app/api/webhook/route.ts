import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase";

import {
  parseIncomingMessage,
  sendWhatsAppMessage,
  uploadMediaToStorage,
  uploadLinkToStorage,
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
  /\bwhat\s+(do|does)\s+(you|swayaan|your\s+company)\s+do\b/,
  /\btell\s+me\s+about\s+(you|your\s+company|swayaan|your\s+services)\b/,
  /\b(your|the)\s+services\b/,
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

  let linkStorageUrl: string | null = null;

  // ---------------------------------------------------------
  // 2A. Detect and store URLs
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

      linkStorageUrl =
        await uploadLinkToStorage(
          supabase,
          incoming,
          extractedUrls[0]
        );

      if (linkStorageUrl) {
        console.log(
          `✅ Link stored in Supabase Storage: ${linkStorageUrl}`
        );
      } else {
        console.error(
          "❌ Link storage upload failed"
        );
      }
    }
  }

  // ---------------------------------------------------------
  // 2B. Download and upload WhatsApp media
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
        `✅ Media uploaded to Supabase Storage: ${mediaUrl}`
      );
    } else {
      console.error(
        "❌ Media upload failed — storing metadata only"
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

      // Uploaded media or uploaded link
      media_url:
        mediaUrl ?? linkStorageUrl,

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
      const ackMessages: Record<
        string,
        string
      > = {
        image:
          "📸 Image received! How can I help you today?",

        video:
          "🎥 Video received! How can I help you today?",

        audio:
          "🎵 Audio received! How can I help you today?",

        document:
          `📄 Document received${
            incoming.filename
              ? ` (${incoming.filename})`
              : ""
          }! How can I help you today?`,

        sticker:
          "😊 Got your sticker! How can I help you today?",
      };

      const ack =
        ackMessages[incoming.type] ??
        "Media received! How can I help you today?";

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