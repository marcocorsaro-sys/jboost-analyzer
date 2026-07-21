-- ============================================================================
-- JBoost Analyzer — V4 Block 2: async per-driver runner (ADDITIVE ONLY).
--
-- Block 1 created driver_runs with the queued/running/done/error/needs_decision
-- state machine. Block 2 turns it into a real job table: a lease so a crashed
-- Vercel invocation can be reclaimed, and an attempt counter so the cron reaper
-- retries a bounded number of times before giving up.
--
-- Nothing here touches the V1 pipeline (analyses.current_phase, driver_results,
-- analysis_checkpoints keep working exactly as before).
-- ============================================================================

ALTER TABLE public.driver_runs
  -- How many times this job has been handed to a worker. Incremented on claim,
  -- so a job that keeps crashing mid-flight still converges to 'error'.
  ADD COLUMN IF NOT EXISTS attempts        SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts    SMALLINT NOT NULL DEFAULT 3,
  -- Lease held by the worker currently running this job. The reaper requeues
  -- any 'running' row whose lease has expired: that is the only way to
  -- distinguish "slow" from "the invocation died" without a heartbeat.
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at    TIMESTAMPTZ;

-- Reaper lookup: expired leases first.
CREATE INDEX IF NOT EXISTS idx_driver_runs_lease
  ON public.driver_runs (status, lease_expires_at)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- Atomic claim. Postgres-side so two concurrent dispatchers can never hand the
-- same driver job to two workers: the UPDATE ... WHERE status='queued' is
-- serialized by the row lock, and the loser gets zero rows back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.v4_claim_driver_run(
  p_analysis_id UUID,
  p_driver_key  TEXT,
  p_lease_secs  INTEGER DEFAULT 300
)
RETURNS SETOF public.driver_runs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.driver_runs
     SET status           = 'running',
         attempts         = attempts + 1,
         started_at       = COALESCE(started_at, now()),
         lease_expires_at = now() + make_interval(secs => p_lease_secs),
         error            = NULL
   WHERE analysis_id = p_analysis_id
     AND driver_key  = p_driver_key
     AND enabled     = TRUE
     AND status IN ('queued', 'needs_decision')
     AND attempts < max_attempts
  RETURNING *;
$$;

-- Only the runner may claim a job. Revoking PUBLIC drops the default EXECUTE
-- grant (which would otherwise reach anon/authenticated); service_role is the
-- single caller — the worker route runs with it and has no user session.
REVOKE ALL ON FUNCTION public.v4_claim_driver_run(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v4_claim_driver_run(UUID, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Verification queries (run manually after applying):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='driver_runs'
--       AND column_name IN ('attempts','max_attempts','lease_expires_at','dispatched_at');
--   SELECT proname FROM pg_proc WHERE proname = 'v4_claim_driver_run';
-- ---------------------------------------------------------------------------
