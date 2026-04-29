/**
 * CrUX provider — Chrome User Experience Report API.
 *
 * A differenza di PageSpeed Insights (Lighthouse "lab data" — sintetico, una
 * sola sessione headless Chrome), CrUX dà i **Core Web Vitals reali**
 * misurati su utenti veri di Chrome negli ultimi 28 giorni. Quando il sito
 * ha traffico sufficiente (>= ~1000 visitatori/mese in Chrome), CrUX
 * restituisce i p75 di LCP, FID/INP, CLS, FCP, TTFB; altrimenti torna 404.
 *
 * Useremo CrUX per:
 *   - alimentare meglio il driver `Experience` del framework 9-driver
 *   - sezione "Real-User Performance" del report Pre-Sales
 *
 * Auth: API key Google. Riusa GOOGLE_PSI_API_KEY (stessa Google Cloud project,
 * basta abilitare "Chrome UX Report API" nella console). Free quota: 25k req/day.
 *
 * Docs: https://developer.chrome.com/docs/crux/api
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BaseProviderClient, type CallResult, type BaseProviderClientOptions } from '@/lib/integrations/core/client'

const ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord'

export interface CruxClientOptions extends Omit<BaseProviderClientOptions, 'providerName'> {
  apiKey?: string // se omessa, legge da env GOOGLE_PSI_API_KEY o GOOGLE_CRUX_KEY
}

export class CruxClient extends BaseProviderClient {
  private readonly apiKey: string

  constructor(opts: CruxClientOptions) {
    super({ ...opts, providerName: 'crux', defaultTimeoutMs: opts.defaultTimeoutMs ?? 15_000 })
    const key = opts.apiKey || process.env.GOOGLE_CRUX_KEY || process.env.GOOGLE_PSI_API_KEY
    if (!key) throw new Error('CrUX requires GOOGLE_PSI_API_KEY or GOOGLE_CRUX_KEY env var')
    this.apiKey = key
  }

  protected headers(): Record<string, string> {
    return { 'Content-Type': 'application/json' }
  }

  /**
   * Query CrUX per origin (es. https://www.example.com) o url specifico.
   * Restituisce 404 se il sito non ha abbastanza traffico Chrome.
   */
  async queryRecord(args: {
    origin?: string
    url?: string
    formFactor?: 'DESKTOP' | 'PHONE' | 'TABLET'
    metrics?: string[] // default: 'largest_contentful_paint', 'cumulative_layout_shift', 'interaction_to_next_paint', 'experimental_time_to_first_byte'
  }): Promise<CallResult<CruxResponse>> {
    if (!args.origin && !args.url) {
      throw new Error('CrUX queryRecord requires either origin or url')
    }
    const body: Record<string, unknown> = {}
    if (args.origin) body.origin = args.origin
    if (args.url) body.url = args.url
    if (args.formFactor) body.formFactor = args.formFactor
    body.metrics = args.metrics ?? [
      'largest_contentful_paint',
      'cumulative_layout_shift',
      'interaction_to_next_paint',
      'experimental_time_to_first_byte',
      'first_contentful_paint',
    ]
    return this.call<CruxResponse>({
      endpoint: 'crux:queryRecord',
      method: 'POST',
      url: `${ENDPOINT}?key=${this.apiKey}`,
      body,
      metadata: {
        origin: args.origin,
        url: args.url,
        formFactor: args.formFactor ?? 'PHONE',
      },
    })
  }
}

export interface CruxMetric {
  /** Distribuzione p75 e tutti i percentili. */
  percentiles?: { p75?: number }
  /** Histogram a 3 buckets: good / needs improvement / poor. */
  histogram?: Array<{ start?: number; end?: number; density?: number }>
}

export interface CruxResponse {
  record: {
    key: { origin?: string; url?: string; formFactor?: string }
    metrics: Record<string, CruxMetric>
    collectionPeriod?: { firstDate?: { year: number; month: number; day: number }; lastDate?: { year: number; month: number; day: number } }
  }
  urlNormalizationDetails?: unknown
}

// =========================================================================
// High-level helper
// =========================================================================

export interface FetchCruxArgs {
  supabase: SupabaseClient
  domain: string
  formFactor?: 'DESKTOP' | 'PHONE'
  clientId?: string
  analysisId?: string
  userId?: string
}

