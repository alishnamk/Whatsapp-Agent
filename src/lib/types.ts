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

  // "ai" for AI-generated replies,
  // "human" for replies sent manually from the dashboard.
  // Nullable because user messages do not have a sender.
  sender: "ai" | "human" | null;

  // Text content or caption.
  content: string;

  // WhatsApp message ID.
  whatsapp_msg_id: string | null;

  // WhatsApp message type.
  // Examples: text, image, video, audio, document, sticker.
  message_type: string | null;

  // Meta/WhatsApp media ID.
  media_id: string | null;

  // MIME type of the media.
  // Examples: image/jpeg, application/pdf, video/mp4.
  mime_type: string | null;

  // Original filename for documents/media when available.
  filename: string | null;

  // Caption attached to an image, video, document, etc.
  media_caption: string | null;

  // SHA-256 hash supplied by WhatsApp/Meta for the media.
  media_sha256: string | null;

  created_at: string;
}