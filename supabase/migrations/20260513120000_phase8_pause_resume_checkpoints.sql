-- ============================================================================
-- JBoost Analyzer — Phase 8 (PR1 of 3)
-- Pause/Resume scaffolding for the analysis pipeline.
--
-- Scope of this migration (additive only):
--   1. analyses.pause_between_phases  — opt-in flag set at creation time
--   2. analyses.paused_at_phase       — last completed phase when paused
--   3. analysis_checkpoints           — one row per phase boundary, payload
--                                       is the snapshot the user reviews
--
-- No CHECK constraint on analyses.status is altered: the existing column
-- accepts free text and the orchestrator will start writing the new value
-- 'paused' on its own. If a hard constraint is added later it must include
-- 'paused' alongside 'pending'|'running'|'completed'|'failed'.
-- ============================================================================

-- 1. analyses: opt-in pause flag + last completed phase pointer
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS pause_between_phases BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS paused_at_phase TEXT;

-- 2. analysis_checkpoints — one row per phase boundary
CREATE TABLE IF NOT EXISTS public.analysis_checkpoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id  UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  phase        TEXT NOT NULL,
  phase_index  SMALLINT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_decision TEXT CHECK (user_decision IN ('continue','stop','rerun')),
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_analysis_checkpoints_analysis
  ON public.analysis_checkpoints (analysis_id, phase_index);

-- 3. RLS — same access model as analyses: client members + analysis owner
ALTER TABLE public.analysis_checkpoints ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'analysis_checkpoints'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.analysis_checkpoints', pol.policyname);
  END LOOP;
END $$;

-- SELECT: anyone who can read the parent analysis can read its checkpoints
CREATE POLICY "checkpoints_select"
  ON public.analysis_checkpoints FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses a
      WHERE a.id = analysis_checkpoints.analysis_id
        AND (
          a.user_id = auth.uid()
          OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
        )
    )
  );

-- UPDATE: only to record the user's decision on a pending checkpoint
CREATE POLICY "checkpoints_update_decision"
  ON public.analysis_checkpoints FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses a
      WHERE a.id = analysis_checkpoints.analysis_id
        AND (
          a.user_id = auth.uid()
          OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analyses a
      WHERE a.id = analysis_checkpoints.analysis_id
        AND (
          a.user_id = auth.uid()
          OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
        )
    )
  );

-- INSERT/DELETE happen via the service-role orchestrator and are not
-- exposed to authenticated users (no policy = denied).

GRANT SELECT, UPDATE ON public.analysis_checkpoints TO authenticated;
