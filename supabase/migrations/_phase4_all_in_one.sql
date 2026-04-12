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
