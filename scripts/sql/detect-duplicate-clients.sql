-- ============================================================
-- Detect duplicate client rows (same domain, same user)
-- ============================================================
-- Context: PR #7 surfaced that Benetton had TWO rows in `clients`
-- — one prospect/active and one active/active — pointing to the
-- same underlying domain. This confuses the memory assembler, the
-- monitoring cron (which picks both), and the analyzer client
-- picker. Neither was obviously "wrong" to delete.
--
-- This script is READ-ONLY. It builds a list of candidate duplicate
-- groups so an operator can inspect them before running the
-- companion merge-clients.sql script.
--
-- Detection rule: "duplicate" = same user_id AND same normalized
-- domain (case-folded, leading www. stripped) AND both non-archived.
--
-- Usage:
--   psql -f scripts/sql/detect-duplicate-clients.sql
--   # or paste into Supabase Dashboard > SQL Editor
-- ============================================================

WITH normalized AS (
  SELECT
    id,
    user_id,
    name,
    domain,
    LOWER(REGEXP_REPLACE(COALESCE(domain, ''), '^www\.', '')) AS norm_domain,
    status,
    lifecycle_stage,
    created_at,
    updated_at
  FROM public.clients
  WHERE status <> 'archived'
    AND lifecycle_stage <> 'archived'
    AND COALESCE(domain, '') <> ''
),
dup_groups AS (
  SELECT
    user_id,
    norm_domain,
    COUNT(*) AS row_count,
    ARRAY_AGG(id ORDER BY created_at) AS client_ids,
    ARRAY_AGG(name ORDER BY created_at) AS names,
    ARRAY_AGG(lifecycle_stage ORDER BY created_at) AS lifecycle_stages,
    ARRAY_AGG(created_at ORDER BY created_at) AS created_ats
  FROM normalized
  GROUP BY user_id, norm_domain
  HAVING COUNT(*) > 1
)
SELECT
  user_id,
  norm_domain,
  row_count,
  client_ids,
  names,
  lifecycle_stages,
  created_ats
FROM dup_groups
ORDER BY row_count DESC, norm_domain ASC;

-- ============================================================
-- For a single suspicious group, run this to see the full picture
-- including counts of related rows (analyses, files, memory):
--
-- Replace '<user_id>' and '<norm_domain>' with the values from the
-- query above.
--
-- SELECT
--   c.id,
--   c.name,
--   c.domain,
--   c.lifecycle_stage,
--   c.status,
--   c.created_at,
--   c.engagement_started_at,
--   (SELECT COUNT(*) FROM public.analyses a
--      WHERE a.client_id = c.id) AS analyses,
--   (SELECT COUNT(*) FROM public.client_files f
--      WHERE f.client_id = c.id) AS legacy_files,
--   (SELECT COUNT(*) FROM public.knowledge_documents kd
--      WHERE kd.client_id = c.id) AS kb_docs,
--   (SELECT COUNT(*) FROM public.knowledge_chunks kc
--      WHERE kc.client_id = c.id) AS kb_chunks,
--   (SELECT COUNT(*) FROM public.client_members m
--      WHERE m.client_id = c.id) AS members,
--   (SELECT status FROM public.client_memory cm
--      WHERE cm.client_id = c.id) AS memory_status,
--   (SELECT completeness FROM public.client_memory cm
--      WHERE cm.client_id = c.id) AS memory_completeness
-- FROM public.clients c
-- WHERE c.user_id = '<user_id>'::uuid
--   AND LOWER(REGEXP_REPLACE(COALESCE(c.domain, ''), '^www\.', '')) = '<norm_domain>'
-- ORDER BY c.created_at;
-- ============================================================
