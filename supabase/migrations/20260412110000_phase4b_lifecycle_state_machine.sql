-- ============================================================================
-- JBoost Analyzer — Phase 4B
-- Lifecycle state machine: auto-stamping of engagement dates on transitions.
--
-- Until now the lifecycle_stage column was free to change to anything via
-- UPDATE, and the application code had to remember to also stamp
-- engagement_started_at / engagement_ended_at. That's fragile (the promote
-- endpoint did it; nothing else did). This migration enforces the invariant
-- at the database level so every transition is consistent regardless of who
-- does the UPDATE (cron worker, admin script, future bulk import, etc).
--
-- Rules:
--   prospect -> active   : if engagement_started_at IS NULL, set to now()
--   * -> churned         : if engagement_ended_at  IS NULL, set to now()
--   churned -> active    : clear engagement_ended_at (reactivation)
--
-- The trigger does NOT block transitions — it just enriches them. Validation
-- of allowed transitions stays in application code where it can return
-- meaningful HTTP errors with reasons.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clients_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- prospect -> active : auto-stamp engagement_started_at
  IF NEW.lifecycle_stage = 'active'
     AND OLD.lifecycle_stage = 'prospect'
     AND NEW.engagement_started_at IS NULL
  THEN
    NEW.engagement_started_at := now();
  END IF;

  -- * -> churned : auto-stamp engagement_ended_at
  IF NEW.lifecycle_stage = 'churned'
     AND OLD.lifecycle_stage IS DISTINCT FROM 'churned'
     AND NEW.engagement_ended_at IS NULL
  THEN
    NEW.engagement_ended_at := now();
  END IF;

  -- churned -> active : clear ended_at (reactivation)
  IF OLD.lifecycle_stage = 'churned'
     AND NEW.lifecycle_stage = 'active'
  THEN
    NEW.engagement_ended_at := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS clients_lifecycle_transition_trg ON public.clients;
CREATE TRIGGER clients_lifecycle_transition_trg
  BEFORE UPDATE OF lifecycle_stage ON public.clients
  FOR EACH ROW
  WHEN (NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage)
  EXECUTE FUNCTION public.clients_lifecycle_transition();
