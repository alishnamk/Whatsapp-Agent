import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { ConversationWithLastMessage } from "@/types";

export async function GET() {
  const supabase = getSupabaseServerClient();

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch the latest message per conversation. Simple approach: one query
  // for all messages belonging to these conversations, ordered so the first
  // row per conversation_id we see is the newest.
  const ids = (conversations ?? []).map((c) => c.id);
  let lastByConversation = new Map<
    string,
    { content: string; role: "user" | "assistant" }
  >();

  if (ids.length > 0) {
    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("conversation_id, content, role, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false });

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }

    for (const m of messages ?? []) {
      if (!lastByConversation.has(m.conversation_id)) {
        lastByConversation.set(m.conversation_id, {
          content: m.content,
          role: m.role,
        });
      }
    }
  }

  const result: ConversationWithLastMessage[] = (conversations ?? []).map(
    (c) => ({
      ...c,
      last_message: lastByConversation.get(c.id)?.content ?? null,
      last_message_role: lastByConversation.get(c.id)?.role ?? null,
    })
  );

  return NextResponse.json({ conversations: result });
}
