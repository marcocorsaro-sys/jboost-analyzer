/**
 * BaseProviderClient — fondamenta del layer `lib/integrations/`.
 *
 * Tutti i provider esterni (DataForSEO, SEMrush, Ahrefs, PageSpeed, GA4, GSC,
 * JHorizon, ecc.) eredieranno da questa base per ottenere gratis:
 *
 *  - fetch HTTP(S) con timeout e retry esponenziale su 429/5xx
 *  - log strutturato di ogni chiamata in `integration_call_log` (audit + cost)
 *  - cost hook per registrare units consumate e $/USD per chiamata
 *  - injection di header di auth specifici del provider via subclass override
 *
 * Phase 7B foundation. La cache (`integration_cache`) e la quota
 * (`integration_quota_*`) verranno cablate in step successivi una volta che
 * il primo provider (DataForSEO) sarà funzionante e ne dimostrerà l'utilità.
 *
 * Design notes
 * ------------
 *  - Niente classe astratta complicata. Una classe concreta `BaseProviderClient`
 *    con tre opzioni di customizzazione: `headers()`, `parseResponse()`, e
 *    `costFromResponse()`. Le subclass passano le opzioni al `super()`.
 *  - Service-role Supabase client iniettato dall'alto (non creato qui), così
 *    funziona sia in route handler che in script CLI / cron.
 *  - I log sono best-effort: se la scrittura su `integration_call_log` fallisce,
 *    NON si propaga l'errore al chiamante — l'observability è secondaria
 *    rispetto alla feature.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

export interface BaseProviderClientOptions {
  /** Identificativo del provider (semrush, ahrefs, dataforseo, ga4, ...). Usato come `provider` nel log. */
  providerName: string
  /** Service-role Supabase client per scrivere su integration_call_log. */
  supabase: SupabaseClient
  /** Default timeout per chiamata in ms. Default: 30000 (30s). */
  defaultTimeoutMs?: number
  /** Numero massimo di retry su 429/5xx. Default: 2 (3 tentativi totali). */
  maxRetries?: number
  /** Optional client_id per tagging multi-tenant nel log. */
  clientId?: string
  /** Optional analysis_id per legare la chiamata a un run di analisi. */
  analysisId?: string
  /** Optional user_id per attribuzione al chiamante. */
  userId?: string
}

export interface CallContext {
  /** Endpoint logico per il log (es. 'semrush:domain_rank'). */
  endpoint: string
  /** HTTP method. Default: GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** URL completo da invocare. */
  url: string
  /** Optional body JSON-serializable (per POST/PUT/PATCH). */
  body?: unknown
  /** Header aggiuntivi (auth specifici del provider). */
  headers?: Record<string, string>
  /** Override del timeout per questa chiamata. */
  timeoutMs?: number
  /** Override del max retries per questa chiamata. */
  maxRetries?: number
  /** Optional metadata libero da scrivere nel log (es. parametri di query, summary del payload). */
  metadata?: Record<string, unknown>
}

export interface CallResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  error?: string
  /** Latency totale incluso retries, ms. */
  latencyMs: number
  /** Numero di tentativi effettuati (1 = nessun retry). */
  attempts: number
  /** Cost stimato della chiamata in USD, se calcolabile. */
  costUsd?: number
  /** Cost in unit del provider (es. SEMrush API units), se calcolabile. */
  costUnits?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 2
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

/**
 * Calcola un hash deterministico della request per dedup / cache lookup.
 * Esposto come public helper così le subclass o i caller possono farlo
 * senza duplicare logica.
 */