export interface CruxSummary {
  ok: boolean
  available: boolean // false se 404 (no enough traffic)
  formFactor: 'DESKTOP' | 'PHONE'
  /** P75 dei Core Web Vitals — i numeri "che contano" per Google ranking. */
  lcpMs: number | null
  inpMs: number | null
  clsValue: number | null
  ttfbMs: number | null
  fcpMs: number | null
  /** Score 0..100 derivato dai threshold ufficiali Google: good=100, needs=50, poor=20. */
  score: number | null
  collectionPeriod: { from: string; to: string } | null
  error?: string
}

export async function fetchCruxSummary(args: FetchCruxArgs): Promise<CruxSummary> {
  const formFactor = args.formFactor ?? 'PHONE'
  const origin = args.domain.startsWith('http')
    ? new URL(args.domain).origin
    : `https://${args.domain.replace(/\/.*$/, '')}`

  try {
    const client = new CruxClient({
      supabase: args.supabase,
      clientId: args.clientId,
      analysisId: args.analysisId,
      userId: args.userId,
    })
    const res = await client.queryRecord({ origin, formFactor })
    if (!res.ok || !res.data) {
      // 404 è il caso "no traffic enough" — tornare ok=true ma available=false
      if (res.status === 404) {
        return { ok: true, available: false, formFactor, lcpMs: null, inpMs: null, clsValue: null, ttfbMs: null, fcpMs: null, score: null, collectionPeriod: null }
      }
      return { ok: false, available: false, formFactor, lcpMs: null, inpMs: null, clsValue: null, ttfbMs: null, fcpMs: null, score: null, collectionPeriod: null, error: res.error }
    }
    return adaptCruxResponse(res.data, formFactor)
  } catch (err) {
    return {
      ok: false, available: false, formFactor,
      lcpMs: null, inpMs: null, clsValue: null, ttfbMs: null, fcpMs: null, score: null,
      collectionPeriod: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function adaptCruxResponse(data: CruxResponse, formFactor: 'DESKTOP' | 'PHONE'): CruxSummary {
  const m = data.record.metrics
  const lcpMs = m.largest_contentful_paint?.percentiles?.p75 ?? null
  const inpMs = m.interaction_to_next_paint?.percentiles?.p75 ?? null
  const clsValue = m.cumulative_layout_shift?.percentiles?.p75 ?? null
  const ttfbMs = m.experimental_time_to_first_byte?.percentiles?.p75 ?? null
  const fcpMs = m.first_contentful_paint?.percentiles?.p75 ?? null

  const score = computeCruxScore({ lcpMs, inpMs, clsValue, ttfbMs, fcpMs })

  let collectionPeriod: CruxSummary['collectionPeriod'] = null
  const cp = data.record.collectionPeriod
  if (cp?.firstDate && cp?.lastDate) {
    collectionPeriod = {
      from: `${cp.firstDate.year}-${pad2(cp.firstDate.month)}-${pad2(cp.firstDate.day)}`,
      to: `${cp.lastDate.year}-${pad2(cp.lastDate.month)}-${pad2(cp.lastDate.day)}`,
    }
  }

  return {
    ok: true,
    available: true,
    formFactor,
    lcpMs,
    inpMs,
    clsValue,
    ttfbMs,
    fcpMs,
    score,
    collectionPeriod,
  }
}

/**
 * Score 0..100 sui 3 Core Web Vitals (LCP, INP, CLS), threshold Google ufficiali:
 *   - LCP good <= 2500ms, poor > 4000ms
 *   - INP good <= 200ms, poor > 500ms
 *   - CLS good <= 0.1, poor > 0.25
 * Per ogni metrica: good=100, needs=50, poor=20. Media dei tre.
 */
function computeCruxScore(m: { lcpMs: number | null; inpMs: number | null; clsValue: number | null; ttfbMs: number | null; fcpMs: number | null }): number | null {
  const components: number[] = []
  if (m.lcpMs !== null) components.push(m.lcpMs <= 2500 ? 100 : m.lcpMs <= 4000 ? 50 : 20)
  if (m.inpMs !== null) components.push(m.inpMs <= 200 ? 100 : m.inpMs <= 500 ? 50 : 20)
  if (m.clsValue !== null) components.push(m.clsValue <= 0.1 ? 100 : m.clsValue <= 0.25 ? 50 : 20)
  if (components.length === 0) return null
  return Math.round(components.reduce((a, b) => a + b, 0) / components.length)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
