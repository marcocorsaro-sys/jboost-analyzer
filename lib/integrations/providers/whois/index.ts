/**
 * WHOIS provider — RDAP via rdap.org (router pubblico gratuito).
 *
 * RDAP (Registration Data Access Protocol, RFC 7480-7484) è il successore
 * standard del classico WHOIS. È JSON-based, supportato da tutti i registry
 * principali (Verisign per .com/.net, Public Interest Registry per .org,
 * IANA, ecc.). Niente API key, niente parsing testuale ASCII fragile.
 *
 * Endpoint: https://rdap.org/domain/{domain} — il router redirige al
 * server RDAP del registry corretto in base al TLD.
 *
 * Per pre-sales ci interessa principalmente:
 *   - **Domain age** (registration date) — segnale di affidabilità per Google
 *   - **Expiration date** — risk se manca rinnovo
 *   - **Registrar** — chi gestisce il dominio (Cloudflare, GoDaddy, ecc.)
 *   - **Status** — "ok" oppure "client*Hold" indicano stato attivo
 *
 * Costo: $0. rdap.org ha rate limit ~10 req/sec ma generosi nel quotidiano.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BaseProviderClient, type CallResult, type BaseProviderClientOptions } from '@/lib/integrations/core/client'

const RDAP_ROUTER = 'https://rdap.org/domain/'

export interface WhoisClientOptions extends Omit<BaseProviderClientOptions, 'providerName'> {}

export class WhoisClient extends BaseProviderClient {
  constructor(opts: WhoisClientOptions) {
    super({ ...opts, providerName: 'whois', defaultTimeoutMs: opts.defaultTimeoutMs ?? 15_000 })
  }

  protected headers(): Record<string, string> {
    return {
      Accept: 'application/rdap+json, application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; JBoostAnalyzer/1.0)',
    }
  }

  /**
   * RDAP query per un dominio (es. 'jakala.com'). Il router redirige
   * automaticamente al server del registry. La response è JSON RDAP standard.
   */
  async lookupDomain(domain: string): Promise<CallResult<RdapDomainResponse>> {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
    return this.call<RdapDomainResponse>({
      endpoint: 'rdap:domain_lookup',
      method: 'GET',
      url: `${RDAP_ROUTER}${encodeURIComponent(cleanDomain)}`,
      metadata: { domain: cleanDomain },
    })
  }
}

/**
 * Forma minima della response RDAP che ci interessa. RFC 7483.
 */
export interface RdapDomainResponse {
  ldhName?: string // domain name (lowercase)
  status?: string[] // es. ['active', 'client transfer prohibited']
  events?: Array<{ eventAction: string; eventDate: string; eventActor?: string }>
  entities?: Array<{
    objectClassName?: string
    roles?: string[] // 'registrar', 'registrant', 'administrative', ...
    handle?: string
    vcardArray?: unknown[]
    publicIds?: Array<{ type: string; identifier: string }>
  }>
  nameservers?: Array<{ ldhName?: string }>
  notices?: unknown[]
}

// =========================================================================
// High-level helper
// =========================================================================

export interface WhoisSummary {
  ok: boolean
  domain: string
  registrationDate: string | null
  expirationDate: string | null
  lastChangedDate: string | null
  /** Età del dominio in giorni rispetto a today. null se non disponibile. */
  ageDays: number | null
  /** Età in anni (decimale). */
  ageYears: number | null
  /** Giorni mancanti alla scadenza. */
  daysToExpiry: number | null
  registrar: string | null
  status: string[]
  nameservers: string[]
  error?: string
}

export async function fetchWhoisSummary(args: {
  supabase: SupabaseClient
  domain: string
  clientId?: string
  analysisId?: string
  userId?: string
}): Promise<WhoisSummary> {
  const cleanDomain = args.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
  try {
    const client = new WhoisClient({
      supabase: args.supabase,
      clientId: args.clientId,
      analysisId: args.analysisId,
      userId: args.userId,
    })
    const res = await client.lookupDomain(cleanDomain)
    if (!res.ok || !res.data) {
      return emptySummary(cleanDomain, res.error ?? `HTTP ${res.status}`)
    }
    return adaptRdapResponse(res.data, cleanDomain)
  } catch (err) {
    return emptySummary(cleanDomain, err instanceof Error ? err.message : String(err))
  }
}

function adaptRdapResponse(data: RdapDomainResponse, domain: string): WhoisSummary {
  const events = data.events ?? []
  const findEventDate = (action: string): string | null => {
    const e = events.find((x) => x.eventAction?.toLowerCase() === action.toLowerCase())
    return e?.eventDate ?? null
  }

  const registrationDate = findEventDate('registration')
  const expirationDate = findEventDate('expiration')
  const lastChangedDate = findEventDate('last changed')

  const today = new Date()
  const ageDays = registrationDate
    ? Math.floor((today.getTime() - new Date(registrationDate).getTime()) / 86400000)
    : null
  const ageYears = ageDays !== null ? Math.round((ageDays / 365.25) * 10) / 10 : null
  const daysToExpiry = expirationDate
    ? Math.floor((new Date(expirationDate).getTime() - today.getTime()) / 86400000)
    : null

  // Estrai registrar dal vcardArray (formato vCard 4.0: array di array)
  let registrar: string | null = null
  for (const ent of data.entities ?? []) {
    if (!ent.roles?.some((r) => r.toLowerCase() === 'registrar')) continue
    const vcard = ent.vcardArray
    if (Array.isArray(vcard) && vcard.length >= 2 && Array.isArray(vcard[1])) {
      for (const item of vcard[1] as unknown[]) {
        if (Array.isArray(item) && item.length >= 4 && item[0] === 'fn') {
          if (typeof item[3] === 'string') {
            registrar = item[3]
            break
          }
        }
      }
    }
    if (registrar) break
  }

  const nameservers: string[] = []
  for (const ns of data.nameservers ?? []) {
    if (ns.ldhName) nameservers.push(ns.ldhName.toLowerCase())
  }

  return {
    ok: true,
    domain,
    registrationDate,
    expirationDate,
    lastChangedDate,
    ageDays,
    ageYears,
    daysToExpiry,
    registrar,
    status: data.status ?? [],
    nameservers,
  }
}

function emptySummary(domain: string, error?: string): WhoisSummary {
  return {
    ok: false,
    domain,
    registrationDate: null,
    expirationDate: null,
    lastChangedDate: null,
    ageDays: null,
    ageYears: null,
    daysToExpiry: null,
    registrar: null,
    status: [],
    nameservers: [],
    error,
  }
}
