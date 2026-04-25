-- =========================================================================
-- Phase 7 — Integration Layer Foundation
-- =========================================================================
-- Tabelle di supporto per il nuovo layer `lib/integrations/*` in arrivo:
--   1. integration_credentials  — secret per provider (system-wide o per-tenant)
--   2. integration_call_log     — audit append-only di ogni chiamata HTTP esterna
--   3. integration_cache        — cache K/V condivisa con TTL
--   4. integration_quota        — contatori giornalieri di unità + costo
--
-- Tutte e 4 queste tabelle sono SCOLLEGATE dal codice esistente: possono
-- essere applicate in produzione senza rischio di rotture. Saranno
-- popolate progressivamente quando i provider migreranno sotto
-- BaseProviderClient (lib/integrations/core/client.ts).
--
-- Convivenza con tabelle esistenti:
--   - app_config (key/value) → continua a contenere API key in chiaro per
--     `run-analysis` edge function. La migrazione a integration_credentials
--     cifrate avverrà in Phase 7B (dopo che il route Next.js è in produzione).
--   - llm_usage (LLM-only) → resta autoritativo per le call LLM. Il nuovo
--     integration_call_log audita tutte le altre chiamate (SEO API, GA4,
--     GSC, JHorizon, ecc.). Eventuale unificazione in Phase 7C.
--   - api_data (raw response per analisi) → continua a salvare l'output
--     deserializzato di ogni risposta. integration_cache vive sopra: cache
--     cross-analisi delle risposte raw, indipendente dall'analysis_id.
-- =========================================================================

BEGIN;

-- pgcrypto serve per `pgp_sym_encrypt/decrypt` (Phase 7B userà questi
-- per cifrare i secret in integration_credentials.secret_encrypted).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================================
-- 1) integration_credentials
-- =========================================================================
-- Per-tenant (client_id NOT NULL) o sistema (client_id NULL).
-- Provider attesi: 'semrush', 'ahrefs', 'pagespeed', 'serpapi',
-- 'openai', 'anthropic', 'perplexity', 'ga4', 'gsc', 'jhorizon', ecc.
--
-- secret_encrypted: ciphertext binario (mai plaintext). La chiave master
-- vive in env Vercel (`INTEGRATION_VAULT_KEY`); applicazione cifra e
-- decifra via pgcrypto. Nessuna policy SELECT espone questo campo agli
-- utenti finali — solo service_role può leggerlo.
--
-- scope: array opzionale di scope OAuth2 concessi (rilevante per ga4/gsc).
-- expires_at: per OAuth2 con refresh token automatico.

CREATE TABLE IF NOT EXISTS integration_credentials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  auth_type         TEXT NOT NULL,
  secret_encrypted  BYTEA NOT NULL,
  scope             TEXT[],
  expires_at        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'active',
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT integration_credentials_status_check
    CHECK (status IN ('active','revoked','expired','error')),
  CONSTRAINT integration_credentials_auth_type_check
    CHECK (auth_type IN ('api_key','oauth2','bearer_static','basic'))
);

-- Una sola credenziale attiva per coppia (client, provider). Il NULL su
-- client_id rappresenta la credenziale "system-wide": coalesco a una
-- stringa sentinella per poter creare l'unique anche su NULL.
CREATE UNIQUE INDEX IF NOT EXISTS integration_credentials_client_provider_key
  ON integration_credentials (COALESCE(client_id::text,'__system__'), provider)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS integration_credentials_provider_idx
  ON integration_credentials (provider);

CREATE INDEX IF NOT EXISTS integration_credentials_expires_idx
  ON integration_credentials (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

-- =========================================================================
-- 2) integration_call_log
-- =========================================================================
-- Append-only. Una riga per ogni chiamata HTTP esterna fatta dal layer.
-- Backbone dell'observability: dashboard "quanto mi costa Acme/mese",
-- "quale provider è in degrado", "qual è il p95 di latency", ecc.
--
-- request_hash: sha256(provider + endpoint + canonicalized(query/body))
-- — utile sia per cache lookup, sia per identificare retry/duplicate.
--
-- analysis_id e client_id sono opzionali (alcune chiamate sono cron-driven
-- e non hanno né l'una né l'altra, es. quota refresh).

