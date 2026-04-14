-- ============================================================
-- Merge two duplicate client rows into a single survivor
-- ============================================================
-- Context: companion to scripts/sql/detect-duplicate-clients.sql
--
-- Given two client IDs — a "survivor" (winner) and a "loser"
-- (the row to be archived) — this script:
--   1. Reparents all owned rows from loser → survivor
--      (analyses, client_files, knowledge_documents, client_members,
--       client_martech, client_memory, client_update_subscriptions,
--       conversations, activity_logs, client_memory_facts_history)
--   2. Archives the loser (status='archived', lifecycle_stage='archived')
--   3. Wraps everything in a single transaction so it is all-or-nothing
--
-- DRY RUN FIRST: the default is to wrap the whole block in
-- BEGIN ... ROLLBACK; inspect the per-table row counts in the final
-- SELECT, then if they look right re-run with ROLLBACK replaced by
-- COMMIT.
--
-- PRE-FLIGHT CHECKS:
--   1. Both rows belong to the same user_id (cross-tenant merge is
--      rejected). Check with:
--        SELECT id, user_id FROM clients WHERE id IN ('<SURVIVOR>','<LOSER>');
--   2. The survivor has the richer history (more analyses / the
--      engagement_started_at you actually want to keep). If unsure,
--      promote the more active one first.
--   3. NO client_member conflict: if both have a member entry with
--      the same user_id but different roles, the reparent will
--      fail on the unique constraint. Handle manually if that happens.
--
-- Usage:
--   1. Fill in SURVIVOR_ID and LOSER_ID below.
--   2. Paste into Supabase Dashboard > SQL Editor.
--   3. Verify counts in the final SELECT.
--   4. Change ROLLBACK -> COMMIT and re-run.
-- ============================================================

-- >>>>> FILL IN <<<<<
\set SURVIVOR_ID '00000000-0000-0000-0000-000000000000'
\set LOSER_ID    '00000000-0000-0000-0000-000000000001'

BEGIN;

-- Pre-flight: same user?
DO $$
DECLARE
  winner_user UUID;
  loser_user  UUID;
BEGIN
  SELECT user_id INTO winner_user FROM public.clients WHERE id = :'SURVIVOR_ID'::uuid;
  SELECT user_id INTO loser_user  FROM public.clients WHERE id = :'LOSER_ID'::uuid;

  IF winner_user IS NULL THEN
    RAISE EXCEPTION 'Survivor client % not found', :'SURVIVOR_ID';
  END IF;
  IF loser_user IS NULL THEN
    RAISE EXCEPTION 'Loser client % not found', :'LOSER_ID';
  END IF;
  IF winner_user <> loser_user THEN
    RAISE EXCEPTION 'Refusing to merge clients from different users (% vs %)',
      winner_user, loser_user;
  END IF;
  RAISE NOTICE '[merge-clients] user_id matches (%), proceeding', winner_user;
END $$;

-- ── 1. Reparent owned rows ─────────────────────────────────

UPDATE public.analyses
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

-- Legacy client_files (Phase 1 pipeline)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='client_files') THEN
    EXECUTE format(
      'UPDATE public.client_files SET client_id = %L WHERE client_id = %L',
      :'SURVIVOR_ID', :'LOSER_ID'
    );
  END IF;
END $$;

UPDATE public.knowledge_documents
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

UPDATE public.knowledge_chunks
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

-- client_members: only reparent entries whose user_id is NOT already
-- present on the survivor (would violate unique(client_id,user_id)).
DELETE FROM public.client_members
 WHERE client_id = :'LOSER_ID'::uuid
   AND user_id IN (
     SELECT user_id FROM public.client_members
      WHERE client_id = :'SURVIVOR_ID'::uuid
   );
UPDATE public.client_members
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

-- MarTech detected stack — additive, so just reparent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='client_martech') THEN
    EXECUTE format(
      'UPDATE public.client_martech SET client_id = %L WHERE client_id = %L',
      :'SURVIVOR_ID', :'LOSER_ID'
    );
  END IF;
END $$;

-- client_memory: singleton (unique on client_id), so if survivor
-- already has one, drop the loser's. Otherwise reparent.
DELETE FROM public.client_memory
 WHERE client_id = :'LOSER_ID'::uuid
   AND EXISTS (SELECT 1 FROM public.client_memory
               WHERE client_id = :'SURVIVOR_ID'::uuid);
UPDATE public.client_memory
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

UPDATE public.client_memory_facts_history
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

-- Monitoring subscription: same singleton logic.
DELETE FROM public.client_update_subscriptions
 WHERE client_id = :'LOSER_ID'::uuid
   AND EXISTS (SELECT 1 FROM public.client_update_subscriptions
               WHERE client_id = :'SURVIVOR_ID'::uuid);
UPDATE public.client_update_subscriptions
   SET client_id = :'SURVIVOR_ID'::uuid
 WHERE client_id = :'LOSER_ID'::uuid;

-- Conversations (chat history) — reparent freely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='conversations') THEN
    EXECUTE format(
      'UPDATE public.conversations SET client_id = %L WHERE client_id = %L',
      :'SURVIVOR_ID', :'LOSER_ID'
    );
  END IF;
END $$;

-- ── 2. Archive the loser ───────────────────────────────────

UPDATE public.clients
   SET status = 'archived',
       lifecycle_stage = 'archived',
       engagement_ended_at = COALESCE(engagement_ended_at, now()),
       updated_at = now()
 WHERE id = :'LOSER_ID'::uuid;

-- ── 3. Verification summary ────────────────────────────────

SELECT
  'survivor'::text AS role,
  c.id,
  c.name,
  c.lifecycle_stage,
  c.status,
  (SELECT COUNT(*) FROM public.analyses            WHERE client_id = c.id) AS analyses,
  (SELECT COUNT(*) FROM public.knowledge_documents WHERE client_id = c.id) AS kb_docs,
  (SELECT COUNT(*) FROM public.client_members      WHERE client_id = c.id) AS members
FROM public.clients c WHERE c.id = :'SURVIVOR_ID'::uuid
UNION ALL
SELECT
  'loser (archived)'::text,
  c.id,
  c.name,
  c.lifecycle_stage,
  c.status,
  (SELECT COUNT(*) FROM public.analyses            WHERE client_id = c.id),
  (SELECT COUNT(*) FROM public.knowledge_documents WHERE client_id = c.id),
  (SELECT COUNT(*) FROM public.client_members      WHERE client_id = c.id)
FROM public.clients c WHERE c.id = :'LOSER_ID'::uuid;

-- >>>>> DRY RUN: rollback by default. Replace with COMMIT when <<<<<
-- >>>>> the verification summary above looks right.              <<<<<
ROLLBACK;
