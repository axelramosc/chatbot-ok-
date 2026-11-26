-- ============================================================
-- MIGRATION 008: Interruptor global del bot — CB-001 (additive only)
-- NO aplicar sin Auditor + visto bueno de Axel. Aplicar ANTES del deploy del código:
-- con fail-closed, si la tabla no existe el bot queda apagado y redirige a todos.
--   * Tabla de una sola fila `bot_control` (apagado global en WhatsApp/Messenger/IG).
--   * RLS: el CRM (authenticated) solo LEE; toda escritura es server-side con
--     service_role vía /api/bot-control (criterios S2/S3).
--   * claim_bot_off_notice(): reserva ATÓMICA del aviso de redirección (anti-spam 6 h,
--     criterio S7) preservando el resto de conversations.context.
-- Reversa: supabase/rollbacks/008_bot_control_down.sql
-- ============================================================

-- 1. Tabla de fila única. `enabled` arranca en true: aplicar la migración no apaga nada.
CREATE TABLE IF NOT EXISTS bot_control (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled        BOOLEAN NOT NULL DEFAULT true,
  redirect_phone TEXT NOT NULL DEFAULT '8442739524',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     TEXT
);

INSERT INTO bot_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. RLS: solo lectura para el CRM; anon sin acceso.
ALTER TABLE bot_control ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_control_read ON bot_control;
CREATE POLICY bot_control_read ON bot_control
  FOR SELECT TO authenticated
  USING (true);

-- Defensa en profundidad: además de RLS (sin política de escritura), se quitan los
-- privilegios de tabla que Supabase concede por defecto a anon/authenticated.
REVOKE ALL ON bot_control FROM anon, authenticated;
GRANT SELECT ON bot_control TO authenticated;

-- 3. Realtime para que el banner del CRM se actualice en vivo (idempotente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bot_control'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bot_control;
  END IF;
END
$$;

-- 4. Anti-spam atómico del aviso. Devuelve true si el llamador debe enviar el aviso
--    (y deja registrada la marca bot_off_notice_at), false si ya se avisó dentro de la ventana.
--    El FOR UPDATE serializa ráfagas concurrentes del mismo cliente. Una marca inválida
--    o con fecha futura NO silencia al cliente. Conversación inexistente => true.
CREATE OR REPLACE FUNCTION claim_bot_off_notice(
  p_conversation_id UUID,
  p_window_seconds  INTEGER DEFAULT 21600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_ctx JSONB;
  v_raw TEXT;
  v_at  TIMESTAMPTZ;
BEGIN
  SELECT context INTO v_ctx FROM conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(v_ctx) IS DISTINCT FROM 'object' THEN
    v_ctx := '{}'::jsonb;
  END IF;

  v_raw := v_ctx ->> 'bot_off_notice_at';
  IF v_raw IS NOT NULL THEN
    BEGIN
      v_at := v_raw::timestamptz;
    EXCEPTION WHEN others THEN
      v_at := NULL;
    END;
    IF v_at IS NOT NULL AND v_at <= now()
       AND now() - v_at < make_interval(secs => p_window_seconds) THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE conversations
  SET context = jsonb_set(
        v_ctx,
        '{bot_off_notice_at}',
        to_jsonb(to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        true
      )
  WHERE id = p_conversation_id;
  RETURN true;
END;
$$;

-- Si el envío del aviso falla, se libera la marca para que el siguiente mensaje reintente.
CREATE OR REPLACE FUNCTION release_bot_off_notice(p_conversation_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE conversations
  SET context = context - 'bot_off_notice_at'
  WHERE id = p_conversation_id AND jsonb_typeof(context) = 'object';
$$;

-- Solo el servidor (service_role) puede ejecutarlas; nunca anon/authenticated vía PostgREST.
REVOKE ALL ON FUNCTION claim_bot_off_notice(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_bot_off_notice(UUID)        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_bot_off_notice(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_bot_off_notice(UUID)        TO service_role;
