-- ============================================================================
-- JBoost Analyzer — Phase 5 ALL-IN-ONE
--
-- Single concatenation of every Phase 5 migration in the order they MUST be
-- applied. Wrap in a single BEGIN/COMMIT so any failure rolls back the whole
-- batch. Idempotent (safe to re-run).
--
-- Currently bundles only:
--   1. 20260412140000_phase5a_client_memory.sql
--      (Stages 5B/C/D/E are pure application code — they don't add new
--      tables/columns/triggers.)
--
-- HOW TO RUN:
--   Supabase Studio -> SQL Editor -> New query -> paste this whole file ->
--   Run. Then run the verification queries at the bottom.
--
-- This file is intentionally prefixed with an underscore so the Supabase
-- migration tool ignores it. The numbered file above is the source of truth.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1/1 — phase5a: foundation table + history + auto-stale triggers
-- ----------------------------------------------------------------------------

-- client_memory: singleton per client
CREATE TABLE IF NOT EXISTS public.client_memory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL UNIQUE
                       REFERENCES public.clients(id) ON DELETE CASCADE,
  profile         JSONB NOT NULL DEFAULT '{}'::jsonb,
  facts           JSONB NOT NULL DEFAULT '[]'::jsonb,
  gaps            JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative       TEXT,
  answers         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'empty'
                  CHECK (status IN ('empty','building','refreshing','ready','stale','failed')),
  completeness    SMALLINT NOT NULL DEFAULT 0
                  CHECK (completeness BETWEEN 0 AND 100),
  source_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_phase   TEXT,
  error_message   TEXT,
  last_refreshed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_memory_client
  ON public.client_memory(client_id);
CREATE INDEX IF NOT EXISTS idx_client_memory_status
  ON public.client_memory(status);

DROP TRIGGER IF EXISTS client_memory_updated_at_trg ON public.client_memory;
CREATE TRIGGER client_memory_updated_at_trg
  BEFORE UPDATE ON public.client_memory
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS via Phase 4A helpers
ALTER TABLE public.client_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_memory_select" ON public.client_memory;
DROP POLICY IF EXISTS "client_memory_insert" ON public.client_memory;
DROP POLICY IF EXISTS "client_memory_update" ON public.client_memory;
DROP POLICY IF EXISTS "client_memory_delete" ON public.client_memory;

CREATE POLICY "client_memory_select"
  ON public.client_memory FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id) OR public.jboost_is_admin());

CREATE POLICY "client_memory_insert"
  ON public.client_memory FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id) OR public.jboost_is_admin());

CREATE POLICY "client_memory_update"
  ON public.client_memory FOR UPDATE
  TO authenticated
  USING (public.user_can_edit_client(client_id) OR public.jboost_is_admin())
  WITH CHECK (public.user_can_edit_client(client_id) OR public.jboost_is_admin());

CREATE POLICY "client_memory_delete"
  ON public.client_memory FOR DELETE
  TO authenticated
  USING (public.user_is_client_owner(client_id) OR public.jboost_is_admin());

-- client_memory_facts_history: append-only fact audit log
CREATE TABLE IF NOT EXISTS public.client_memory_facts_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  fact_id         TEXT NOT NULL,
  fact_data       JSONB NOT NULL,
  superseded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by   TEXT,
  refresh_id      UUID
);

CREATE INDEX IF NOT EXISTS idx_facts_history_client_time
  ON public.client_memory_facts_history(client_id, superseded_at DESC);

ALTER TABLE public.client_memory_facts_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facts_history_select" ON public.client_memory_facts_history;

CREATE POLICY "facts_history_select"
  ON public.client_memory_facts_history FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id) OR public.jboost_is_admin());

-- Auto-stale marker helper + triggers
CREATE OR REPLACE FUNCTION public.mark_client_memory_stale(p_client_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE public.client_memory
  SET status = 'stale', updated_at = now()
  WHERE client_id = p_client_id
    AND status IN ('ready','empty');
$fn$;

CREATE OR REPLACE FUNCTION public.trg_analyses_mark_memory_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.client_id IS NOT NULL
     AND NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
  THEN
    PERFORM public.mark_client_memory_stale(NEW.client_id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS analyses_mark_memory_stale_trg ON public.analyses;
CREATE TRIGGER analyses_mark_memory_stale_trg
  AFTER INSERT OR UPDATE OF status ON public.analyses
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_analyses_mark_memory_stale();

CREATE OR REPLACE FUNCTION public.trg_source_mark_memory_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c_id UUID;
BEGIN
  c_id := COALESCE(NEW.client_id, OLD.client_id);
  IF c_id IS NOT NULL THEN
    PERFORM public.mark_client_memory_stale(c_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'knowledge_documents'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS knowledge_docs_mark_memory_stale_trg ON public.knowledge_documents';
    EXECUTE '
      CREATE TRIGGER knowledge_docs_mark_memory_stale_trg
        AFTER INSERT OR DELETE ON public.knowledge_documents
        FOR EACH ROW
        EXECUTE FUNCTION public.trg_source_mark_memory_stale()
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_files'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS client_files_mark_memory_stale_trg ON public.client_files';
    EXECUTE '
      CREATE TRIGGER client_files_mark_memory_stale_trg
        AFTER INSERT OR DELETE ON public.client_files
        FOR EACH ROW
        EXECUTE FUNCTION public.trg_source_mark_memory_stale()
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_martech'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS martech_mark_memory_stale_trg ON public.client_martech';
    EXECUTE '
      CREATE TRIGGER martech_mark_memory_stale_trg
        AFTER INSERT OR UPDATE OR DELETE ON public.client_martech
        FOR EACH ROW
        EXECUTE FUNCTION public.trg_source_mark_memory_stale()
    ';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification — run after COMMIT
-- ============================================================================
--
-- 1) Table + triggers exist
-- SELECT to_regclass('public.client_memory'), to_regclass('public.client_memory_facts_history');
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.client_memory'::regclass AND NOT tgisinternal;
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE '%mark_memory_stale%';
--
-- 2) RLS policies
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='client_memory';
--
-- 3) Helper function
-- SELECT proname FROM pg_proc WHERE proname='mark_client_memory_stale';
