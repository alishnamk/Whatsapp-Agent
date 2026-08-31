import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const content = (body?.content ?? "").trim();

  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { data: conversation, error: convErr } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .single();

  if (convErr || !conversation) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }

  const sendResult = await sendWhatsAppMessage(conversation.phone, content);
  if (!sendResult.ok) {
    return NextResponse.json(
      { error: "Failed to deliver message via WhatsApp", details: sendResult.body },
      { status: 502 }
    );
  }

  const { data: message, error: insertErr } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      role: "assistant",
      sender: "human",
      content,
    })
    .select("*")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ message });
}