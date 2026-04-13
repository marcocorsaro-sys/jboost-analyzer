-- ============================================================================
-- JBoost Analyzer — Phase 5B (memory robustness)
--
-- Hot-fix migration that closes three gaps left open by Phase 1A + 5A which
-- together caused the Benetton "Not initialized" symptom:
--
--   1. Phase 1A's client_members backfill SKIPPED any client whose user_id
--      column was NULL. Those clients now have ZERO owners in client_members,
--      which means the RLS policy "client_memory_insert" rejects every
--      insert, the refresh flow can't even create a placeholder row, and
--      the user sees status='empty' forever.
--
--      Fix: promote the first active admin in profiles to be owner of every
--      orphaned client. If no admin exists at all (extreme edge case), the
--      first active user becomes the owner. Idempotent.
--
--   2. The Phase 5A flow created a client_memory row LAZILY, on the first
--      refresh attempt. That insert is subject to RLS, so any pre-existing
--      RLS misconfiguration shows up as "the row never gets created" rather
--      than a clean error.
--
--      Fix: pre-create a status='empty' client_memory row for every existing
--      client RIGHT NOW, via service-role bypass (this migration runs as
--      postgres). The first refresh then performs an UPDATE on a row that
--      definitely exists, removing one source of silent failure.
--
--   3. The Phase 1A clients trigger clients_register_owner_member_trg only
--      fires AFTER INSERT on clients, so any clients that already existed
--      before Phase 1A was applied stayed orphaned forever.
--
--      Fix: the same backfill in (1) covers them.
--
-- Idempotent — safe to re-run any number of times. Doesn't touch existing
-- memberships or memory rows.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Promote first admin (or first user) as owner of orphaned clients
-- ----------------------------------------------------------------------------
-- "Orphaned" = a client with zero rows in client_members where role='owner'.
-- We pick a deterministic fallback owner so re-running is stable:
--   a) first active admin (profiles.role='admin' AND is_active),
--   b) else first active non-admin,
--   c) else any user that exists in auth.users.

DO $$
DECLARE
  fallback_owner UUID;
BEGIN
  SELECT id INTO fallback_owner
  FROM public.profiles
  WHERE role = 'admin' AND is_active = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF fallback_owner IS NULL THEN
    SELECT id INTO fallback_owner
    FROM public.profiles
    WHERE is_active = TRUE
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF fallback_owner IS NULL THEN
    SELECT id INTO fallback_owner
    FROM auth.users
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF fallback_owner IS NULL THEN
    RAISE NOTICE '[phase5b] No users in the system at all — skipping orphan client backfill';
  ELSE
    INSERT INTO public.client_members (client_id, user_id, role, added_by)
    SELECT c.id, fallback_owner, 'owner', fallback_owner
    FROM public.clients c
    LEFT JOIN public.client_members m
      ON m.client_id = c.id AND m.role = 'owner'
    WHERE m.id IS NULL
    ON CONFLICT (client_id, user_id) DO NOTHING;

    RAISE NOTICE '[phase5b] Orphan client owners backfilled with fallback %', fallback_owner;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Pre-create empty client_memory rows for every existing client
-- ----------------------------------------------------------------------------
-- This means the application code can do an UPDATE (or upsert) on a row
-- that IS guaranteed to exist, removing a whole class of "silent insert
-- failure" symptoms. The row is just an empty placeholder; a real refresh
-- populates it.
INSERT INTO public.client_memory (client_id, status)
SELECT id, 'empty'
FROM public.clients
ON CONFLICT (client_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Sanity check (logged via NOTICE)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  orphans INT;
  memories INT;
  clients INT;
BEGIN
  SELECT COUNT(*) INTO clients FROM public.clients;
  SELECT COUNT(*) INTO memories FROM public.client_memory;
  SELECT COUNT(*) INTO orphans
  FROM public.clients c
  LEFT JOIN public.client_members m ON m.client_id = c.id AND m.role = 'owner'
  WHERE m.id IS NULL;

  RAISE NOTICE '[phase5b] clients=%, client_memory rows=%, clients without owner=%',
    clients, memories, orphans;

  IF orphans > 0 THEN
    RAISE WARNING '[phase5b] % clients still have no owner — investigate manually', orphans;
  END IF;
END $$;

COMMIT;
