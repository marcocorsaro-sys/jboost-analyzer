-- ============================================================================
-- JBoost Analyzer — V4 setup wizard fields (ADDITIVE ONLY, cantiere B).
--
-- The Block 1 migration already carries the setup columns with a 1:1 column
-- mapping (brand_name, site_type, industry_preset, target_audience,
-- seo_maturity, output_language, competitor_details, llm_guardrails). The
-- remaining wizard state of the UX-UI Bibbia 04 sheet "New Audit (Setup)"
-- has no dedicated column and lives in ONE jsonb:
--
--   v4_setup = {
--     countries:            text[]   -- field #4  (multi-country; the primary
--                                    --            one stays in analyses.country)
--     sector:               text     -- field #6  (free-text half)
--     target_audience_mode: text     -- field #7  (b2b | b2c | both)
--     thematic_clusters:    text[]   -- field #13 (3-10 macro-themes)
--     jhorizon_answer:      text     -- field #12 (J-Horizon recap pasted in setup)
--     additional_notes:     text     -- field #24
--     enabled_drivers:      text[]   -- draft resume: STEP 3 toggles
--     driver_templates:     jsonb    -- fields #16-19 (driver -> template keys)
--     attachments:          jsonb[]  -- fields #15/#20/#23 upload references
--                                    --   {kind, name, path, size, uploaded_at}
--                                    --   (files live in the 'client-files'
--                                    --    storage bucket under v4-setup/<id>/)
--   }
--
-- Jsonb by design: these fields are read back only by the setup wizard
-- (resume) and by the start route (driver config seeding) — nothing filters
-- or joins on them, so columns would buy nothing but migrations.
--
-- The blocklist + max insights of field #22 do NOT live here: they go in the
-- existing analyses.llm_guardrails ({blocklist: text[], max_insights: int}),
-- which the LLM orchestrator already reads.
-- ============================================================================

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS v4_setup JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.analyses.v4_setup IS
  'V4 setup wizard state without a dedicated column (UX-UI Bibbia 04, New Audit Setup): countries, sector, target_audience_mode, thematic_clusters, jhorizon_answer, additional_notes, enabled_drivers, driver_templates, attachments.';

-- ---------------------------------------------------------------------------
-- Verification (run manually after applying):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='analyses' AND column_name='v4_setup';
-- ---------------------------------------------------------------------------
