-- ============================================================
-- Phase 6 — Knowledge unification: bridge legacy client_files to
-- the modern knowledge_documents + knowledge_chunks pipeline
-- ============================================================
-- Problem: `client_files` is a legacy, hand-rolled knowledge table
-- (created via Supabase Studio before formal migrations existed).
-- The `memory/assembler.ts` already prefers the modern pipeline
-- (`knowledge_chunks` via RAG) but falls back to `client_files`
-- when the former has no hits for a given client. Every upload
-- via the /clients/[id]/knowledge page still went to the legacy
-- table, which meant:
--   • no chunking, no embeddings → invisible to memory RAG
--   • old files like Benetton's PDFs were not searchable
--   • the modern pipeline was shipped but never actually wired
--
-- This migration adds the bridge column so a legacy file can be
-- migrated one-time into a new knowledge_documents row and marked
-- as migrated, so the UI can distinguish "Legacy ✓ migrated" from
-- "Legacy ⚠ not yet migrated".
--
-- Nothing is deleted. The old client_files rows stay where they
-- are, preserving download links and backward compatibility with
-- the assembler legacy fallback. The new column is purely additive.
-- ============================================================

-- The client_files table was created outside of version-controlled
-- migrations, so we guard all statements with IF EXISTS / IF NOT
-- EXISTS to stay idempotent on environments that may or may not
-- have the legacy table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_files'
  ) THEN

    -- 1. Link column to the modern knowledge_documents row
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'client_files'
        AND column_name  = 'migrated_to_knowledge_document_id'
    ) THEN
      EXECUTE $ddl$
        ALTER TABLE public.client_files
          ADD COLUMN migrated_to_knowledge_document_id UUID
          REFERENCES public.knowledge_documents(id) ON DELETE SET NULL
      $ddl$;

      RAISE NOTICE '[phase6] added client_files.migrated_to_knowledge_document_id';
    ELSE
      RAISE NOTICE '[phase6] client_files.migrated_to_knowledge_document_id already present';
    END IF;

    -- 2. Index for "give me all not-yet-migrated files of client X"
    --    which is the primary bulk-migrate query.
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'client_files'
        AND indexname  = 'idx_client_files_not_migrated'
    ) THEN
      EXECUTE $ddl$
        CREATE INDEX idx_client_files_not_migrated
          ON public.client_files(client_id)
          WHERE migrated_to_knowledge_document_id IS NULL
      $ddl$;

      RAISE NOTICE '[phase6] added idx_client_files_not_migrated';
    END IF;

  ELSE
    RAISE NOTICE '[phase6] client_files table not present — nothing to bridge';
  END IF;
END
$$;

-- ============================================================
-- Verification queries (run manually after applying):
--
-- 1. Column present?
--    SELECT column_name, data_type
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'client_files'
--      AND column_name  = 'migrated_to_knowledge_document_id';
--
-- 2. Index present?
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'client_files';
--
-- 3. How many legacy files are waiting to be migrated?
--    SELECT client_id, COUNT(*) AS not_migrated
--    FROM public.client_files
--    WHERE migrated_to_knowledge_document_id IS NULL
--    GROUP BY client_id
--    ORDER BY not_migrated DESC;
--
-- 4. Migration ratio for a specific client (replace UUID):
--    SELECT
--      COUNT(*)                                                       AS total,
--      COUNT(migrated_to_knowledge_document_id)                       AS migrated,
--      COUNT(*) - COUNT(migrated_to_knowledge_document_id)            AS pending
--    FROM public.client_files
--    WHERE client_id = '00000000-0000-0000-0000-000000000000';
-- ============================================================