CREATE TABLE IF NOT EXISTS integration_call_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  analysis_id     UUID REFERENCES analyses(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'GET',
  http_status     INT,
  latency_ms      INT,
  cost_usd        NUMERIC(10,6),
  cost_units      NUMERIC(12,2),
  tokens_in       INT,
  tokens_out      INT,
  request_hash    TEXT,
  cache_hit       BOOLEAN NOT NULL DEFAULT false,
  attempt         SMALLINT NOT NULL DEFAULT 1,
  error           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS integration_call_log_provider_started_idx
  ON integration_call_log (provider, started_at DESC);

CREATE INDEX IF NOT EXISTS integration_call_log_client_started_idx
  ON integration_call_log (client_id, started_at DESC)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS integration_call_log_analysis_idx
  ON integration_call_log (analysis_id)
  WHERE analysis_id IS NOT NULL;

-- Partial index per troubleshooting "errori recenti".
CREATE INDEX IF NOT EXISTS integration_call_log_errors_idx
  ON integration_call_log (provider, started_at DESC)
  WHERE error IS NOT NULL OR (http_status IS NOT NULL AND http_status >= 400);

-- Index per dedup / cache lookup by request_hash.
CREATE INDEX IF NOT EXISTS integration_call_log_request_hash_idx
  ON integration_call_log (request_hash, started_at DESC)
  WHERE request_hash IS NOT NULL;

-- =========================================================================
-- 3) integration_cache
-- =========================================================================
-- Cache K/V condivisa per chiamate idempotenti (es. site audit di un
-- dominio in 24h, domain rating in 7gg, ecc.).
--
-- cache_key è il PK ed è generato dal client come:
--   `${provider}:${endpoint}:${request_hash}`
-- TTL gestito da `ttl_at`; cleanup via cron giornaliero invocando
-- `integration_cache_purge_expired()`.

CREATE TABLE IF NOT EXISTS integration_cache (
  cache_key       TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  payload         JSONB NOT NULL,
  payload_size    INT,
  ttl_at          TIMESTAMPTZ NOT NULL,
  hits            INT NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_cache_ttl_idx
  ON integration_cache (ttl_at);

CREATE INDEX IF NOT EXISTS integration_cache_provider_idx
  ON integration_cache (provider);

-- Helper di purge: rimuove tutto ciò che è scaduto. Restituisce
-- il numero di righe eliminate. Da invocare da `/api/cron/integration-purge`
-- (un job che aggiungeremo in Phase 7B).
CREATE OR REPLACE FUNCTION public.integration_cache_purge_expired()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM integration_cache WHERE ttl_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

COMMENT ON FUNCTION public.integration_cache_purge_expired() IS
  'Phase 7: rimuove le entry scadute da integration_cache. Invocare da cron giornaliero.';

-- Helper di update atomico per cache hit (incrementa hits + aggiorna last_used_at).
CREATE OR REPLACE FUNCTION public.integration_cache_record_hit(p_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE integration_cache
     SET hits = hits + 1,
         last_used_at = now()
   WHERE cache_key = p_key;
END;
$$;

-- =========================================================================
-- 4) integration_quota
-- =========================================================================
-- Contatori giornalieri per provider. Una riga per (provider, day).
-- units_used incrementato dal client in modo atomico via helper;
-- units_limit configurato dall'admin (NULL = nessun limite enforced).

CREATE TABLE IF NOT EXISTS integration_quota (
  provider        TEXT NOT NULL,
  day             DATE NOT NULL,
  units_used      NUMERIC(14,2) NOT NULL DEFAULT 0,
  units_limit     NUMERIC(14,2),
  cost_usd        NUMERIC(12,4) NOT NULL DEFAULT 0,
  call_count      INT NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, day)
);

CREATE INDEX IF NOT EXISTS integration_quota_day_idx
  ON integration_quota (day DESC);

-- Helper atomico di incremento. Crea la riga se non esiste, altrimenti
-- somma. Da chiamare DOPO ogni chiamata API riuscita o falita (in modo
-- da contare anche i 429 che bruciano quota).
CREATE OR REPLACE FUNCTION public.integration_quota_increment(
  p_provider TEXT,
  p_units    NUMERIC,
  p_cost_usd NUMERIC DEFAULT 0
) RETURNS NUMERIC  -- restituisce units_used dopo l'incremento
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_used NUMERIC;
BEGIN
  INSERT INTO integration_quota (provider, day, units_used, cost_usd, call_count)
  VALUES (p_provider, current_date, p_units, p_cost_usd, 1)
  ON CONFLICT (provider, day) DO UPDATE
    SET units_used = integration_quota.units_used + EXCLUDED.units_used,
        cost_usd   = integration_quota.cost_usd   + EXCLUDED.cost_usd,
        call_count = integration_quota.call_count + 1,
        updated_at = now()
  RETURNING units_used INTO new_used;
  RETURN new_used;
