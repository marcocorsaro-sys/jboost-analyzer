-- ============================================================================
-- JBoost Analyzer — V4 Block 1: foundations (ADDITIVE ONLY).
--
-- Implements the core domain model of the Drivers Bibbia (03), sheet 1
-- "Core domain model (minimum entities)", without touching any V1 table
-- or behavior. The V1 pipeline (driver_results, analysis_checkpoints)
-- keeps working untouched; the V4 runner (Block 2) will write to the new
-- driver_runs table.
--
-- New tables:
--   1. driver_runs       — one row per (analysis, enabled V4 driver)
--   2. template_configs  — page templates + sample URLs per site
--   3. content_answers   — analyst questionnaire answers (sheets 9a/9b)
--   4. edits             — field-level edit log (editability + Save & Publish)
--   5. deliverables      — generated exports (pptx / docx / artifact)
--
-- New columns on analyses: V4 setup fields (brand, industry preset,
-- output language, ...) — all nullable, no impact on V1 flows.
--
-- RLS: same access model as analysis_checkpoints (phase8): analysis owner
-- OR client member via public.user_has_client_access(client_id).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. analyses — V4 setup fields (additive, nullable)
-- ---------------------------------------------------------------------------
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS brand_name        TEXT,
  ADD COLUMN IF NOT EXISTS brand_variants    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS site_type         TEXT,
  ADD COLUMN IF NOT EXISTS industry_preset   TEXT
    CHECK (industry_preset IS NULL OR industry_preset IN (
      'retail_luxury','banking_finance','media_publishing','travel_hospitality',
      'b2b_services','pharma_healthcare','home_appliances')),
  ADD COLUMN IF NOT EXISTS target_audience   TEXT,
  ADD COLUMN IF NOT EXISTS seo_maturity      TEXT
    CHECK (seo_maturity IS NULL OR seo_maturity IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS output_language   TEXT NOT NULL DEFAULT 'it'
    CHECK (output_language IN ('it','en')),
  -- REF_DATE convention (sheet 8b): last day of the last complete month,
  -- frozen at launch so every date-accepting endpoint uses the same one.
  ADD COLUMN IF NOT EXISTS ref_date          DATE,
  -- Discoverability backup cascade: user-approved extension flag + the
  -- tier actually used, recorded for transparency (README 01 §6).
  ADD COLUMN IF NOT EXISTS disco_extend_backup BOOLEAN NOT NULL DEFAULT FALSE,
  -- Structured competitor objects: [{url, brand_name, brand_variants[]}].
  -- The V1 competitors TEXT[] column stays untouched for V1 flows.
  ADD COLUMN IF NOT EXISTS competitor_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Words-to-avoid blocklist + insight caps (setup step 4, field #22).
  ADD COLUMN IF NOT EXISTS llm_guardrails    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 1. driver_runs — one row per (analysis, enabled V4 driver)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  driver_key      TEXT NOT NULL CHECK (driver_key IN (
    'awareness','ai_visibility','discoverability','traffic',
    'compliance','schema','speed','accessibility','content','authority')),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','running','done','error','needs_decision')),
  -- Scoring fields (sheet 8 / field naming of section G):
  --   raw_value      = the driver's single numeric raw (input to normalization)
  --   score_absolute = intrinsic 0-100 (only drivers with an Absolute view)
  --   score_relative = leader-index 0-100, 1 decimal (the headline score)
  raw_value       DOUBLE PRECISION,
  score_absolute  INTEGER CHECK (score_absolute BETWEEN 0 AND 100),
  score_relative  NUMERIC(4,1) CHECK (score_relative BETWEEN 0 AND 100),
  comment_absolute TEXT,
  comment_relative TEXT,
  -- Discoverability transparency: tier actually used (README 01 §6).
  tier_used       TEXT CHECK (tier_used IS NULL OR tier_used IN (
    'strict','relaxed_2','relaxed_3')),
  raw_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  llm_output      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- needs_decision payload (e.g. Discoverability empty-tier prompt:
  -- {empty_players:[], options:['remove','replace','extend']}).
  decision_request JSONB,
  decision_taken   JSONB,
  error           TEXT,
  edited          BOOLEAN NOT NULL DEFAULT FALSE,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, driver_key)
);

CREATE INDEX IF NOT EXISTS idx_driver_runs_analysis
  ON public.driver_runs (analysis_id, status);

-- ---------------------------------------------------------------------------
-- 2. template_configs — page templates + sample URLs per analyzed site
--    (shared across Speed / Accessibility / Schema / Content — sheet 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.template_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id   UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  -- 'client' or 'competitor_1'..'competitor_4'
  site_ref      TEXT NOT NULL CHECK (
    site_ref = 'client' OR site_ref ~ '^competitor_[1-4]$'),
  template_key  TEXT NOT NULL CHECK (template_key IN (
    'global','homepage','plp','pdp','article','listing_articles',
    'service_page','about','faq')),
  url           TEXT,                       -- null = template absent on site
  applies_to    TEXT[] NOT NULL DEFAULT '{}',  -- driver keys using it
  detected      BOOLEAN NOT NULL DEFAULT FALSE, -- true if from auto-detection
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, site_ref, template_key)
);

