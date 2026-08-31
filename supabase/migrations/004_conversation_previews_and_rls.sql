CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at DESC);

CREATE OR REPLACE VIEW conversation_previews AS
SELECT
  c.*,
  m.content AS last_message,
  m.role AS last_message_role
FROM conversations c
LEFT JOIN LATERAL (
  SELECT content, role
  FROM messages
  WHERE messages.conversation_id = c.id
  ORDER BY created_at DESC
  LIMIT 1
) m ON true;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can read conversations" ON conversations;
CREATE POLICY "anon can read conversations"
  ON conversations FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "anon can read messages" ON messages;
CREATE POLICY "anon can read messages"
  ON messages FOR SELECT
  TO anon
  USING (true);