-- ============================================================================
-- JBoost Analyzer — Phase 12
-- Structured Data audit ("Schema Radiography"): JSON-LD + OpenGraph radiography
-- of the client's public site, scored against Google Rich Results + schema.org.
--
-- Stores the latest radiography per client as a single JSONB blob (mirrors the
-- client_martech_reports pattern) so the shape can evolve without migrations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_schema_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL UNIQUE
                  REFERENCES public.clients(id) ON DELETE CASCADE,
  report      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_schema_reports_client
  ON public.client_schema_reports(client_id);

DROP TRIGGER IF EXISTS client_schema_reports_updated_at_trg
  ON public.client_schema_reports;
CREATE TRIGGER client_schema_reports_updated_at_trg
  BEFORE UPDATE ON public.client_schema_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_schema_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_schema_reports_select" ON public.client_schema_reports;
DROP POLICY IF EXISTS "client_schema_reports_insert" ON public.client_schema_reports;
DROP POLICY IF EXISTS "client_schema_reports_update" ON public.client_schema_reports;
DROP POLICY IF EXISTS "client_schema_reports_delete" ON public.client_schema_reports;

CREATE POLICY "client_schema_reports_select"
  ON public.client_schema_reports FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id) OR public.jboost_is_admin());

CREATE POLICY "client_schema_reports_insert"
  ON public.client_schema_reports FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_edit_client(client_id) OR public.jboost_is_admin());

CREATE POLICY "client_schema_reports_update"
  ON public.client_schema_reports FOR UPDATE
  TO authenticated
  USING (public.user_can_edit_client(client_id) OR public.jboost_is_admin())
  WITH CHECK (public.user_can_edit_client(client_id) OR public.jboost_is_admin());

CREATE POLICY "client_schema_reports_delete"
  ON public.client_schema_reports FOR DELETE
  TO authenticated
  USING (public.user_can_edit_client(client_id) OR public.jboost_is_admin());
