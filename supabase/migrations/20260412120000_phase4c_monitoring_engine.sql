-- ============================================================================
-- JBoost Analyzer — Phase 4C
-- Monitoring engine: cron-driven periodic refresh of active clients.
--
-- Reuses the existing pipeline (analyses table + run-analysis edge function)
-- instead of inventing a separate snapshots table — every monitoring run is
-- just a regular analysis row tagged with source='monitoring'. This way the
-- existing trend chart on /clients/[id] (which already reads from analyses)
-- automatically picks up the new history points with no extra UI work.
--
-- Additive only:
--   1. analyses.source              ('manual' | 'monitoring')
--   2. client_update_subscriptions.frequency_days     (custom granularity)
--   3. client_update_subscriptions.paused_until       (temporary pause)
--   4. RLS on client_update_subscriptions opened from owner-only to
--      owner+editor+admin reads, owner+editor+admin writes (it was wired
--      to owner-only in phase1b, which means editors couldn't even see
--      their own monitoring config).
--   5. Helper SQL to compute next_run_at after a successful run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. analyses.source — distinguish manual UI runs from automated monitoring
-- ----------------------------------------------------------------------------
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS source TEXT
    DEFAULT 'manual'
    CHECK (source IN ('manual','monitoring'));

CREATE INDEX IF NOT EXISTS idx_analyses_client_source_completed
  ON public.analyses (client_id, source, completed_at DESC);

-- ----------------------------------------------------------------------------
-- 2. client_update_subscriptions: custom frequency + temporary pause
-- ----------------------------------------------------------------------------
ALTER TABLE public.client_update_subscriptions
  ADD COLUMN IF NOT EXISTS frequency_days SMALLINT;

ALTER TABLE public.client_update_subscriptions
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 3. next_run_at calculator
-- ----------------------------------------------------------------------------
-- Pure function used by both the application code and the cron orchestrator
-- to compute the next scheduled run from a given anchor (usually now()) and
-- a subscription row. Custom frequency_days takes precedence over the
-- preset frequency string.
CREATE OR REPLACE FUNCTION public.compute_next_run_at(
  p_anchor TIMESTAMPTZ,
  p_frequency TEXT,
  p_frequency_days SMALLINT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_frequency_days IS NOT NULL AND p_frequency_days > 0
      THEN p_anchor + make_interval(days => p_frequency_days::int)
    WHEN p_frequency = 'biweekly'
      THEN p_anchor + INTERVAL '14 days'
    WHEN p_frequency = 'monthly'
      THEN p_anchor + INTERVAL '30 days'
    ELSE
      p_anchor + INTERVAL '7 days'
  END;
$fn$;

GRANT EXECUTE ON FUNCTION public.compute_next_run_at(TIMESTAMPTZ, TEXT, SMALLINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RLS: open subscription read+write to editor+ members, not just owners
-- ----------------------------------------------------------------------------
-- Phase 1B locked client_update_subscriptions to owner-only. That made the
-- monitoring panel UI unreachable for editors and viewers, even read-only.
-- Drop the legacy policies (whatever they're named) and recreate a coherent
-- set driven by the helper functions from phase1a.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'client_update_subscriptions'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.client_update_subscriptions',
      pol.policyname
    );
  END LOOP;
END $$;

ALTER TABLE public.client_update_subscriptions ENABLE ROW LEVEL SECURITY;

-- Anyone with access to the client can read its monitoring config.
CREATE POLICY "subs_select"
  ON public.client_update_subscriptions FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id) OR public.is_admin());

-- Editors+ can mutate. Inserts go through promote/upsert paths so the
-- WITH CHECK mirrors USING.
CREATE POLICY "subs_insert"
  ON public.client_update_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id) OR public.is_admin());

CREATE POLICY "subs_update"
  ON public.client_update_subscriptions FOR UPDATE
  TO authenticated
  USING (public.user_can_edit_client(client_id) OR public.is_admin())
  WITH CHECK (public.user_can_edit_client(client_id) OR public.is_admin());

CREATE POLICY "subs_delete"
  ON public.client_update_subscriptions FOR DELETE
  TO authenticated
  USING (public.user_is_client_owner(client_id) OR public.is_admin());
