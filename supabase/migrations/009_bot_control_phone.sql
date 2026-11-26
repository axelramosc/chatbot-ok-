-- ============================================================
-- MIGRATION 009: Nuevo teléfono de redirección del bot apagado — CB-001 (pedido de Axel)
-- 8442739524 → 8445089882. Idempotente. El aviso toma el teléfono de bot_control.redirect_phone,
-- así que este UPDATE es lo que cambia el mensaje que reciben los clientes.
-- Reversa: supabase/rollbacks/009_bot_control_phone_down.sql
-- ============================================================
ALTER TABLE bot_control ALTER COLUMN redirect_phone SET DEFAULT '8445089882';

-- Solo cambia la fila si aún tiene el teléfono anterior (no pisa un valor puesto a mano).
UPDATE bot_control
SET redirect_phone = '8445089882', updated_at = now()
WHERE id = 1 AND redirect_phone = '8442739524';
