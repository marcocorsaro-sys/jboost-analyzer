-- ============================================================================
-- JBoost Analyzer — Phase 1B
-- Knowledge base schema for RAG: documents, chunks (with pgvector embeddings),
-- structured insights, entities, meeting notes, Ask J artifacts,
-- and weekly update subscriptions. All tables client-scoped via client_members.
-- ============================================================================

-- ============================================================================
-- 1. knowledge_documents — unified container for all knowledge inputs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN (
    'file_pdf','file_docx','file_xlsx','file_pptx','file_txt',
    'transcript_teams','transcript_generic',
    'note_manual','email','web_clip',
    'ask_j_artifact'
  )),
  source_name       TEXT NOT NULL,
  storage_path      TEXT,
  raw_content       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingestion_status  TEXT NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN (
    'pending','parsing','chunking','embedding','extracting_insights','ready','failed'
  )),
  ingestion_error   TEXT,
  token_count       INT,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kdoc_client      ON public.knowledge_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_kdoc_status      ON public.knowledge_documents(ingestion_status);
CREATE INDEX IF NOT EXISTS idx_kdoc_source_type ON public.knowledge_documents(source_type);
CREATE INDEX IF NOT EXISTS idx_kdoc_created     ON public.knowledge_documents(client_id, created_at DESC);

DROP TRIGGER IF EXISTS knowledge_documents_updated_at ON public.knowledge_documents;
CREATE TRIGGER knowledge_documents_updated_at
  BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kdoc_select" ON public.knowledge_documents;
DROP POLICY IF EXISTS "kdoc_insert" ON public.knowledge_documents;
DROP POLICY IF EXISTS "kdoc_update" ON public.knowledge_documents;
DROP POLICY IF EXISTS "kdoc_delete" ON public.knowledge_documents;

CREATE POLICY "kdoc_select" ON public.knowledge_documents FOR SELECT TO authenticated
  USING (public.user_has_client_access(client_id));
CREATE POLICY "kdoc_insert" ON public.knowledge_documents FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id));
CREATE POLICY "kdoc_update" ON public.knowledge_documents FOR UPDATE TO authenticated
  USING (public.user_can_edit_client(client_id));
CREATE POLICY "kdoc_delete" ON public.knowledge_documents FOR DELETE TO authenticated
  USING (public.user_can_edit_client(client_id));

-- ============================================================================
-- 2. knowledge_chunks — text chunks with OpenAI text-embedding-3-small vectors
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  chunk_index     INT  NOT NULL,
  content         TEXT NOT NULL,
  content_tokens  INT,
  embedding       VECTOR(1536),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kchunk_document ON public.knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kchunk_client   ON public.knowledge_chunks(client_id);
-- HNSW index for approximate nearest-neighbor search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_kchunk_embedding_hnsw
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kchunk_select" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "kchunk_insert" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "kchunk_delete" ON public.knowledge_chunks;

CREATE POLICY "kchunk_select" ON public.knowledge_chunks FOR SELECT TO authenticated
  USING (public.user_has_client_access(client_id));
CREATE POLICY "kchunk_insert" ON public.knowledge_chunks FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id));
CREATE POLICY "kchunk_delete" ON public.knowledge_chunks FOR DELETE TO authenticated
  USING (public.user_can_edit_client(client_id));

-- ============================================================================
-- 3. knowledge_insights — structured facts extracted by LLM from documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.knowledge_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id   UUID REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  insight_type  TEXT NOT NULL CHECK (insight_type IN (
    'kpi','pain_point','goal','decision','budget',
    'tool_mentioned','competitor_mentioned','stakeholder',
    'deadline','risk','opportunity','action_item','preference','fact'
  )),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  structured    JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence    FLOAT NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
  source_quote  TEXT,
  extracted_by  TEXT NOT NULL DEFAULT 'claude' CHECK (extracted_by IN ('claude','openai','manual')),
  extracted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kinsight_client    ON public.knowledge_insights(client_id);
