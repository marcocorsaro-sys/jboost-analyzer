-- ============================================================================
-- JBoost Analyzer — Phase 1C
-- Fixes advisor lints from Phases 1A/1B:
--   - 6 unindexed foreign keys
--   - (RLS initplan fixes for ask_j_artifacts were already inlined in 1B,
--     this migration is only needed for the additional indexes on live DBs)
-- ============================================================================

-- Add missing FK indexes for faster joins and cascades
CREATE INDEX IF NOT EXISTS idx_artifact_knowledge_doc
  ON public.ask_j_artifacts(knowledge_doc_id);
CREATE INDEX IF NOT EXISTS idx_artifact_message
  ON public.ask_j_artifacts(message_id);
CREATE INDEX IF NOT EXISTS idx_artifact_user
  ON public.ask_j_artifacts(user_id);
CREATE INDEX IF NOT EXISTS idx_client_members_added_by
  ON public.client_members(added_by);
CREATE INDEX IF NOT EXISTS idx_kdoc_user
  ON public.knowledge_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_document
  ON public.meeting_notes(document_id);
