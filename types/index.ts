export type ConversationMode = "agent" | "human";

export interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  mode: ConversationMode;
  updated_at: string;
  created_at: string;
}

export interface ConversationWithLastMessage extends Conversation {
  last_message: string | null;
  last_message_role: "user" | "assistant" | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  sender: "ai" | "human" | null;
  content: string | null;
  whatsapp_msg_id: string | null;
  message_type: string | null;
  media_id: string | null;
  mime_type: string | null;
  filename: string | null;
  media_caption: string | null;
  media_sha256: string | null;
  media_url: string | null;
  media_category: string | null;
  link_url: string | null;
  created_at: string;
}
