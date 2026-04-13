-- ============================================================================
-- JBoost Analyzer — Phase 4A
-- Activate full multi-tenant access on the clients table via client_members.
--
-- Phase 1A introduced client_members + helper functions but never replaced
-- the legacy RLS policies on public.clients (which were owner-only and were
-- created via Supabase Studio, so they don't appear in any prior migration).
-- This migration:
--   1. Adds an is_admin() helper.
--   2. Auto-registers the row creator as 'owner' in client_members on every
--      INSERT (via SECURITY DEFINER trigger so RLS on client_members is
--      bypassed cleanly).
--   3. Backfills any legacy client that has user_id but no owner row.
--   4. Drops every legacy policy on public.clients (names unknown — discovered
--      via pg_policies) and recreates a coherent set of 4 policies that route
--      access through user_has_client_access / user_can_edit_client /
--      user_is_client_owner with an admin override.
--
-- Idempotent and safe to re-run. NOT reversible automatically — to roll back
-- you would need to recreate the legacy owner-only policies manually.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. is_admin helper
-- ----------------------------------------------------------------------------
-- Reads public.profiles (which already exists, created pre-Phase 1A via the
-- Supabase Studio UI). SECURITY DEFINER lets it bypass RLS on profiles when
-- called from inside another policy.
CREATE OR REPLACE FUNCTION public.jboost_is_admin(p_user_id UUID DEFAULT auth.uid())
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

GRANT EXECUTE ON FUNCTION public.jboost_is_admin(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Auto-owner trigger on clients INSERT
-- ----------------------------------------------------------------------------
-- Every time a client is inserted, register the row's user_id (the creator)
-- as the 'owner' member. SECURITY DEFINER so the INSERT into client_members
-- isn't blocked by client_members' own RLS (which only allows existing
-- owners to add members — chicken-and-egg at creation time).
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

-- ----------------------------------------------------------------------------
-- 3. Backfill safety net
-- ----------------------------------------------------------------------------
-- Phase 1A already ran an equivalent backfill, but it's cheap to re-run and
-- guarantees no orphan client exists without an owner row before we flip
-- the policies.
INSERT INTO public.client_members (client_id, user_id, role, added_by)
SELECT id, user_id, 'owner', user_id
FROM public.clients
WHERE user_id IS NOT NULL
ON CONFLICT (client_id, user_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Drop legacy policies on public.clients
-- ----------------------------------------------------------------------------
-- We don't know the legacy policy names because they were created via the
-- Supabase Studio UI. Discover them dynamically and drop everything.
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

-- ----------------------------------------------------------------------------
-- 5. Ensure RLS is enabled on clients
-- ----------------------------------------------------------------------------
-- (No FORCE ROW LEVEL SECURITY: we want service_role to keep bypassing RLS
-- for server-side admin operations like the cron monitoring worker.)
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 6. New policies
-- ----------------------------------------------------------------------------
-- SELECT: any member of the client (owner/editor/viewer) or any admin.
CREATE POLICY "clients_select"
  ON public.clients FOR SELECT
  TO authenticated
  USING (
    public.user_has_client_access(id) OR public.jboost_is_admin()
  );

-- INSERT: an authenticated user can create a client they own. Admins can
-- create clients on behalf of anyone (used by future bulk-import flows).
CREATE POLICY "clients_insert"
  ON public.clients FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() OR public.jboost_is_admin()
  );

-- UPDATE: any owner or editor of the client, or any admin. The WITH CHECK
-- mirrors USING so a malicious editor cannot pivot the row to a different
-- owner they have no access to.
CREATE POLICY "clients_update"
  ON public.clients FOR UPDATE
  TO authenticated
  USING (
    public.user_can_edit_client(id) OR public.jboost_is_admin()
  )
  WITH CHECK (
    public.user_can_edit_client(id) OR public.jboost_is_admin()
  );

-- DELETE: only the owner or an admin. (The app uses soft delete via UPDATE
-- status='archived', so this policy is mostly for hard-delete admin paths
-- and the future Stage B prospect hard-delete flow.)
CREATE POLICY "clients_delete"
  ON public.clients FOR DELETE
  TO authenticated
  USING (
    public.user_is_client_owner(id) OR public.jboost_is_admin()
  );
