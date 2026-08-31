create table if not exists conversations (

  id uuid default gen_random_uuid() primary key,

  phone text unique not null,

  name text,

  mode text not null default 'agent'
    check (mode in ('agent', 'human')),

  updated_at timestamp with time zone default now(),

  created_at timestamp with time zone default now()

);


create table if not exists messages (

  id uuid default gen_random_uuid() primary key,

  conversation_id uuid
    references conversations(id)
    on delete cascade
    not null,

  role text not null
    check (role in ('user', 'assistant')),

  -- Text content or media caption.
  -- NULL is allowed because media messages may have no text/caption.
  content text,

  whatsapp_msg_id text unique,

  -- Type of WhatsApp message:
  -- text, image, video, audio, document, sticker
  message_type text,

  -- WhatsApp media ID.
  media_id text,

  -- MIME type such as:
  -- image/jpeg
  -- application/pdf
  -- audio/ogg
  mime_type text,

  -- Original filename for documents.
  filename text,

  -- Caption attached to an image/video/document.
  media_caption text,

  -- SHA-256 checksum provided by WhatsApp.
  media_sha256 text,

  created_at timestamp with time zone default now()

);


create index if not exists idx_messages_conversation
  on messages(conversation_id);


create index if not exists idx_conversations_updated
  on conversations(updated_at desc);


create index if not exists idx_messages_media_id
  on messages(media_id);