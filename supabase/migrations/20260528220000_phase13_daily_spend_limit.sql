-- ============================================================================
-- JBoost Analyzer — Phase 13
-- Daily LLM spend limit + backfill historical missing costs.
--
-- 1. Seed app_config with default daily limit (€10) and USD→EUR rate (0.92).
--    Both are editable from the admin Config panel without code changes.
-- 2. Recompute estimated_cost_usd for legacy llm_usage rows where the model
--    ID wasn't yet in the pricing dict at insert time (notably
--    schema_radiography_v1 with model claude-sonnet-4-6). Without this the
--    daily-limit aggregate underestimates real spend.
-- ============================================================================

INSERT INTO public.app_config (key, value, description, updated_at)
VALUES
  ('daily_spend_limit_eur', '10',
   'Massimo speso LLM giornaliero in EUR (somma di tutti gli utenti). A limite raggiunto, le route LLM rispondono 402 e mostrano un banner che invita ad aumentare il limite.',
   now()),
  ('usd_to_eur_rate', '0.92',
   'Tasso di conversione USD→EUR usato per applicare il limite e per i totali in dashboard. Aggiornalo se il cambio si muove molto.',
   now())
ON CONFLICT (key) DO NOTHING;

-- Backfill: ricalcola estimated_cost_usd per le righe con costo 0 ma token > 0.
-- Mappa i prefissi di model al loro prezzo (USD per 1M token) — coerente con
-- lib/tracking/pricing.ts.
UPDATE public.llm_usage
SET estimated_cost_usd = CASE
  WHEN model LIKE 'claude-opus%'   THEN (COALESCE(input_tokens,0) * 15.0  + COALESCE(output_tokens,0) * 75.0) / 1000000.0
  WHEN model LIKE 'claude-sonnet%' THEN (COALESCE(input_tokens,0) * 3.0   + COALESCE(output_tokens,0) * 15.0) / 1000000.0
  WHEN model LIKE 'claude-haiku%'  THEN (COALESCE(input_tokens,0) * 1.0   + COALESCE(output_tokens,0) * 5.0)  / 1000000.0
  WHEN model LIKE 'gpt-4o-mini%'   THEN (COALESCE(input_tokens,0) * 0.15  + COALESCE(output_tokens,0) * 0.6)  / 1000000.0
  WHEN model LIKE 'gpt-4o%'        THEN (COALESCE(input_tokens,0) * 5.0   + COALESCE(output_tokens,0) * 15.0) / 1000000.0
  WHEN model LIKE 'gpt-4%'         THEN (COALESCE(input_tokens,0) * 10.0  + COALESCE(output_tokens,0) * 30.0) / 1000000.0
  ELSE 0
END
WHERE (estimated_cost_usd IS NULL OR estimated_cost_usd = 0)
  AND (COALESCE(input_tokens,0) > 0 OR COALESCE(output_tokens,0) > 0);
