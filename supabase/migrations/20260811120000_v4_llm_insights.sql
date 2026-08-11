-- ============================================================================
-- JBoost Analyzer — V4: narrative LLM insights + Executive Summary
-- (ADDITIVE ONLY — attack-order point 4).
--
-- Implements the persistence side of the Drivers Bibbia (03) sheets 14/15/16:
-- the sequential per-driver LLM calls write their JSON output to
-- driver_runs.llm_insight, the final Executive Summary call writes to
-- analyses.v4_executive_summary, and the whole orchestration exposes its
-- state through analyses.v4_insights_status / v4_insights_error.
--
-- Why a NEW llm_insight column when Block 1 already created
-- driver_runs.llm_output (JSONB NOT NULL DEFAULT '{}'): the orchestrator
-- needs "no insight yet" to be unambiguous for crash-safe resumption
-- (sheet 16 B: the run is incremental and idempotent — on restart, drivers
-- that already have an insight are skipped). A NOT NULL DEFAULT '{}' column
-- cannot distinguish "never generated" from "generated empty", so llm_insight
-- is nullable and NULL means exactly "this driver call has not happened".
-- llm_output stays untouched for whatever earlier block reserved it for.
--
-- Nothing here touches the V1 pipeline or any existing column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. driver_runs.llm_insight — the per-driver call output (sheet 15).
--    Shape written by lib/v4/llm/orchestrator.ts:
--      { status: 'done',  output: <sheet-15 JSON>, model, generated_at,
--        attempts, hallucination_flags?: string[] }
--      { status: 'error', error: string, model, generated_at, attempts }
--    NULL = the sequential call has not run yet (resume point).
-- ---------------------------------------------------------------------------
ALTER TABLE public.driver_runs
  ADD COLUMN IF NOT EXISTS llm_insight JSONB;

COMMENT ON COLUMN public.driver_runs.llm_insight IS
  'V4 sheet 15: JSON output of the sequential per-driver LLM insight call, '
  'plus metadata (model, generated_at, attempts, hallucination_flags). '
  'NULL = not yet generated (the orchestrator resumes from here).';

-- ---------------------------------------------------------------------------
-- 2. analyses — Executive Summary + orchestration state (sheet 16).
-- ---------------------------------------------------------------------------
ALTER TABLE public.analyses
  -- The 10th call's JSON (headline_dominante, scorecard_overview,
  -- correlazioni_chiave, priorita_strategiche, alert_critici) + metadata.
  ADD COLUMN IF NOT EXISTS v4_executive_summary JSONB,
  -- State machine of the whole insights run. NULL = never requested.
  ADD COLUMN IF NOT EXISTS v4_insights_status TEXT
    CHECK (v4_insights_status IS NULL OR v4_insights_status IN (
      'pending','running','done','error')),
  -- The reason when status = 'error' (e.g. daily spend limit reached), or a
  -- non-fatal warning when status = 'done' but some driver insight failed.
  -- Never a silent partial: a blocked run is always visibly 'error'.
  ADD COLUMN IF NOT EXISTS v4_insights_error TEXT;

COMMENT ON COLUMN public.analyses.v4_executive_summary IS
  'V4 sheet 16 C: JSON of the final Executive Summary LLM call '
  '(claude-opus tier) over all enabled driver outputs, plus metadata.';
COMMENT ON COLUMN public.analyses.v4_insights_status IS
  'V4 insights orchestration state: pending -> running -> done | error. '
  'NULL = insights never requested for this analysis.';
COMMENT ON COLUMN public.analyses.v4_insights_error IS
  'Failure reason when v4_insights_status = error (e.g. spend limit), or a '
  'warning listing driver insights that failed when status = done.';

-- ---------------------------------------------------------------------------
-- Verification queries (run manually after applying):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='driver_runs' AND column_name='llm_insight';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='analyses' AND column_name IN
--     ('v4_executive_summary','v4_insights_status','v4_insights_error');
-- ---------------------------------------------------------------------------
