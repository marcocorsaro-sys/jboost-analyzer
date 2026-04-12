-- ============================================================================
-- JBoost Analyzer — Phase 4E
-- Bullet-proof guardrails at the database layer.
--
-- The application code already enforces "don't remove the last owner of a
-- client" (in /api/clients/[id]/members/[userId] PATCH/DELETE) and "don't
-- demote/disable/purge the last active admin" (in /api/admin/users/[id]
-- PATCH + /purge). Those checks are necessary for nice HTTP errors but they
-- live in user-facing code paths. This migration installs equivalent
-- triggers so that any other path — direct SQL, future cron jobs, manual
-- DBA operations, third-party scripts using the service role — also gets
-- blocked. Defence in depth.
--
-- Idempotent (DROP TRIGGER IF EXISTS / CREATE OR REPLACE).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Last-owner guardrail on client_members
-- ----------------------------------------------------------------------------
-- Prevents two scenarios:
--   a) DELETE the only remaining owner row of a client (orphans the row)
--   b) UPDATE the only remaining owner row to a non-owner role
-- Both are rejected with a clear error message.
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
    -- Only care if we are demoting an owner.
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

-- ----------------------------------------------------------------------------
-- 2. Last-admin guardrail on profiles
-- ----------------------------------------------------------------------------
-- Prevents:
--   a) UPDATE the only active admin to role='user'
--   b) UPDATE the only active admin to is_active=false
--   c) DELETE the only active admin (only relevant in case the FK to
--      auth.users isn't ON DELETE CASCADE; auth.users delete cascades
--      will trigger this and refuse, which is the intended behaviour
--      since we never want zero admins).
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
    -- Only care if we are *losing* an active admin.
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
