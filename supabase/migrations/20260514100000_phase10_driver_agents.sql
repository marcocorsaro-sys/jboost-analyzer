-- ============================================================================
-- JBoost Analyzer — Phase 10 (PR4): Per-driver interpreter agents.
--
-- Additive only:
--   1. driver_results.agent_verdict  — jsonb verdict produced by the
--                                       driver-specific interpreter agent.
--                                       Shape:
--                                         {
--                                           "observations": string[],
--                                           "questions": [{id, text, options?}],
--                                           "needs_dialogue": boolean,
--                                           "model": string,
--                                           "skipped"?: boolean,
--                                           "skipped_reason"?: string
--                                         }
-- ============================================================================

ALTER TABLE public.driver_results
  ADD COLUMN IF NOT EXISTS agent_verdict JSONB NOT NULL DEFAULT '{}'::jsonb;
