-- Distinguish AI replies from replies a human typed in the dashboard.
-- Both are stored with role = 'assistant' (that's what the model needs to see
-- as conversation history), so the author lives in its own column.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender TEXT
  CHECK (sender IN ('ai', 'human'));

-- Everything that existed before this column was written by the AI.
UPDATE messages
SET sender = 'ai'
WHERE role = 'assistant'
  AND sender IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON messages(sender);


-- ============================================================
-- WHATSAPP MEDIA SUPPORT
-- ============================================================

-- Media messages such as images, videos, audio, documents and
-- stickers may not have text content, so content must be nullable.

ALTER TABLE messages
  ALTER COLUMN content DROP NOT NULL;

-- WhatsApp message type:
-- text, image, video, audio, document, sticker

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type TEXT;

-- WhatsApp's media ID.
-- This ID will later be used to retrieve/download the actual media.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_id TEXT;

-- MIME type of the media.
-- Examples:
-- image/jpeg
-- image/png
-- application/pdf
-- audio/ogg
-- video/mp4

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- Original filename.
-- Mainly used for documents such as PDF, DOCX, XLSX, etc.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS filename TEXT;

-- Caption attached to an image, video or document.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_caption TEXT;

-- SHA-256 checksum provided by WhatsApp.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_sha256 TEXT;

-- Useful for finding messages associated with a particular
-- WhatsApp media ID.

CREATE INDEX IF NOT EXISTS idx_messages_media_id
  ON messages(media_id);


-- ============================================================
-- KEEP CONVERSATION UPDATED_AT FRESH
-- ============================================================

CREATE OR REPLACE FUNCTION touch_conversation_updated_at()

RETURNS TRIGGER AS $$

BEGIN

  UPDATE conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;

END;

$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS messages_touch_conversation
ON messages;


CREATE TRIGGER messages_touch_conversation

  AFTER INSERT ON messages

  FOR EACH ROW
  EXECUTE FUNCTION touch_conversation_updated_at();


-- ============================================================
-- SUPABASE REALTIME
-- ============================================================

-- The dashboard subscribes to both tables via Supabase Realtime.
-- Without these, live updates will not arrive.

DO $$

BEGIN

  BEGIN

    ALTER PUBLICATION supabase_realtime
    ADD TABLE messages;

  EXCEPTION
    WHEN duplicate_object THEN NULL;

  END;


  BEGIN

    ALTER PUBLICATION supabase_realtime
    ADD TABLE conversations;

  EXCEPTION
    WHEN duplicate_object THEN NULL;

  END;

END $$;