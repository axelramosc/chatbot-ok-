-- Reversa de MIGRATION 008 (CB-001). No vive en supabase/migrations/ para que no se aplique como migración.
-- Antes de revertir, desplegar el código SIN bot-switch (con fail-closed, sin tabla el bot queda apagado).
DROP FUNCTION IF EXISTS release_bot_off_notice(UUID);
DROP FUNCTION IF EXISTS claim_bot_off_notice(UUID, INTEGER);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bot_control'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE bot_control;
  END IF;
END
$$;
DROP TABLE IF EXISTS bot_control;
-- Opcional: limpiar la marca de anti-spam en conversaciones.
-- UPDATE conversations SET context = context - 'bot_off_notice_at' WHERE context ? 'bot_off_notice_at';
