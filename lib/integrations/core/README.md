# lib/integrations/core/

Foundation del layer Phase 7B. Tutti i provider esterni di JBoost Analyzer
(SEMrush, Ahrefs, PageSpeed, DataForSEO, Wappalyzer, Trends, GA4, GSC,
JHorizon, ecc.) ereditano da queste primitive per ottenere gratis:

- fetch HTTP(S) con timeout e retry esponenziale su 429/5xx
- log strutturato di ogni chiamata su `integration_call_log` (Phase 7 schema)
- cost tracking (USD + units) per provider tramite override
- propagation di `client_id` / `analysis_id` / `user_id` per audit multi-tenant

## Content map

| File | Cosa fa |
|---|---|
| `client.ts` | `BaseProviderClient` + `CallContext` / `CallResult` + helper `computeRequestHash` |

## Roadmap (in arrivo)

- `cache.ts` — get/set su `integration_cache` con TTL per provider, invocato dal `BaseProviderClient.call()` quando `ctx.cache.ttlSec` è settato.
- `quota.ts` — `canCall()` / `incrementUsed()` su `integration_quota_*` SQL helpers.
- `credentials.ts` — risolve credenziali per `(client_id, provider)` con fallback a env, da `integration_credentials` (cifrate) o `app_config` (legacy plain-text).
- `orchestrator.ts` — fan-out concorrente con deadline e partial-result tolerance per i use case `pre-sales/domain-snapshot`.

## Esempio d'uso (subclass minimale)

```ts
import { BaseProviderClient, type CallResult } from '@/lib/integrations/core/client'

export class DataForSEOClient extends BaseProviderClient {
  constructor(private readonly creds: { login: string; password: string }, opts: {
    supabase: SupabaseClient
    clientId?: string
    analysisId?: string
  }) {
    super({ ...opts, providerName: 'dataforseo', defaultTimeoutMs: 60_000 })
  }

  protected headers() {
    const token = Buffer.from(`${this.creds.login}:${this.creds.password}`).toString('base64')
    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    }
  }

  async serpOrganic(keyword: string, location: string): Promise<CallResult> {
    return this.call({
      endpoint: 'serp:google:organic_live',
      method: 'POST',
      url: 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      body: [{ keyword, location_name: location, language_code: 'it' }],
    })
  }
}
```

## Convenzioni log

Ogni chiamata produce **una sola riga** su `integration_call_log`, anche se
ci sono stati retry. Il campo `attempt` dice quanti tentativi sono stati
fatti. La `latency_ms` registrata è quella **dell'ultimo tentativo** (utile
per p95 / p99); per latency totale incluso retries, vedere il `latencyMs`
ritornato dalla call.

I log sono best-effort: una scrittura fallita su `integration_call_log` NON
fa fallire la chiamata stessa. La feature funziona anche con observability
spenta — sicurezza di degradazione progressiva.
