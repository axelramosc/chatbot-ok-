-- ============================================================
-- MIGRATION 006: Unread message counter per conversation (additive only)
-- Safe to apply: no bot logic touched, no rows removed.
--   * Adds conversations.unread_count (default 0). The bot never writes it.
--   * A trigger bumps unread_count when the CUSTOMER writes (sender = 'user').
--   * The dashboard resets it to 0 when an advisor opens the conversation.
-- Realtime is already enabled for `conversations` (REPLICA IDENTITY FULL) in
-- migration 005, so the inbox badge updates live with no extra publication step.
-- ============================================================

-- 1. New column. Additive with a safe default; existing rows start at 0.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0;

-- 2. Increment the counter for every inbound customer message.
--    Single trivial UPDATE on a column the bot never reads, so it cannot
--    interfere with the bot's message insert nor roll it back.
CREATE OR REPLACE FUNCTION bump_unread_on_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE conversations
  SET unread_count = unread_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- 3. Fire only for inbound customer messages (sender = 'user').
--    Outbound bot/advisor messages ('bot') never affect the counter.
DROP TRIGGER IF EXISTS trg_bump_unread_on_inbound ON messages;
CREATE TRIGGER trg_bump_unread_on_inbound
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender = 'user')
  EXECUTE FUNCTION bump_unread_on_inbound();
