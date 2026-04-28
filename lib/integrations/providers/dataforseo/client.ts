/**
 * DataForSEOClient — subclass di BaseProviderClient per le API DataForSEO.
 *
 * DataForSEO usa **Basic Auth** (login = email account, password = password
 * scelta al signup) come single point of auth per tutti gli endpoint.
 * Configurazione tramite due env var:
 *   DATAFORSEO_LOGIN    (email account)
 *   DATAFORSEO_PASSWORD (password)
 *
 * In Phase 7B-2 esponiamo solo gli endpoint che servono al use case
 * pre-sales/domain-snapshot:
 *   - serpGoogleOrganic   — top 100 risultati organici + features SERP
 *   - serpGoogleAIMode    — risposta dell'AI Overview di Google (se presente)
 *
 * Altri endpoint DataForSEO (keyword volume, backlink, traffic estimation,
 * domain history, ecc.) verranno aggiunti man mano che servono. La filosofia
 * è: una funzione = un endpoint = un caso d'uso del prodotto.
 *
 * Pricing (Live mode, prezzi al 2026-04, indicativi):
 *   - serp/google/organic/live/advanced     ~ $0.0006 per query
 *   - serp/google/ai_mode/live/advanced     ~ $0.0008 per query
 * Quindi una scansione pre-sales di 100 keyword costa ~$0.06.
 *
 * Documentazione provider: https://docs.dataforseo.com/v3/
 */

import { BaseProviderClient, type CallResult, type BaseProviderClientOptions } from '@/lib/integrations/core/client'

const BASE_URL = 'https://api.dataforseo.com/v3'

// Costi per chiamata (USD). Aggiornare quando il provider cambia listino.
const COST_PER_CALL: Record<string, number> = {
  'serp:google:organic:live': 0.0006,
  'serp:google:ai_mode:live': 0.0008,
}

export interface DataForSEOCredentials {
  login: string
  password: string
}

export interface DataForSEOClientOptions extends Omit<BaseProviderClientOptions, 'providerName'> {
  credentials?: DataForSEOCredentials // se omessa, legge da env
}

/**
 * Helper per leggere le credenziali da env. Esposto separatamente così le
 * route handler possono validare presto e tornare 503 se mancano.
 */
export function readDataForSEOCredentialsFromEnv(): DataForSEOCredentials | null {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) return null
  return { login, password }
}

export class DataForSEOClient extends BaseProviderClient {
  private readonly credentials: DataForSEOCredentials

  constructor(opts: DataForSEOClientOptions) {
    super({
      ...opts,
      providerName: 'dataforseo',
      // SERP "live" può essere lento (10-30s). Aumentiamo timeout default.
      defaultTimeoutMs: opts.defaultTimeoutMs ?? 60_000,
    })
    const creds = opts.credentials ?? readDataForSEOCredentialsFromEnv()
    if (!creds) {
      throw new Error(
        'DataForSEO credentials missing: pass `credentials` or set DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD env vars',
      )
    }
    this.credentials = creds
  }

  protected headers(): Record<string, string> {
    const token = Buffer.from(`${this.credentials.login}:${this.credentials.password}`).toString('base64')
    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    }
  }

  protected costFromResponse(_status: number, body: unknown): { usd?: number; units?: number } {
    // DataForSEO ritorna un campo top-level `cost` (USD) per ogni request.
    // Es: { status_code: 20000, cost: 0.0006, tasks: [...] }
    if (body && typeof body === 'object' && 'cost' in body) {
      const cost = (body as { cost?: number }).cost
      if (typeof cost === 'number') {
        return { usd: cost, units: 1 }
      }
    }
    return {}
  }

  // ---------------------------------------------------------------------
  // SERP — Google Organic Live (advanced)
  // Restituisce posizioni organiche + ricche features SERP (AI Overview,
  // featured snippet, PAA, knowledge graph, video, images, ...) per la
  // keyword/location/language richieste.
  // ---------------------------------------------------------------------
  async serpGoogleOrganic(args: {
    keyword: string
    location: string // es. 'Italy' / 'United States' / 'Rome,Italy'
    language?: string // ISO code, es. 'it' / 'en'
    device?: 'desktop' | 'mobile'
    /** Quante posizioni richiedere. Default: 100 (max). */
    depth?: number
  }): Promise<CallResult<DataForSEOEnvelope>> {
    return this.call<DataForSEOEnvelope>({
      endpoint: 'serp:google:organic:live',
      method: 'POST',
      url: `${BASE_URL}/serp/google/organic/live/advanced`,
      body: [
        {
          keyword: args.keyword,
          location_name: args.location,
          language_code: args.language ?? 'it',
          device: args.device ?? 'desktop',
          depth: args.depth ?? 100,
        },
      ],
      metadata: {
        keyword: args.keyword,
        location: args.location,
        language: args.language ?? 'it',
        device: args.device ?? 'desktop',
        cost_estimate_usd: COST_PER_CALL['serp:google:organic:live'],
      },
    })
  }

  // ---------------------------------------------------------------------
  // SERP — Google AI Mode (advanced)
  // Restituisce la risposta generata da Google nell'AI Overview, incluse le
  // citazioni delle fonti (utili per capire chi vince visibilità AI).
  // Endpoint relativamente nuovo (introdotto da DataForSEO nel 2025).
  // ---------------------------------------------------------------------
  async serpGoogleAIMode(args: {
    keyword: string
    location: string
    language?: string
  }): Promise<CallResult<DataForSEOEnvelope>> {
    return this.call<DataForSEOEnvelope>({
      endpoint: 'serp:google:ai_mode:live',
      method: 'POST',
      url: `${BASE_URL}/serp/google/ai_mode/live/advanced`,
      body: [
        {
          keyword: args.keyword,
          location_name: args.location,
          language_code: args.language ?? 'it',
        },
      ],
      metadata: {
        keyword: args.keyword,
        location: args.location,
        language: args.language ?? 'it',
        cost_estimate_usd: COST_PER_CALL['serp:google:ai_mode:live'],
      },
    })
  }
}

/**
 * Forma comune dell'envelope di risposta DataForSEO. È identica per tutti
 * gli endpoint (anche non-SERP), quindi la teniamo come tipo riutilizzabile.
 *
 * Nota: i `tasks[].result` sono fortemente endpoint-specifici. Le validation
 * Zod e il parsing in shape interna JBA stanno in `adapters.ts`.
 */
export interface DataForSEOEnvelope {
  version: string
  status_code: number
  status_message: string
  time: string
  cost: number
  tasks_count: number
  tasks_error: number
  tasks: Array<{
    id: string
    status_code: number
    status_message: string
    time: string
    cost: number
    result_count: number
    path: string[]
    data: Record<string, unknown>
    result: unknown[] | null
  }>
}
