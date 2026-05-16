/**
 * Integration health probes — one per external API the app depends on.
 *
 * Each probe makes a cheap (free or sub-cent) live call to verify that the
 * configured credentials are valid and the provider is reachable. Results
 * feed the /api/admin/integrations-health endpoint and the admin panel tab.
 *
 * Cost discipline: probes must be free OR cost ≤ $0.0002 per run. SERP-style
 * scans are NOT acceptable here.
 */

export interface ProbeResult {
  ok: boolean
  latency_ms: number
  message: string
  /** Free-form provider-specific details (quota remaining, balance, etc.). */
  details?: Record<string, unknown>
}

export interface ProviderProbe {
  id: string
  label: string
  /** Env / app_config keys this provider needs. Probe is skipped if any are missing. */
  envKeys: string[]
  /** Hint about how the probe interacts with the provider (shown in UI). */
  costHint: string
  run: (keys: Record<string, string>) => Promise<ProbeResult>
}

const PROBE_TIMEOUT_MS = 8000

/** Wrap fetch with an AbortController so a hanging provider doesn't stall the panel. */
async function timedFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ res: Response; latency_ms: number }> {
  const ctrl = new AbortController()
  const timeoutMs = init.timeoutMs ?? PROBE_TIMEOUT_MS
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return { res, latency_ms: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

function ok(latency_ms: number, message: string, details?: Record<string, unknown>): ProbeResult {
  return { ok: true, latency_ms, message, details }
}
function fail(latency_ms: number, message: string, details?: Record<string, unknown>): ProbeResult {
  return { ok: false, latency_ms, message, details }
}

export const PROBES: ProviderProbe[] = [
  // ─── Anthropic ──────────────────────────────────────────────
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    envKeys: ['ANTHROPIC_API_KEY'],
    costHint: '≈ $0.0001 per test (1-token Haiku call)',
    async run(keys) {
      try {
        const { res, latency_ms } = await timedFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': keys.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: '.' }],
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error?.message || res.statusText}`)
        return ok(latency_ms, 'Reachable', { model: body?.model, stop_reason: body?.stop_reason })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── OpenAI ─────────────────────────────────────────────────
  {
    id: 'openai',
    label: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    costHint: 'Free (GET /v1/models)',
    async run(keys) {
      try {
        const { res, latency_ms } = await timedFetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${keys.OPENAI_API_KEY}` },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error?.message || res.statusText}`)
        const count = Array.isArray(body?.data) ? body.data.length : 0
        return ok(latency_ms, 'Reachable', { models_available: count })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── Perplexity ─────────────────────────────────────────────
  {
    id: 'perplexity',
    label: 'Perplexity',
    envKeys: ['PPLX_API_KEY'],
    costHint: '≈ $0.0001 per test (1-token sonar call)',
    async run(keys) {
      try {
        const { res, latency_ms } = await timedFetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${keys.PPLX_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'sonar',
            max_tokens: 1,
            messages: [{ role: 'user', content: '.' }],
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error?.message || res.statusText}`)
        return ok(latency_ms, 'Reachable', { model: body?.model })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── SEMrush ────────────────────────────────────────────────
  {
    id: 'semrush',
    label: 'SEMrush',
    envKeys: ['SEMRUSH_API_KEY'],
    costHint: '≈ 1 SEMrush unit (~$0.0001)',
    async run(keys) {
      try {
        // domain_rank for example.com — minimal payload, cheapest endpoint.
        const url = `https://api.semrush.com/?type=domain_rank&key=${keys.SEMRUSH_API_KEY}&domain=example.com&database=us&export_columns=Rk`
        const { res, latency_ms } = await timedFetch(url)
        const text = await res.text()
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${text.slice(0, 200)}`)
        if (text.startsWith('ERROR')) return fail(latency_ms, text.slice(0, 200))
        return ok(latency_ms, 'Reachable', { sample: text.slice(0, 80) })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── Ahrefs ─────────────────────────────────────────────────
  {
    id: 'ahrefs',
    label: 'Ahrefs',
    envKeys: ['AHREFS_API_KEY'],
    costHint: 'Free (subscription-info/limits-and-usage)',
    async run(keys) {
      try {
        const { res, latency_ms } = await timedFetch(
          'https://api.ahrefs.com/v3/subscription-info/limits-and-usage',
          { headers: { Authorization: `Bearer ${keys.AHREFS_API_KEY}`, Accept: 'application/json' } },
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error || res.statusText}`)
        const u = body?.limits_and_usage || body
        return ok(latency_ms, 'Reachable', {
          units_remaining: u?.units_limit_workspace != null
            ? `${u.units_usage_workspace ?? '?'}/${u.units_limit_workspace}`
            : undefined,
          subscription: u?.subscription,
        })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── DataForSEO ─────────────────────────────────────────────
  {
    id: 'dataforseo',
    label: 'DataForSEO',
    envKeys: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    costHint: 'Free (appendix/user_data)',
    async run(keys) {
      try {
        const token = Buffer.from(`${keys.DATAFORSEO_LOGIN}:${keys.DATAFORSEO_PASSWORD}`).toString('base64')
        const { res, latency_ms } = await timedFetch('https://api.dataforseo.com/v3/appendix/user_data', {
          headers: { Authorization: `Basic ${token}` },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.status_message || res.statusText}`)
        const task = Array.isArray(body?.tasks) ? body.tasks[0] : null
        if (!task || task.status_code >= 40000) {
          return fail(latency_ms, `DataForSEO error ${task?.status_code}: ${task?.status_message || 'unknown'}`)
        }
        const userData = Array.isArray(task?.result) ? task.result[0] : null
        return ok(latency_ms, 'Reachable', {
          money_balance: userData?.money?.balance,
          rates_left: userData?.rates?.limits_rate?.left,
        })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── Google PageSpeed Insights ──────────────────────────────
  {
    id: 'google_psi',
    label: 'Google PSI',
    envKeys: ['GOOGLE_PSI_API_KEY'],
    costHint: 'Free quota',
    async run(keys) {
      try {
        // Validate the key with a discovery-style call instead of a full PSI run,
        // which would take 20–30s. We hit the URL with a known-good domain and
        // ask only for the lightest category.
        const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&key=${keys.GOOGLE_PSI_API_KEY}&strategy=mobile&category=seo`
        const { res, latency_ms } = await timedFetch(url, { timeoutMs: 30_000 })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error?.message || res.statusText}`)
        return ok(latency_ms, 'Reachable', {
          lighthouse_version: body?.lighthouseResult?.lighthouseVersion,
        })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── Google CrUX ────────────────────────────────────────────
  {
    id: 'google_crux',
    label: 'Google CrUX',
    envKeys: ['GOOGLE_CRUX_KEY'],
    costHint: 'Free quota',
    async run(keys) {
      try {
        const url = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${keys.GOOGLE_CRUX_KEY}`
        const { res, latency_ms } = await timedFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ origin: 'https://example.com', formFactor: 'PHONE' }),
        })
        const body = await res.json().catch(() => ({}))
        // CrUX returns 404 when the origin has no field data — that still proves the API key is valid.
        if (res.ok || res.status === 404) {
          return ok(latency_ms, 'Reachable', { status: res.status })
        }
        return fail(latency_ms, `HTTP ${res.status}: ${body?.error?.message || res.statusText}`)
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── SerpAPI ────────────────────────────────────────────────
  {
    id: 'serpapi',
    label: 'SerpApi',
    envKeys: ['SERPAPI_KEY'],
    costHint: 'Free (account endpoint)',
    async run(keys) {
      try {
        const { res, latency_ms } = await timedFetch(`https://serpapi.com/account?api_key=${keys.SERPAPI_KEY}`)
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error || res.statusText}`)
        if (body?.error) return fail(latency_ms, String(body.error))
        return ok(latency_ms, 'Reachable', {
          plan: body?.plan_name,
          searches_left: body?.plan_searches_left,
        })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },

  // ─── Firecrawl (new) ────────────────────────────────────────
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    envKeys: ['FIRECRAWL_API_KEY'],
    costHint: 'Free (credit-usage endpoint)',
    async run(keys) {
      try {
        const { res, latency_ms } = await timedFetch('https://api.firecrawl.dev/v1/team/credit-usage', {
          headers: { Authorization: `Bearer ${keys.FIRECRAWL_API_KEY}` },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) return fail(latency_ms, `HTTP ${res.status}: ${body?.error || res.statusText}`)
        return ok(latency_ms, 'Reachable', {
          credits_remaining: body?.data?.remaining_credits ?? body?.remaining_credits,
        })
      } catch (e) {
        return fail(0, e instanceof Error ? e.message : String(e))
      }
    },
  },
]