export function computeRequestHash(args: {
  provider: string
  method: string
  url: string
  body?: unknown
}): string {
  const canonical = JSON.stringify({
    p: args.provider,
    m: args.method.toUpperCase(),
    u: args.url,
    b: args.body ?? null,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

export class BaseProviderClient {
  protected readonly providerName: string
  protected readonly supabase: SupabaseClient
  protected readonly defaultTimeoutMs: number
  protected readonly maxRetries: number
  protected readonly clientId?: string
  protected readonly analysisId?: string
  protected readonly userId?: string

  constructor(opts: BaseProviderClientOptions) {
    this.providerName = opts.providerName
    this.supabase = opts.supabase
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
    this.clientId = opts.clientId
    this.analysisId = opts.analysisId
    this.userId = opts.userId
  }

  /**
   * Override nel subclass per injectare auth header specifici del provider.
   * Esempio (DataForSEO Basic Auth):
   *   protected headers() {
   *     return {
   *       Authorization: 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64'),
   *       'Content-Type': 'application/json',
   *     }
   *   }
   */
  protected headers(): Record<string, string> {
    return {}
  }

  /**
   * Override nel subclass per calcolare il costo di una chiamata in base
   * alla risposta (es. SEMrush: numero di righe ritornate × cost-per-row).
   * Default: nessun costo registrato.
   */
  protected costFromResponse(_status: number, _body: unknown): { usd?: number; units?: number } {
    return {}
  }

  /**
   * Esegue una chiamata HTTP con retry/timeout/log. È il metodo principale
   * che le subclass useranno per ogni endpoint del loro provider.
   */
  async call<T = unknown>(ctx: CallContext): Promise<CallResult<T>> {
    const method = ctx.method ?? 'GET'
    const timeoutMs = ctx.timeoutMs ?? this.defaultTimeoutMs
    const maxRetries = ctx.maxRetries ?? this.maxRetries
    const requestHash = computeRequestHash({
      provider: this.providerName,
      method,
      url: ctx.url,
      body: ctx.body,
    })

    const startedAt = new Date().toISOString()
    const startTime = Date.now()
    let attempt = 0
    let lastStatus = 0
    let lastError: string | undefined
    let lastBody: unknown = null

    while (attempt < maxRetries + 1) {
      attempt++
      const attemptStart = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(ctx.url, {
          method,
          headers: { ...this.headers(), ...(ctx.headers ?? {}) },
          body: ctx.body !== undefined ? JSON.stringify(ctx.body) : undefined,
          signal: controller.signal,
        })
        clearTimeout(timer)

        lastStatus = res.status
        const text = await res.text()
        let parsed: unknown = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = { raw: text }
        }
        lastBody = parsed

        if (res.ok) {
          const cost = this.costFromResponse(res.status, parsed)
          const latencyMs = Date.now() - startTime
          // Log async, non blocca il return
          this.writeCallLog({
            startedAt,
            completedAt: new Date().toISOString(),
            endpoint: ctx.endpoint,
            method,
            httpStatus: res.status,
            latencyMs: Date.now() - attemptStart,
            costUsd: cost.usd,
            costUnits: cost.units,
            requestHash,
            attempt,
            error: null,
            metadata: ctx.metadata,
          }).catch(() => undefined)
          return {
            ok: true,
            status: res.status,
            data: parsed as T,
            latencyMs,
            attempts: attempt,
            costUsd: cost.usd,
            costUnits: cost.units,
          }
        }

        // Non-2xx: decidiamo se retry-are
        const isRetryable = RETRYABLE_STATUSES.has(res.status)
        lastError = `HTTP ${res.status}: ${typeof parsed === 'object' ? JSON.stringify(parsed).slice(0, 200) : String(text).slice(0, 200)}`
        if (!isRetryable || attempt > maxRetries) {
          const latencyMs = Date.now() - startTime
          this.writeCallLog({
            startedAt,
            completedAt: new Date().toISOString(),
            endpoint: ctx.endpoint,
            method,
            httpStatus: res.status,
            latencyMs: Date.now() - attemptStart,
            costUsd: undefined,
            costUnits: undefined,
            requestHash,
            attempt,
            error: lastError,
            metadata: ctx.metadata,
          }).catch(() => undefined)
          return {
            ok: false,
            status: res.status,
            data: null,
            error: lastError,
            latencyMs,
            attempts: attempt,
          }
        }
        // 429/5xx → backoff esponenziale prima del retry
        await this.sleep(this.backoffDelayMs(attempt))
      } catch (err: unknown) {
        clearTimeout(timer)
        const message =
          err instanceof Error
            ? err.name === 'AbortError'
              ? `Timeout after ${timeoutMs}ms`
              : err.message
            : String(err)
        lastError = message
        if (attempt > maxRetries) {
          const latencyMs = Date.now() - startTime
          this.writeCallLog({
            startedAt,
            completedAt: new Date().toISOString(),
            endpoint: ctx.endpoint,
            method,
            httpStatus: null,
            latencyMs: Date.now() - attemptStart,
            costUsd: undefined,
            costUnits: undefined,
            requestHash,
            attempt,
            error: message,
            metadata: ctx.metadata,
          }).catch(() => undefined)
          return {
            ok: false,
            status: 0,
            data: null,
            error: message,
            latencyMs,
            attempts: attempt,
          }
        }
        await this.sleep(this.backoffDelayMs(attempt))
      }
    }

    // Fallback teorico — il loop sopra dovrebbe sempre returnare prima di qui.
    return {
      ok: false,
      status: lastStatus,
      data: lastBody as T,
      error: lastError ?? 'Unknown error',
      latencyMs: Date.now() - startTime,
      attempts: attempt,
    }
  }

  // -----------------------------------------------------------------------
  // helpers private
  // -----------------------------------------------------------------------

  private async writeCallLog(entry: {
    startedAt: string
    completedAt: string
    endpoint: string
    method: string
    httpStatus: number | null
    latencyMs: number
    costUsd: number | undefined
    costUnits: number | undefined
    requestHash: string
    attempt: number
    error: string | null
    metadata: Record<string, unknown> | undefined
  }): Promise<void> {
    try {
      await this.supabase.from('integration_call_log').insert({
        client_id: this.clientId ?? null,
        analysis_id: this.analysisId ?? null,
        user_id: this.userId ?? null,
        provider: this.providerName,
        endpoint: entry.endpoint,
        method: entry.method,
        http_status: entry.httpStatus,
        latency_ms: entry.latencyMs,
        cost_usd: entry.costUsd ?? null,
        cost_units: entry.costUnits ?? null,
        request_hash: entry.requestHash,
        cache_hit: false,
        attempt: entry.attempt,
        error: entry.error,
        metadata: entry.metadata ?? {},
        started_at: entry.startedAt,
        completed_at: entry.completedAt,
      })
    } catch (err) {
      // Best-effort: log su console e continua
      // eslint-disable-next-line no-console
      console.warn(
        `[${this.providerName}] failed to write integration_call_log:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  private backoffDelayMs(attempt: number): number {
    // 500ms, 1500ms, 4500ms — exponential 3x con jitter ±20%
    const base = 500 * Math.pow(3, attempt - 1)
    const jitter = base * (Math.random() * 0.4 - 0.2)
    return Math.round(base + jitter)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}
