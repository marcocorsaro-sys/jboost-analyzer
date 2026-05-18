-- Phase 11 — Fingerprint Bedrock
-- Tabella keyed per dominio normalizzato. Multi-cliente: il fingerprint di un
-- dominio è uno e uno solo, riusabile fra clienti diversi e per i prospect.
--
-- Pipeline (vedi lib/fingerprint/):
--   Stadio 1 — DNS CNAME + HTTP probes + pattern matching (free, deterministic)
--   Stadio 2 — PSI + CrUX (free quota)
--   Stadio 3 — Firecrawl scrape gated (paid, solo se Stadio 1 confidence bassa)
--   Stadio 4 — Sonnet interpreter gated (paid, sopra Firecrawl)
--
-- Output strutturato: ogni dimensione ha { value, confidence, sources[] }.
-- TTL per dimensione gestita lato applicazione tramite il singolo expires_at
-- (l'orchestratore ricalcola se anche solo CWV è stale).

CREATE TABLE IF NOT EXISTS public.domain_fingerprint_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          text NOT NULL,
  cms             jsonb NOT NULL DEFAULT '{}'::jsonb,
  cdn             jsonb NOT NULL DEFAULT '{}'::jsonb,
  analytics       jsonb NOT NULL DEFAULT '{}'::jsonb,
  tag_manager     jsonb NOT NULL DEFAULT '{}'::jsonb,
  cwv             jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_signals     jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  CONSTRAINT domain_fingerprint_snapshots_domain_key UNIQUE (domain),
  CONSTRAINT domain_fingerprint_snapshots_expires_after_generated
    CHECK (expires_at > generated_at)
);

CREATE INDEX IF NOT EXISTS idx_domain_fingerprint_expires
  ON public.domain_fingerprint_snapshots(expires_at);

CREATE INDEX IF NOT EXISTS idx_domain_fingerprint_domain_lower
  ON public.domain_fingerprint_snapshots(lower(domain));

ALTER TABLE public.domain_fingerprint_snapshots ENABLE ROW LEVEL SECURITY;

-- Lettura: utenti autenticati (è una "foto pubblica" del dominio, no PII)
DROP POLICY IF EXISTS "fingerprint_read_authenticated"
  ON public.domain_fingerprint_snapshots;
CREATE POLICY "fingerprint_read_authenticated"
  ON public.domain_fingerprint_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

-- Scrittura: solo service_role (orchestratore della PR F)
DROP POLICY IF EXISTS "fingerprint_service_role_write"
  ON public.domain_fingerprint_snapshots;
CREATE POLICY "fingerprint_service_role_write"
  ON public.domain_fingerprint_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.domain_fingerprint_snapshots IS
  'Fingerprint Bedrock — foto deterministica del dominio per CMS/CDN/Analytics/TagManager/CWV. Keyed per dominio normalizzato. Vedi lib/fingerprint/.';
