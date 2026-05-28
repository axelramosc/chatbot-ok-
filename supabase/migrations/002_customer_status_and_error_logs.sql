-- ============================================================
-- MIGRATION 002: Manual customer status + AI error forensics
-- Additive only. Existing rows default to NULL (no status set).
-- ============================================================

-- Manual sale tracking, controlled exclusively by staff.
-- Independent of `status` (which controls whether Ava is active/paused).
-- The bot must NEVER overwrite this field.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_status TEXT
  CHECK (customer_status IN ('venta', 'avisar_restock', 'cotizacion', 'cerrado', 'distribuidor')
         OR customer_status IS NULL);

CREATE INDEX IF NOT EXISTS idx_conversations_customer_status
  ON conversations (customer_status)
  WHERE customer_status IS NOT NULL;

-- Forensic log of AI Gateway failures so they can be diagnosed offline.
CREATE TABLE IF NOT EXISTS ai_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  phone_number TEXT,
  user_message TEXT,
  error_kind TEXT,
  error_message TEXT,
  provider_chain JSONB,
  request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_error_logs_created_at
  ON ai_error_logs (created_at DESC);

-- Mirror the RLS posture of the other public tables.
ALTER TABLE ai_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_full_access ON ai_error_logs;
CREATE POLICY authenticated_full_access ON ai_error_logs
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
