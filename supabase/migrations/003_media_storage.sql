-- media_url: public URL in Supabase Storage after upload
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;

-- media_category: image / video / audio / document / link / text
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_category TEXT
  CHECK (media_category IN ('image', 'video', 'audio', 'document', 'link', 'text'));

-- link_url: original URL extracted from text messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS link_url TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_media_category
  ON messages(media_category);
