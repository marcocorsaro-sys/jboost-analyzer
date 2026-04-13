-- ============================================================================
-- JBoost Analyzer — Phase 5A
-- Client Memory: foundation table + history + auto-stale triggers.
--
-- This is the missing migration that has been blocking the entire client
-- memory subsystem. Every file under lib/memory/, every endpoint under
-- /api/clients/[id]/memory/*, and every component under components/memory/
-- already references public.client_memory — but the table never existed in
-- the database, so all writes fail silently inside try/catch and the GET
-- always returns the empty stub.
--
-- This migration:
--   1. Creates client_memory (singleton per client) with full RLS via the
--      Phase 4A helper functions.
--   2. Creates client_memory_facts_history for fact-level versioning so we
--      can audit how the AI's understanding has drifted over time.
--   3. Installs automatic "stale" markers on the four data sources the
--      memory consumes (analyses, knowledge_documents, client_files,
--      client_martech) so the UI can prompt the user to refresh when
--      something the memory depends on has changed. The triggers only mark
--      stale, they NEVER kick off a refresh themselves (would be a runaway
--      LLM cost).
--
-- Idempotent. The auto-stale triggers on optional tables (knowledge_documents,
-- client_files, client_martech) are wrapped in IF EXISTS checks so this
-- migration applies cleanly even if some Phase 1B/legacy tables aren't
-- present in this environment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. client_memory — singleton per client
-- ----------------------------------------------------------------------------
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

-- updated_at trigger uses the helper from Phase 1A
DROP TRIGGER IF EXISTS client_memory_updated_at_trg ON public.client_memory;
CREATE TRIGGER client_memory_updated_at_trg
  BEFORE UPDATE ON public.client_memory
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. client_memory RLS
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3. client_memory_facts_history — append-only fact audit log
-- ----------------------------------------------------------------------------
-- Every full memory refresh archives the previous facts into this table
-- before replacing them. Permits "show me how the AI's understanding of
-- this client has drifted" + future undo / restore flows. Append-only.
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

-- Read-only for users with access; writes happen via service role only
-- (the refresh helper bypasses RLS, no INSERT policy needed for clients).
CREATE POLICY "facts_history_select"
  ON public.client_memory_facts_history FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id) OR public.jboost_is_admin());

-- ----------------------------------------------------------------------------
-- 4. Auto-stale marker
-- ----------------------------------------------------------------------------
-- Helper that marks the memory of a client as 'stale' (needs refresh) if it
-- is currently 'ready' or 'empty'. Used by the auto-stale triggers below.
-- Doesn't touch already-failed memories or memories actively refreshing.
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

-- Trigger function for the analyses table: marks memory stale when an
-- analysis transitions to status='completed'. Both INSERT (in case the row
-- is created already-completed) and UPDATE (the typical flow: row inserted
-- with status='running', then transitioned by the edge function).
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

-- Generic trigger function for source tables that should mark memory stale
-- on any row change. Reads client_id from NEW (insert/update) or OLD (delete).
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

-- knowledge_documents (Phase 3 RAG pipeline) — only if the table exists
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

-- client_files (legacy Phase 1 knowledge) — only if the table exists
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

-- client_martech
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
