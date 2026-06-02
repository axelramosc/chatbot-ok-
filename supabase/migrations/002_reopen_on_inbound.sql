-- ============================================================
-- MIGRATION 002: Auto-reopen + realtime inbox ordering (additive only)
-- Safe to apply: no bot logic touched, no rows removed.
--   * Adds a new manual status value 'reabierto'.
--   * Reopens a 'cerrado' conversation when the CUSTOMER writes again.
--   * Bumps updated_at so the conversation rises to the top of the inbox.
--   * Publishes conversations/messages to Realtime so the inbox reorders live.
-- ============================================================

-- 1. Allow the new manual status value 'reabierto' on customer_status.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_customer_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_customer_status_check
  CHECK (
    customer_status IS NULL
    OR customer_status = ANY (ARRAY[
      'venta'::text, 'avisar_restock'::text, 'cotizacion'::text,
      'cerrado'::text, 'distribuidor'::text, 'reabierto'::text
    ])
  );

-- 2. When a customer message arrives, reopen a previously 'cerrado' conversation.
--    Guarded by the WHERE clause: it is a no-op for any other status, so it
--    never interferes with the bot's `status` column or other conversations.
CREATE OR REPLACE FUNCTION reopen_conversation_on_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE conversations
  SET customer_status = 'reabierto',
      updated_at = now()
  WHERE id = NEW.conversation_id
    AND customer_status = 'cerrado';
  RETURN NEW;
END;
$$;

-- 3. Fire only for inbound customer messages (sender = 'user').
DROP TRIGGER IF EXISTS trg_reopen_on_inbound ON messages;
CREATE TRIGGER trg_reopen_on_inbound
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender = 'user')
  EXECUTE FUNCTION reopen_conversation_on_inbound();

-- 4. Publish tables to Realtime so the dashboard inbox reorders live.
--    Without this the dashboard's realtime subscriptions never receive events.
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- 5. Full replica identity so UPDATE payloads carry the row data Realtime needs.
ALTER TABLE conversations REPLICA IDENTITY FULL;
