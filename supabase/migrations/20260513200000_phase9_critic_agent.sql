-- ============================================================================
-- JBoost Analyzer — Phase 9 (PR2 of 3)
-- Critic agent + user clarifications.
--
-- Additive only:
--   1. analyses.user_clarifications  — jsonb map of {questionId: answer}
--                                       answered by the user when the critic
--                                       agent surfaces contextual questions.
--
-- The critic agent itself stores its verdict on
-- analysis_checkpoints.payload under the key "critic" — no schema change
-- needed there because payload is already jsonb.
-- ============================================================================

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS user_clarifications JSONB NOT NULL DEFAULT '{}'::jsonb;