CREATE INDEX IF NOT EXISTS idx_kinsight_document  ON public.knowledge_insights(document_id);
CREATE INDEX IF NOT EXISTS idx_kinsight_type      ON public.knowledge_insights(client_id, insight_type);

ALTER TABLE public.knowledge_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kinsight_select" ON public.knowledge_insights;
DROP POLICY IF EXISTS "kinsight_insert" ON public.knowledge_insights;
DROP POLICY IF EXISTS "kinsight_update" ON public.knowledge_insights;
DROP POLICY IF EXISTS "kinsight_delete" ON public.knowledge_insights;

CREATE POLICY "kinsight_select" ON public.knowledge_insights FOR SELECT TO authenticated
  USING (public.user_has_client_access(client_id));
CREATE POLICY "kinsight_insert" ON public.knowledge_insights FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id));
CREATE POLICY "kinsight_update" ON public.knowledge_insights FOR UPDATE TO authenticated
  USING (public.user_can_edit_client(client_id));
CREATE POLICY "kinsight_delete" ON public.knowledge_insights FOR DELETE TO authenticated
  USING (public.user_can_edit_client(client_id));

-- ============================================================================
-- 4. knowledge_entities — named entities (people, companies, tools)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.knowledge_entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN (
    'person','company','product','tool','location','department','role'
  )),
  canonical_name  TEXT NOT NULL,
  aliases         TEXT[] NOT NULL DEFAULT '{}'::text[],
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  mention_count   INT NOT NULL DEFAULT 1,
  UNIQUE (client_id, entity_type, canonical_name)
);

CREATE INDEX IF NOT EXISTS idx_kentity_client ON public.knowledge_entities(client_id);
CREATE INDEX IF NOT EXISTS idx_kentity_type   ON public.knowledge_entities(client_id, entity_type);

ALTER TABLE public.knowledge_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kentity_select" ON public.knowledge_entities;
DROP POLICY IF EXISTS "kentity_insert" ON public.knowledge_entities;
DROP POLICY IF EXISTS "kentity_update" ON public.knowledge_entities;
DROP POLICY IF EXISTS "kentity_delete" ON public.knowledge_entities;

CREATE POLICY "kentity_select" ON public.knowledge_entities FOR SELECT TO authenticated
  USING (public.user_has_client_access(client_id));
CREATE POLICY "kentity_insert" ON public.knowledge_entities FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id));
CREATE POLICY "kentity_update" ON public.knowledge_entities FOR UPDATE TO authenticated
  USING (public.user_can_edit_client(client_id));
CREATE POLICY "kentity_delete" ON public.knowledge_entities FOR DELETE TO authenticated
  USING (public.user_can_edit_client(client_id));

-- ============================================================================
-- 5. meeting_notes — structured call transcripts with segments, action items
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.meeting_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id   UUID REFERENCES public.knowledge_documents(id) ON DELETE SET NULL,
  meeting_date  DATE,
  meeting_type  TEXT CHECK (meeting_type IN (
    'discovery','kickoff','status','review','sales_call','workshop','other'
  )),
  title         TEXT,
  participants  JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_sec  INT,
  segments      JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items  JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  topics        TEXT[] NOT NULL DEFAULT '{}'::text[],
  summary       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_client ON public.meeting_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_meeting_date   ON public.meeting_notes(client_id, meeting_date DESC);

ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_select" ON public.meeting_notes;
DROP POLICY IF EXISTS "meeting_insert" ON public.meeting_notes;
DROP POLICY IF EXISTS "meeting_update" ON public.meeting_notes;
DROP POLICY IF EXISTS "meeting_delete" ON public.meeting_notes;

CREATE POLICY "meeting_select" ON public.meeting_notes FOR SELECT TO authenticated
  USING (public.user_has_client_access(client_id));
CREATE POLICY "meeting_insert" ON public.meeting_notes FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id));
CREATE POLICY "meeting_update" ON public.meeting_notes FOR UPDATE TO authenticated
  USING (public.user_can_edit_client(client_id));
