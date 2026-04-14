-- ============================================================================
-- JBoost Analyzer — Phase 5D
-- Onboarding seed: GIN index on client_memory.profile for fast filtering.
--
-- The onboarding wizard writes its output to client_memory.profile JSONB
-- (extending the existing shape with new keys: brand, markets, stakeholders,
-- access, seo_foundation, geo, content_strategy, goals_kpis, compliance,
-- onboarding). No ALTER TABLE is needed since the column is already JSONB.
--
-- This migration adds:
--   1. A GIN index on the profile column so dashboard queries like
--      "clients without a completed onboarding" stay fast as the table grows.
--   2. A convenience view exposing onboarding status per client.
--
-- Idempotent.
-- ============================================================================

-- 1. GIN index on the full profile JSONB.
CREATE INDEX IF NOT EXISTS idx_client_memory_profile_gin
  ON public.client_memory
  USING gin (profile jsonb_path_ops);

-- 2. View: one row per client with onboarding summary fields extracted.
--    RLS on the underlying client_memory table still applies.
CREATE OR REPLACE VIEW public.client_onboarding_status AS
SELECT
  cm.client_id,
  COALESCE(cm.profile -> 'onboarding' ->> 'status', 'not_started') AS status,
  COALESCE((cm.profile -> 'onboarding' ->> 'version')::int, 0) AS version,
  COALESCE(
    jsonb_array_length(cm.profile -> 'onboarding' -> 'completed_sections'),
    0
  ) AS completed_sections_count,
  COALESCE(
    jsonb_array_length(cm.profile -> 'onboarding' -> 'skipped_fields'),
    0
  ) AS skipped_fields_count,
  (cm.profile -> 'onboarding' ->> 'started_at')::timestamptz AS started_at,
  (cm.profile -> 'onboarding' ->> 'completed_at')::timestamptz AS completed_at,
  COALESCE(
    (cm.profile -> 'onboarding' ->> 'discovery_chat_completed')::boolean,
    false
  ) AS discovery_chat_completed,
  cm.updated_at
FROM public.client_memory cm;

COMMENT ON VIEW public.client_onboarding_status IS
  'Phase 5D convenience view: onboarding progress per client, read from client_memory.profile.onboarding JSONB.';
