-- ============================================================================
-- JBoost Analyzer — Phase 4 + Phase 5 COMBINED one-shot bundle
-- Run this whole file in Supabase Studio → SQL Editor → New query → Run.
-- Idempotent + transactional inside each phase. Safe to re-run.
-- ============================================================================

-- ============================================================================
-- JBoost Analyzer — Phase 4 ALL-IN-ONE
--
-- Concatenates the four Phase 4 migrations in the order they MUST be applied:
--   1. 20260412100000_phase4a_clients_rls_via_members.sql
--   2. 20260412110000_phase4b_lifecycle_state_machine.sql
--   3. 20260412120000_phase4c_monitoring_engine.sql
--   4. 20260412130000_phase4e_guardrails.sql
--
-- Wrapped in a single transaction so any failure rolls back the whole batch.
-- Idempotent — safe to re-run if a previous attempt partially applied.
--
-- HOW TO RUN:
--   Supabase Studio -> SQL Editor -> New query -> paste this whole file ->
--   Run. Should report success in a few seconds. Then run the verification
--   queries at the bottom.
--
-- This file is NOT named with a numeric prefix on purpose, so the Supabase
-- migration tool ignores it. The four real files above are the source of
-- truth — this is just a convenience bundle for one-shot manual application.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1/4 — phase4a: enable multi-tenant RLS on clients via client_members
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.profiles WHERE id = p_user_id),
    false
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.clients_register_owner_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.client_members (client_id, user_id, role, added_by)
    VALUES (NEW.id, NEW.user_id, 'owner', NEW.user_id)
    ON CONFLICT (client_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS clients_register_owner_member_trg ON public.clients;
CREATE TRIGGER clients_register_owner_member_trg
  AFTER INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.clients_register_owner_member();

INSERT INTO public.client_members (client_id, user_id, role, added_by)
SELECT id, user_id, 'owner', user_id
FROM public.clients
WHERE user_id IS NOT NULL
ON CONFLICT (client_id, user_id) DO NOTHING;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clients'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.clients', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select"
  ON public.clients FOR SELECT
  TO authenticated
  USING (
    public.user_has_client_access(id) OR public.is_admin()
  );

CREATE POLICY "clients_insert"
  ON public.clients FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() OR public.is_admin()
  );

CREATE POLICY "clients_update"
  ON public.clients FOR UPDATE
  TO authenticated
  USING (
    public.user_can_edit_client(id) OR public.is_admin()
  )
  WITH CHECK (
    public.user_can_edit_client(id) OR public.is_admin()
  );

CREATE POLICY "clients_delete"
  ON public.clients FOR DELETE
  TO authenticated
  USING (
    public.user_is_client_owner(id) OR public.is_admin()
  );

-- ============================================================================
-- 2/4 — phase4b: lifecycle state machine (auto-stamp engagement dates)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clients_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.lifecycle_stage = 'active'
     AND OLD.lifecycle_stage = 'prospect'
     AND NEW.engagement_started_at IS NULL
  THEN
    NEW.engagement_started_at := now();
  END IF;

  IF NEW.lifecycle_stage = 'churned'
     AND OLD.lifecycle_stage IS DISTINCT FROM 'churned'
     AND NEW.engagement_ended_at IS NULL
  THEN
    NEW.engagement_ended_at := now();
  END IF;

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

-- ============================================================================
-- 3/4 — phase4c: monitoring engine
-- ============================================================================

ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS source TEXT
    DEFAULT 'manual'
    CHECK (source IN ('manual','monitoring'));

CREATE INDEX IF NOT EXISTS idx_analyses_client_source_completed
  ON public.analyses (client_id, source, completed_at DESC);

ALTER TABLE public.client_update_subscriptions
  ADD COLUMN IF NOT EXISTS frequency_days SMALLINT;

ALTER TABLE public.client_update_subscriptions
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.compute_next_run_at(
  p_anchor TIMESTAMPTZ,
  p_frequency TEXT,
  p_frequency_days SMALLINT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_frequency_days IS NOT NULL AND p_frequency_days > 0
      THEN p_anchor + make_interval(days => p_frequency_days::int)
    WHEN p_frequency = 'biweekly'
      THEN p_anchor + INTERVAL '14 days'
    WHEN p_frequency = 'monthly'
      THEN p_anchor + INTERVAL '30 days'
    ELSE
      p_anchor + INTERVAL '7 days'
  END;
$fn$;

GRANT EXECUTE ON FUNCTION public.compute_next_run_at(TIMESTAMPTZ, TEXT, SMALLINT) TO authenticated;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'client_update_subscriptions'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.client_update_subscriptions',
      pol.policyname
    );
  END LOOP;