CREATE POLICY "meeting_delete" ON public.meeting_notes FOR DELETE TO authenticated
  USING (public.user_can_edit_client(client_id));

-- ============================================================================
-- 6. ask_j_artifacts — persistent artifacts generated by Ask J (Claude)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ask_j_artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id        UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  client_id         UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  artifact_type     TEXT NOT NULL CHECK (artifact_type IN (
    'markdown','code','table','mermaid','chart_spec','document'
  )),
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  language          TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  knowledge_doc_id  UUID REFERENCES public.knowledge_documents(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifact_conversation ON public.ask_j_artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_artifact_client       ON public.ask_j_artifacts(client_id);
CREATE INDEX IF NOT EXISTS idx_artifact_type         ON public.ask_j_artifacts(artifact_type);

ALTER TABLE public.ask_j_artifacts ENABLE ROW LEVEL SECURITY;

-- Note: the SELECT/INSERT/DELETE policies below are rewritten in 1C to use
-- (SELECT auth.uid()) instead of auth.uid() for better performance. They are
-- defined here initially for ordering safety on fresh databases.

DROP POLICY IF EXISTS "artifact_select" ON public.ask_j_artifacts;
DROP POLICY IF EXISTS "artifact_insert" ON public.ask_j_artifacts;
DROP POLICY IF EXISTS "artifact_delete" ON public.ask_j_artifacts;

CREATE POLICY "artifact_select" ON public.ask_j_artifacts FOR SELECT TO authenticated
  USING (
    (client_id IS NULL AND user_id = (SELECT auth.uid()))
    OR (client_id IS NOT NULL AND public.user_has_client_access(client_id))
  );

CREATE POLICY "artifact_insert" ON public.ask_j_artifacts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      client_id IS NULL
      OR public.user_can_edit_client(client_id)
    )
  );

CREATE POLICY "artifact_delete" ON public.ask_j_artifacts FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (client_id IS NOT NULL AND public.user_is_client_owner(client_id))
  );

-- ============================================================================
-- 7. client_update_subscriptions — weekly automation config (Phase 9 worker)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.client_update_subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled_drivers  TEXT[] NOT NULL DEFAULT '{discoverability,authority}'::text[],
  martech_scan     BOOLEAN NOT NULL DEFAULT true,
  pagespeed_scan   BOOLEAN NOT NULL DEFAULT true,
  frequency        TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly','biweekly','monthly')),
  next_run_at      TIMESTAMPTZ,
  last_run_at      TIMESTAMPTZ,
  alert_threshold  JSONB NOT NULL DEFAULT '{"score_drop": 5, "martech_change": true}'::jsonb,
  is_active        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_next_run
  ON public.client_update_subscriptions(next_run_at)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS client_update_subscriptions_updated_at ON public.client_update_subscriptions;
CREATE TRIGGER client_update_subscriptions_updated_at
  BEFORE UPDATE ON public.client_update_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_update_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_select" ON public.client_update_subscriptions;
DROP POLICY IF EXISTS "sub_insert" ON public.client_update_subscriptions;
DROP POLICY IF EXISTS "sub_update" ON public.client_update_subscriptions;
DROP POLICY IF EXISTS "sub_delete" ON public.client_update_subscriptions;

CREATE POLICY "sub_select" ON public.client_update_subscriptions FOR SELECT TO authenticated
  USING (public.user_has_client_access(client_id));
CREATE POLICY "sub_insert" ON public.client_update_subscriptions FOR INSERT TO authenticated
  WITH CHECK (public.user_is_client_owner(client_id));
CREATE POLICY "sub_update" ON public.client_update_subscriptions FOR UPDATE TO authenticated
  USING (public.user_is_client_owner(client_id));
CREATE POLICY "sub_delete" ON public.client_update_subscriptions FOR DELETE TO authenticated
  USING (public.user_is_client_owner(client_id));