END;
$$;

COMMENT ON FUNCTION public.integration_quota_increment(TEXT, NUMERIC, NUMERIC) IS
  'Phase 7: incrementa atomicamente i contatori giornalieri. Restituisce units_used aggiornato.';

-- Helper di check pre-call: ritorna TRUE se la chiamata può procedere
-- (cioè units_used + p_estimated_units < units_limit, oppure limit è NULL).
CREATE OR REPLACE FUNCTION public.integration_quota_can_call(
  p_provider          TEXT,
  p_estimated_units   NUMERIC DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  used NUMERIC;
  lim  NUMERIC;
BEGIN
  SELECT units_used, units_limit INTO used, lim
  FROM integration_quota
  WHERE provider = p_provider AND day = current_date;

  IF NOT FOUND THEN
    RETURN TRUE;  -- nessuna riga oggi → quota intatta
  END IF;

  IF lim IS NULL THEN
    RETURN TRUE;  -- limite non configurato → libero
  END IF;

  RETURN (used + p_estimated_units) <= lim;
END;
$$;

COMMENT ON FUNCTION public.integration_quota_can_call(TEXT, NUMERIC) IS
  'Phase 7: controlla quota residua prima di una chiamata. NULL limit = unlimited.';

-- =========================================================================
-- 5) RLS policies
-- =========================================================================
-- credentials: l'utente vede solo le proprie (client_id appartiene via
--              client_members con qualunque role). Le credenziali system
--              (client_id NULL) sono visibili solo a service_role / admin.
--              Insert/update/delete: solo service_role (che bypassa RLS).
-- call_log:    accessibile come 'credentials' (read-only). Audit, scrittura
--              solo service_role.
-- cache + quota: utility di sistema, RLS abilitata ma nessuna policy SELECT
--                per utenti normali → solo service_role accede.

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_call_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_cache       ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_quota       ENABLE ROW LEVEL SECURITY;

-- Riusa l'helper SECURITY DEFINER definita in phase 1A.
-- (public.user_has_client_access(UUID))

DROP POLICY IF EXISTS integration_credentials_select_own ON integration_credentials;
CREATE POLICY integration_credentials_select_own
  ON integration_credentials FOR SELECT
  TO authenticated
  USING (
    client_id IS NOT NULL
    AND public.user_has_client_access(client_id)
  );

-- Nota: i campi `secret_encrypted` rimangono ciphertext anche se l'utente
-- ha SELECT — la decifratura avviene server-side con la chiave master.

DROP POLICY IF EXISTS integration_call_log_select_own ON integration_call_log;
CREATE POLICY integration_call_log_select_own
  ON integration_call_log FOR SELECT
  TO authenticated
  USING (
    client_id IS NOT NULL
    AND public.user_has_client_access(client_id)
  );

-- =========================================================================
-- 6) updated_at trigger
-- =========================================================================
CREATE OR REPLACE FUNCTION public.integration_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS integration_credentials_updated_at ON integration_credentials;
CREATE TRIGGER integration_credentials_updated_at
BEFORE UPDATE ON integration_credentials
FOR EACH ROW EXECUTE FUNCTION public.integration_set_updated_at();

-- =========================================================================
-- 7) Documentation
-- =========================================================================
COMMENT ON TABLE integration_credentials IS
  'Phase 7: secret per provider esterno. client_id NULL = system-wide. Cifrato via pgcrypto, chiave master in env.';

COMMENT ON TABLE integration_call_log IS
  'Phase 7: audit append-only di ogni chiamata HTTP esterna NON-LLM. Backbone observability del layer integrations. (LLM call vivono in llm_usage)';

COMMENT ON TABLE integration_cache IS
  'Phase 7: cache K/V condivisa per chiamate idempotenti. TTL gestito da ttl_at. Purge via integration_cache_purge_expired().';

COMMENT ON TABLE integration_quota IS
  'Phase 7: contatori giornalieri per provider. Update atomico via integration_quota_increment(). Check pre-call via integration_quota_can_call().';

COMMIT;