END $$;

ALTER TABLE public.client_update_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subs_select"
  ON public.client_update_subscriptions FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id) OR public.is_admin());

CREATE POLICY "subs_insert"
  ON public.client_update_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id) OR public.is_admin());

CREATE POLICY "subs_update"
  ON public.client_update_subscriptions FOR UPDATE
  TO authenticated
  USING (public.user_can_edit_client(client_id) OR public.is_admin())
  WITH CHECK (public.user_can_edit_client(client_id) OR public.is_admin());

CREATE POLICY "subs_delete"
  ON public.client_update_subscriptions FOR DELETE
  TO authenticated
  USING (public.user_is_client_owner(client_id) OR public.is_admin());

-- ============================================================================
-- 4/4 — phase4e: bullet-proof guardrails (last owner / last admin)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_members_last_owner_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  remaining INT;
  target_client UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'owner' THEN
      RETURN OLD;
    END IF;
    target_client := OLD.client_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role <> 'owner' OR NEW.role = 'owner' THEN
      RETURN NEW;
    END IF;
    target_client := OLD.client_id;
  ELSE
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO remaining
  FROM public.client_members
  WHERE client_id = target_client
    AND role = 'owner'
    AND (TG_OP = 'DELETE' AND id <> OLD.id
         OR TG_OP = 'UPDATE' AND id <> OLD.id);

  IF remaining < 1 THEN
    RAISE EXCEPTION
      'Cannot leave client % without an owner (last owner protection)',
      target_client
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$fn$;

DROP TRIGGER IF EXISTS client_members_last_owner_guard_trg ON public.client_members;
CREATE TRIGGER client_members_last_owner_guard_trg
  BEFORE UPDATE OR DELETE ON public.client_members
  FOR EACH ROW
  EXECUTE FUNCTION public.client_members_last_owner_guard();

CREATE OR REPLACE FUNCTION public.profiles_last_admin_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  remaining INT;
  was_active_admin BOOLEAN;
  is_now_active_admin BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    was_active_admin := (OLD.role = 'admin' AND OLD.is_active IS TRUE);
    IF NOT was_active_admin THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    was_active_admin := (OLD.role = 'admin' AND OLD.is_active IS TRUE);
    is_now_active_admin := (NEW.role = 'admin' AND NEW.is_active IS TRUE);
    IF NOT was_active_admin OR is_now_active_admin THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO remaining
  FROM public.profiles
  WHERE role = 'admin'
    AND is_active = TRUE
    AND id <> OLD.id;

  IF remaining < 1 THEN
    RAISE EXCEPTION
      'Cannot remove the last active admin (system would have zero admins)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_last_admin_guard_trg ON public.profiles;
CREATE TRIGGER profiles_last_admin_guard_trg
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_last_admin_guard();

COMMIT;

-- ============================================================================
-- Verification queries — run these AFTER COMMIT to confirm everything took.
-- ============================================================================
--
-- 1) Four policies on clients
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='clients';
--
-- 2) Every client has an owner row
-- SELECT c.id, c.name FROM clients c
-- LEFT JOIN client_members m ON m.client_id=c.id AND m.role='owner'
-- WHERE m.id IS NULL;
--
-- 3) Triggers installed
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
-- WHERE tgrelid IN ('public.clients'::regclass,'public.client_members'::regclass,'public.profiles'::regclass)
--   AND NOT tgisinternal;
--
-- 4) New columns
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='analyses' AND column_name='source';
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='client_update_subscriptions'
--   AND column_name IN ('frequency_days','paused_until');
--
-- 5) Helper SQL
-- SELECT proname FROM pg_proc WHERE proname IN ('compute_next_run_at','is_admin');


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
  USING (public.user_has_client_access(client_id) OR public.is_admin());

CREATE POLICY "client_memory_insert"
  ON public.client_memory FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id) OR public.is_admin());

CREATE POLICY "client_memory_update"
  ON public.client_memory FOR UPDATE
  TO authenticated
  USING (public.user_can_edit_client(client_id) OR public.is_admin())
  WITH CHECK (public.user_can_edit_client(client_id) OR public.is_admin());

CREATE POLICY "client_memory_delete"
  ON public.client_memory FOR DELETE
  TO authenticated
  USING (public.user_is_client_owner(client_id) OR public.is_admin());

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
  USING (public.user_has_client_access(client_id) OR public.is_admin());

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