CREATE INDEX IF NOT EXISTS idx_template_configs_analysis
  ON public.template_configs (analysis_id);

-- ---------------------------------------------------------------------------
-- 3. content_answers — questionnaire responses (sheets 9a/9b)
--    One row per (site, template, question). Points follow the per-question
--    mapping of sheet 9b (authoritative), stored denormalized for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_answers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id   UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  site_ref      TEXT NOT NULL CHECK (
    site_ref = 'client' OR site_ref ~ '^competitor_[1-4]$'),
  template_key  TEXT NOT NULL CHECK (template_key IN (
    'global','homepage','plp','pdp','article','listing_articles',
    'service_page','about','faq')),
  question_num  SMALLINT NOT NULL CHECK (question_num BETWEEN 1 AND 7),
  selected      CHAR(1) CHECK (selected IN ('A','B','C','D')),
  points        SMALLINT NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 30),
  question_area TEXT,      -- e.g. 'Heading Hierarchy' (traceability)
  weight        SMALLINT,  -- question weight from sheet 9b
  notes         TEXT,
  answered_by   UUID,      -- auth.uid() of the analyst
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, site_ref, template_key, question_num)
);

CREATE INDEX IF NOT EXISTS idx_content_answers_analysis
  ON public.content_answers (analysis_id, site_ref);

-- ---------------------------------------------------------------------------
-- 4. edits — field-level edit log ("everything is editable" + Save & Publish)
--    driver_run_id NULL = global note (cross-driver notes panel).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  driver_run_id  UUID REFERENCES public.driver_runs(id) ON DELETE CASCADE,
  field          TEXT NOT NULL,      -- e.g. 'score_relative', 'items[2].titolo'
  old_value      JSONB,
  new_value      JSONB,
  author         UUID,               -- auth.uid()
  -- draft -> published via Save & Publish batch (sheet 1 principles)
  published      BOOLEAN NOT NULL DEFAULT FALSE,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edits_analysis_draft
  ON public.edits (analysis_id, published);

-- ---------------------------------------------------------------------------
-- 5. deliverables — generated exports (Output Preview tab)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deliverables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id   UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  format        TEXT NOT NULL CHECK (format IN ('pptx','docx','artifact')),
  file_ref      TEXT,               -- storage path / URL
  generated_by  UUID,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliverables_analysis
  ON public.deliverables (analysis_id);

-- ---------------------------------------------------------------------------
-- 6. updated_at triggers (same convention as existing tables)
-- ---------------------------------------------------------------------------
-- search_path pinned: a trigger function with a mutable search_path is a
-- privilege-escalation vector (same reason as the phase1 fix_function_search_path
-- migration, and what the Supabase linter flags).
CREATE OR REPLACE FUNCTION public.v4_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_driver_runs_touch ON public.driver_runs;
CREATE TRIGGER trg_driver_runs_touch
  BEFORE UPDATE ON public.driver_runs
  FOR EACH ROW EXECUTE FUNCTION public.v4_touch_updated_at();

DROP TRIGGER IF EXISTS trg_content_answers_touch ON public.content_answers;
CREATE TRIGGER trg_content_answers_touch
  BEFORE UPDATE ON public.content_answers
  FOR EACH ROW EXECUTE FUNCTION public.v4_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS — same access model as analysis_checkpoints (phase8):
--    analysis owner OR client member via user_has_client_access().
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'driver_runs','template_configs','content_answers','edits','deliverables'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- SELECT: anyone who can read the parent analysis
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.analyses a
          WHERE a.id = %I.analysis_id
            AND (
              a.user_id = auth.uid()
              OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
            )
        )
      )$p$, t || '_select', t, t);

    -- INSERT/UPDATE/DELETE: same predicate (analyst-editable tables; the
    -- service-role runner bypasses RLS as in V1).
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.analyses a
          WHERE a.id = %I.analysis_id
            AND (
              a.user_id = auth.uid()
              OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
            )
        )
      )$p$, t || '_insert', t, t);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.analyses a
          WHERE a.id = %I.analysis_id
            AND (
              a.user_id = auth.uid()
              OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
            )
        )
      )$p$, t || '_update', t, t);

    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.analyses a
          WHERE a.id = %I.analysis_id
            AND (
              a.user_id = auth.uid()
              OR (a.client_id IS NOT NULL AND public.user_has_client_access(a.client_id))
            )
        )
      )$p$, t || '_delete', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verification queries (run manually after applying):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='analyses' AND column_name IN
--     ('brand_name','industry_preset','output_language','ref_date');
--   SELECT tablename, policyname FROM pg_policies
--     WHERE tablename IN ('driver_runs','template_configs','content_answers',
--                         'edits','deliverables') ORDER BY 1,2;
-- ---------------------------------------------------------------------------
