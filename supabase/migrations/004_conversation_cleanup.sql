-- ============================================================
-- MIGRATION 004: Conversation cleanup (additive only)
-- Safe to apply: no bot logic touched, this migration removes no rows.
--   * closed_at: tracks when a conversation became 'cerrado' (the manual
--     "Cerrado" status the sales team sets). This is the 60-day retention
--     clock — NOT updated_at, which is bumped by many unrelated events.
--   * Trigger keeps closed_at in sync on every customer_status change, so
--     reopening a conversation (auto 'reabierto' or any other status) resets
--     the clock and re-closing it starts a fresh 60 days.
--   * sales_leads FK -> ON DELETE CASCADE so deleting a conversation also
--     removes its lead, leaving no orphan rows (full DB cleanup). Messages
--     already cascade; ai_error_logs already SET NULL.
-- ============================================================

-- 1. When did this conversation last become 'cerrado'? NULL = not closed.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- 2. Backfill existing closed conversations so the cron can act on them.
--    updated_at is the best available proxy for when they last went quiet.
UPDATE conversations
SET closed_at = updated_at
WHERE customer_status = 'cerrado' AND closed_at IS NULL;

-- 3. Maintain closed_at automatically on every customer_status transition.
--    INTO 'cerrado'           -> stamp closed_at = now()
--    OUT of 'cerrado' (incl. auto 'reabierto') -> reset closed_at = NULL
--    Only touches closed_at when customer_status actually changes, so it
--    never interferes with the bot's status/context updates.
CREATE OR REPLACE FUNCTION sync_conversation_closed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_status IS DISTINCT FROM OLD.customer_status THEN
    IF NEW.customer_status = 'cerrado' THEN
      NEW.closed_at := now();
    ELSE
      NEW.closed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_closed_at ON conversations;
CREATE TRIGGER trg_sync_closed_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION sync_conversation_closed_at();

-- 4. Index so the cron's retention scan stays cheap.
CREATE INDEX IF NOT EXISTS idx_conversations_closed_at
  ON conversations (closed_at)
  WHERE customer_status = 'cerrado';

-- 5. sales_leads currently blocks conversation deletion (NO ACTION FK).
--    Re-create it as ON DELETE CASCADE so removing a conversation removes
--    its lead too, leaving the database clean with no orphaned references.
ALTER TABLE sales_leads DROP CONSTRAINT IF EXISTS sales_leads_conversation_id_fkey;
ALTER TABLE sales_leads
  ADD CONSTRAINT sales_leads_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
