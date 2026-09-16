-- ============================================================
-- MIGRATION 007: Enable pg_cron (additive only)
-- Safe to apply: no tables, triggers or bot logic touched.
--   * Enables Supabase Cron so the database can run scheduled jobs on its own,
--     without depending on Vercel or on anyone's machine being on.
--   * First used on 2026-09-16 for a one-off job ('revertir-asueto-16sep') that
--     removes the holiday patch at 00:05 Monterrey time and then unschedules itself.
--     One-off jobs like that are operational data, not schema: they are NOT
--     recorded here.
-- pg_cron runs in GMT (cron.timezone). Monterrey/Saltillo are UTC-6 all year.
-- Applied to production via the Supabase MCP on 2026-09-16.
-- Uninstall: DROP EXTENSION IF EXISTS pg_cron;  (deletes every scheduled job)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
