-- Reversa de MIGRATION 009 (CB-001). No vive en supabase/migrations/ para que no se aplique como migración.
ALTER TABLE bot_control ALTER COLUMN redirect_phone SET DEFAULT '8442739524';
UPDATE bot_control
SET redirect_phone = '8442739524', updated_at = now()
WHERE id = 1 AND redirect_phone = '8445089882';
