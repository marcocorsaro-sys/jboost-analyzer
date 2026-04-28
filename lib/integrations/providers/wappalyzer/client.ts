/**
 * WappalyzerClient — fetch HTML + headers di un dominio per la detection
 * MarTech. Wrappato dentro BaseProviderClient così otteniamo gratis log,
 * retry e timeout. Niente browser headless: solo HTTP, ~1MB max per pagina.
 *
 * Differenza rispetto al detector regex già presente in lib/martech/:
 *   - quello fa pattern matching limitato su src degli script
 *   - questo è dataset-driven (fingerprints.ts), copre header HTTP, meta
 *     tag, cookie, body HTML, e ritorna confidence + version
 *
 * Niente API key esterna: funziona solo con HTTP fetch sull'URL del cliente.
 */

import { BaseProviderClient, type CallResult, type BaseProviderClientOptions } from '@/lib/integrations/core/client'

export interface FetchPageResult {
  /** URL finale dopo eventuali redirect. */
  finalUrl: string
  /** HTML body grezzo (max ~1MB). */
  html: string
  /** Header HTTP della response (case-insensitive lookup). */
  headers: Record<string, string>
  /** Cookie names ricevuti via Set-Cookie (solo i nomi, non i valori). */
  cookieNames: string[]
  /** HTTP status. */
  status: number
}

export interface WappalyzerClientOptions extends Omit<BaseProviderClientOptions, 'providerName'> {}

const MAX_BYTES = 1_000_000 // 1MB cap sul body, sufficiente per detection
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; JBoostAnalyzer/1.0; +https://jboost-analyzer.vercel.app)'

export class WappalyzerClient extends BaseProviderClient {
  constructor(opts: WappalyzerClientOptions) {
    super({
      ...opts,
      providerName: 'wappalyzer',
      defaultTimeoutMs: opts.defaultTimeoutMs ?? 20_000,
    })
  }

  protected headers(): Record<string, string> {
    return {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
    }
  }

  /**
   * Scarica HTML + headers di un URL. Wrap minimale del fetch nativo —
   * non riusa BaseProviderClient.call() perché ha bisogno di controllo
   * sul parsing del body (text, non JSON) e sul cap dimensionale.
   * Logging in `integration_call_log` lo facciamo direttamente qui.
   */
  async fetchPage(url: string): Promise<CallResult<FetchPageResult>> {
    const targetUrl = url.startsWith('http') ? url : `https://${url}`
    const startedAt = new Date().toISOString()
    const startTime = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs)

    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
        redirect: 'follow',
      })
      clearTimeout(timer)

      const finalUrl = res.url
      const headerMap: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        headerMap[k.toLowerCase()] = v
      })
      const cookieNames = parseCookieNames(headerMap['set-cookie'] ?? '')

      // Read body con cap a MAX_BYTES per evitare di scaricare megabyte.
      const reader = res.body?.getReader()
      let html = ''
      let received = 0
      if (reader) {
        const decoder = new TextDecoder('utf-8', { fatal: false })
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            received += value.byteLength
            html += decoder.decode(value, { stream: true })
            if (received >= MAX_BYTES) {
              try { await reader.cancel() } catch { /* noop */ }
              break
            }
          }
        }
        html += decoder.decode()
      }

      const result: FetchPageResult = {
        finalUrl,
        html,
        headers: headerMap,
        cookieNames,
        status: res.status,
      }

      const latencyMs = Date.now() - startTime
      // Best-effort log su integration_call_log
      this.supabase
        .from('integration_call_log')
        .insert({
          client_id: (this as unknown as { clientId?: string }).clientId ?? null,
          analysis_id: (this as unknown as { analysisId?: string }).analysisId ?? null,
          user_id: (this as unknown as { userId?: string }).userId ?? null,
          provider: 'wappalyzer',
          endpoint: 'fetch_html',
          method: 'GET',
          http_status: res.status,
          latency_ms: latencyMs,
          cost_usd: 0, // OSS, niente costo monetario per fetch
          cost_units: 1,
          request_hash: null,
          cache_hit: false,
          attempt: 1,
          error: res.ok ? null : `HTTP ${res.status}`,
          metadata: {
            url: targetUrl,
            final_url: finalUrl,
            bytes: received,
            redirected: res.redirected,
          },
          started_at: startedAt,
          completed_at: new Date().toISOString(),
        })
        .then(() => undefined, () => undefined)

      return {
        ok: res.ok,
        status: res.status,
        data: res.ok ? result : null,
        error: res.ok ? undefined : `HTTP ${res.status}`,
        latencyMs,
        attempts: 1,
        costUsd: 0,
      }
    } catch (err: unknown) {
      clearTimeout(timer)
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `Timeout after ${this.defaultTimeoutMs}ms`
            : err.message
          : String(err)
      return {
        ok: false,
        status: 0,
        data: null,
        error: message,
        latencyMs: Date.now() - startTime,
        attempts: 1,
      }
    }
  }
}

function parseCookieNames(setCookieHeader: string): string[] {
  if (!setCookieHeader) return []
  // Set-Cookie può contenere multipli cookie separati da \n in alcune fetch impl;
  // estraiamo solo i nomi (parte prima di `=`).
  const parts = setCookieHeader.split(/,\s*(?=[^;]+=[^;]+)/)
  const names = new Set<string>()
  for (const p of parts) {
    const m = p.match(/^\s*([A-Za-z0-9_\-.]+)=/)
    if (m) names.add(m[1])
  }
  return Array.from(names)
}
