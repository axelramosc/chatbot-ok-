-- ============================================================
-- MIGRATION 001: Multi-channel support (additive only)
-- Safe to apply: existing rows default to 'whatsapp', nothing removed
-- ============================================================

-- Identifies which channel each conversation belongs to.
-- Default 'whatsapp' means every existing row is valid with no data migration.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_conversations_channel
  ON conversations (channel);

-- Platform-specific message ID for deduplication on Messenger/Instagram.
-- wa_message_id stays untouched for WhatsApp deduplication.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_channel_message_id
  ON messages (channel_message_id)
  WHERE channel_message_id IS NOT NULL;

-- Prevents duplicate active conversations for the same user on the same channel.
-- Run this check BEFORE applying the unique index to ensure no existing duplicates:
--   SELECT phone_number, COUNT(*) FROM conversations
--   WHERE status != 'closed' GROUP BY phone_number HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_channel_phone_active
  ON conversations (channel, phone_number)
  WHERE status != 'closed';
