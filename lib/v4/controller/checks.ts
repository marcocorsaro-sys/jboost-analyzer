/**
 * V4 Controller — deterministic cross-audit review engine (pure).
 *
 * Why this module exists: during live testing, Speed measured zara.it AFTER
 * the analyst had replaced that competitor with zara.com — the evidence URLs
 * no longer belonged to the analyzed set, and no single worker could notice,
 * because each worker only sees its own job. The Controller is the reviewer
 * that sees the WHOLE audit at once and flags exactly that class of problem.
 *
 * V4 philosophy applies here twice over:
 *  - explicit errors, never silent zeros: every anomaly becomes a Finding
 *    with the actual values in the message, in Italian, like the pause and
 *    edit messages the analysts already read;
 *  - the Controller REPORTS, it never fixes. A finding may carry a
 *    `suggestion` ("usa Rilancia..."), but acting on it is a human call —
 *    an auto-fix would be exactly the silent correction V4 forbids.
 *
 * Pure by construction: everything is injected (analysis, sites, runs,
 * templates, edits digest, the clock). No Supabase handle, no I/O — the same
 * engine runs under the per-analysis route, the admin scope=all sweep and
 * the tests without a database.
 */

import { getV4Driver } from '@/lib/scoring/registry'

// ---------------------------------------------------------------------------
// Types — structural slices, so callers can pass DB rows or test fixtures.
// ---------------------------------------------------------------------------

export type FindingSeverity = 'error' | 'warning' | 'info'

export interface ControllerFinding {
  severity: FindingSeverity
  /** Stable slug: UI and future notifications key off it, never off text. */
  check:
    | 'domain_coherence'
    | 'template_coherence'
    | 'zero_with_no_evidence'
    | 'set_coverage'
    | 'stuck_job'
    | 'attempts_exhausted'
    | 'score_range'
    | 'leader_sanity'
    | 'insight_flags'
    | 'stale_drafts'
    | 'insights_error'
  driver_key?: string
  /** Italian, specific, with the offending values — like the pause messages. */
  message: string
  suggestion?: string
}

/** The analyses columns the Controller reads. */
export interface ControllerAnalysisMeta {
  id: string
  domain: string | null
  ref_date: string | null
  v4_insights_status: string | null
  v4_insights_error: string | null
  created_at: string | null
}

/** The analyzed set (client + competitors), as loadAnalysisSites returns it. */
export interface ControllerSite {
  site_ref: string
  /** Bare domain: no protocol, no www., lowercase. */
  domain: string
  name: string
  is_client: boolean
}

/** driver_runs slice — superset-safe vs DriverRunRow. */
export interface ControllerRun {
  driver_key: string
  enabled: boolean
  status: string
  score_absolute: number | null
  score_relative: number | null
  raw_payload: Record<string, unknown>
  llm_insight?: Record<string, unknown> | null
  decision_request?: Record<string, unknown> | null
  error: string | null
  attempts: number
  max_attempts: number
  created_at: string | null
  dispatched_at: string | null
  started_at: string | null
  lease_expires_at: string | null
}

export interface ControllerTemplate {
  site_ref: string
  template_key: string
  url: string | null
}

/** Digest of the edits table — the Controller needs counts, not rows. */
export interface ControllerEditsDigest {
  draftCount: number
  /** created_at of the OLDEST unpublished edit, null when none. */
  oldestDraftAt: string | null
}

export interface ControllerInput {
  analysis: ControllerAnalysisMeta
  sites: ControllerSite[]
  runs: ControllerRun[]
  templates: ControllerTemplate[]
  edits: ControllerEditsDigest
  /** Injected clock: the stuck/stale thresholds must be testable. */
  now: Date
}

// ---------------------------------------------------------------------------
// Thresholds — named so the messages and the tests share one source.
// ---------------------------------------------------------------------------

const STUCK_QUEUED_MIN = 30
const STUCK_LEASE_MIN = 10
const OPEN_DECISION_HOURS = 24
const STALE_DRAFT_HOURS = 24
/** Leader-index invariant: the best site scores exactly 100 (±0.1 rounding). */
const LEADER_TOLERANCE = 0.1

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * Does `host` belong to `domain`? Exact match, www., or any subdomain
 * (it.benetton.com belongs to benetton.com). Never the reverse: zara.it does
 * NOT belong to zara.com — that asymmetry is the whole zara.it lesson.
 */
function hostBelongsTo(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  const d = domain.toLowerCase()
  return h === d || h === `www.${d}` || h.endsWith(`.${d}`)
}

function hostInSet(host: string, allowed: string[]): boolean {
  return allowed.some((d) => hostBelongsTo(host, d))
}

/** Extract the host from a string only if it parses as an absolute URL. */
function hostOfUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

/**
 * Walk a payload fragment and collect every host it references: `domain`
 * keys are read as bare domains, and ANY string that parses as an absolute
 * URL contributes its host — evidence shapes differ per driver (pages[].url,
 * top_kw, psi links...), so the scan is recursive rather than schema-bound.
 */
function collectHosts(value: unknown, out: Set<string>, keyHint?: string): void {
  if (typeof value === 'string') {
    const urlHost = hostOfUrl(value)
    if (urlHost) out.add(urlHost)
    else if (keyHint === 'domain' && value.trim() !== '') out.add(value.trim().toLowerCase())
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHosts(item, out)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectHosts(v, out, k)
    }
  }
}

/** The per-site measurements a worker stashed in raw_payload.sites. */
interface PayloadSite {
  site_ref?: string
  domain?: string
  raw?: number | null
  score_relative?: number | null
  score_absolute?: number | null
  evidence?: Record<string, unknown>
}

function readPayloadSites(run: ControllerRun): PayloadSite[] {
  const sites = (run.raw_payload as { sites?: unknown })?.sites
  return Array.isArray(sites) ? (sites as PayloadSite[]) : []
}

function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 60_000
}

/** Last observable activity of a run: requeues reset dispatched_at, so take
 *  the most recent stamp among the ones that survive. */
function lastActivityIso(run: ControllerRun): string | null {
  const stamps = [run.dispatched_at, run.started_at, run.created_at]
    .filter((s): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s)))
  if (stamps.length === 0) return null
  return stamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

const fmtMin = (m: number) => `${Math.floor(m)} min`
const fmtHours = (m: number) => `${Math.floor(m / 60)}h`

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function runControllerChecks(input: ControllerInput): ControllerFinding[] {
  const { analysis, sites, runs, templates, edits, now } = input
  const findings: ControllerFinding[] = []

  // The current set: client + competitors, from the setup. This is the
  // authority every domain in every payload must answer to.
  const allowedDomains = sites.map((s) => s.domain).filter((d) => d !== '')
  const setLabel = allowedDomains.join(', ')
  const enabledRuns = runs.filter((r) => r.enabled)

  // --- domain_coherence (ERROR) — the zara.it check ------------------------
  // Every domain and every evidence URL a worker recorded must belong to the
  // CURRENT set. A payload measured before a competitor swap keeps the old
  // domain and would silently poison the comparison.
  if (allowedDomains.length > 0) {
    for (const run of enabledRuns) {
      const hosts = new Set<string>()
      collectHosts(readPayloadSites(run), hosts)
      const foreign = [...hosts].filter((h) => !hostInSet(h, allowedDomains)).sort()
      if (foreign.length > 0) {
        findings.push({
          severity: 'error',
          check: 'domain_coherence',
          driver_key: run.driver_key,
          message:
            `dominio fuori dal set nelle misure di ${run.driver_key}: ${foreign.join(', ')}. ` +
            `Il set corrente è: ${setLabel}. I dati si riferiscono a un sito che non fa più parte dell'audit.`,
          suggestion: 'rilancia il driver così misura il set attuale',
        })
      }
    }
  }

  // --- template_coherence (ERROR) ------------------------------------------
  // A template URL pointing at another site's domain means Speed/Schema/
  // Content would measure the wrong site while labelling it correctly.
  const domainByRef = new Map(sites.map((s) => [s.site_ref, s.domain]))
  for (const t of templates) {
    if (!t.url) continue
    const expected = domainByRef.get(t.site_ref)
    if (!expected) continue
    const host = hostOfUrl(t.url)
    if (host !== null && !hostBelongsTo(host, expected)) {
      findings.push({
        severity: 'error',
        check: 'template_coherence',
        message:
          `template "${t.template_key}" di ${t.site_ref}: l'URL ${t.url} punta a ${host}, ` +
          `ma il sito è ${expected}. I driver per-pagina misurerebbero il sito sbagliato.`,
        suggestion: 'correggi l\'URL del template nel setup',
      })
    }
  }

  // --- per-run checks on completed drivers ---------------------------------
  for (const run of enabledRuns) {
    const payloadSites = readPayloadSites(run)

    if (run.status === 'done') {
      // zero_with_no_evidence (WARNING): raw 0 with nothing behind it is
      // ambiguous — a legitimate zero carries evidence of the empty search.
      const bareZeros = payloadSites.filter((s) => {
        if (s.raw !== 0) return false
        const ev = s.evidence
        return ev === undefined || ev === null || Object.keys(ev).length === 0
      })
      if (bareZeros.length > 0) {
        findings.push({
          severity: 'warning',
          check: 'zero_with_no_evidence',
          driver_key: run.driver_key,
          message:
            `${run.driver_key}: raw = 0 senza evidence per ${bareZeros
              .map((s) => s.domain ?? s.site_ref ?? '?')
              .join(', ')}. Zero legittimo o misura mancata?`,
        })
      }

      // set_coverage (WARNING): a done driver that skipped part of the set.
      // Sometimes expected (source had no data), but it must be SEEN.
      const measuredRefs = new Set(
        payloadSites.filter((s) => s.raw !== null && s.raw !== undefined).map((s) => s.site_ref),
      )
      const missing = sites.filter((s) => !measuredRefs.has(s.site_ref))
      if (missing.length > 0 && payloadSites.length > 0) {
        findings.push({
          severity: 'warning',
          check: 'set_coverage',
          driver_key: run.driver_key,
          message:
            `${run.driver_key} è done ma non ha misurato: ${missing
              .map((s) => s.domain)
              .join(', ')}. Può essere previsto (fonte senza dati), ma va verificato.`,
        })
      }

      // leader_sanity (WARNING): leader-index invariant — with >=2 measured
      // sites the best score_relative is 100 by construction. Anything else
      // means the normalization ran on a different set than the payload shows.
      const relatives = payloadSites
        .map((s) => s.score_relative)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      if (relatives.length >= 2) {
        const max = Math.max(...relatives)
        if (Math.abs(max - 100) > LEADER_TOLERANCE) {
          findings.push({
            severity: 'warning',
            check: 'leader_sanity',
            driver_key: run.driver_key,
            message:
              `${run.driver_key}: il miglior score_relative del set è ${max}, non 100. ` +
              'Il leader-index impone leader = 100: la normalizzazione non riflette il payload.',
          })
        }
      }
      const negatives = payloadSites.filter((s) => typeof s.raw === 'number' && s.raw < 0)
      if (negatives.length > 0) {
        findings.push({
          severity: 'warning',
          check: 'leader_sanity',
          driver_key: run.driver_key,
          message:
            `${run.driver_key}: raw negativo per ${negatives
              .map((s) => `${s.domain ?? s.site_ref} (${s.raw})`)
              .join(', ')}. Nessuna misura V4 può essere < 0.`,
        })
      }
    }

    // --- stuck_job ----------------------------------------------------------
    if (run.status === 'queued' && run.attempts > 0) {
      const idle = minutesSince(lastActivityIso(run), now)
      if (idle !== null && idle > STUCK_QUEUED_MIN) {
        findings.push({
          severity: 'warning',
          check: 'stuck_job',
          driver_key: run.driver_key,
          message:
            `${run.driver_key} è in coda da ${fmtMin(idle)} dopo ${run.attempts} tentativo/i ` +
            `senza essere ripreso (soglia: ${STUCK_QUEUED_MIN} min). Il dispatcher potrebbe averlo perso.`,
          suggestion: 'usa Rilancia per rimetterlo in circolo',
        })
      }
    }
    if (run.status === 'running') {
      const expired = minutesSince(run.lease_expires_at, now)
      if (expired !== null && expired > STUCK_LEASE_MIN) {
        findings.push({
          severity: 'warning',
          check: 'stuck_job',
          driver_key: run.driver_key,
          message:
            `${run.driver_key} risulta running ma il lease è scaduto da ${fmtMin(expired)} ` +
            `(soglia: ${STUCK_LEASE_MIN} min). Il worker è probabilmente morto; il reaper dovrebbe intervenire.`,
        })
      }
    }
    if (run.status === 'needs_decision') {
      const open = minutesSince(lastActivityIso(run), now)
      if (open !== null && open > OPEN_DECISION_HOURS * 60) {
        findings.push({
          severity: 'info',
          check: 'stuck_job',
          driver_key: run.driver_key,
          message:
            `${run.driver_key} attende una decisione da ${fmtHours(open)}. ` +
            'Aspetta l\'analista: nessuna azione automatica è prevista.',
        })
      }
    }

    // --- attempts_exhausted (ERROR) ----------------------------------------
    if (run.status === 'error' && run.attempts >= run.max_attempts) {
      findings.push({
        severity: 'error',
        check: 'attempts_exhausted',
        driver_key: run.driver_key,
        message:
          `${run.driver_key} è in errore con tentativi esauriti (${run.attempts}/${run.max_attempts})` +
          `${run.error ? `: ${run.error}` : ''}`,
        suggestion: 'usa Rilancia dopo aver risolto la causa',
      })
    }

    // --- score_range (ERROR) -----------------------------------------------
    for (const [field, value] of [
      ['score_absolute', run.score_absolute],
      ['score_relative', run.score_relative],
    ] as const) {
      if (value === null) continue
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        findings.push({
          severity: 'error',
          check: 'score_range',
          driver_key: run.driver_key,
          message: `${run.driver_key}: ${field} = ${value} fuori dall'intervallo [0, 100].`,
        })
      } else if (run.status !== 'done') {
        // A score on a non-done row is a leftover from a previous run being
        // shown as if it were current — exactly a silent-zero cousin.
        findings.push({
          severity: 'error',
          check: 'score_range',
          driver_key: run.driver_key,
          message:
            `${run.driver_key}: ${field} = ${value} presente ma lo stato è "${run.status}". ` +
            'Un punteggio esiste solo per un driver completato.',
        })
      }
    }

    // --- insight_flags -----------------------------------------------------
    const insight = run.llm_insight as
      | { status?: string; error?: string; hallucination_flags?: unknown }
      | null
      | undefined
    if (insight) {
      const flags = Array.isArray(insight.hallucination_flags)
        ? insight.hallucination_flags.filter((f): f is string => typeof f === 'string')
        : []
      if (flags.length > 0) {
        findings.push({
          severity: 'warning',
          check: 'insight_flags',
          driver_key: run.driver_key,
          message:
            `${run.driver_key}: l'insight LLM cita numeri non verificati sul payload: ${flags.join(', ')}.`,
          suggestion: 'verifica i numeri flaggati prima di pubblicare',
        })
      }
      if (insight.status === 'error') {
        findings.push({
          severity: 'info',
          check: 'insight_flags',
          driver_key: run.driver_key,
          message:
            `${run.driver_key}: generazione insight fallita` +
            `${typeof insight.error === 'string' ? `: ${insight.error}` : ''}`,
        })
      }
    }
  }

  // --- stale_drafts (INFO) --------------------------------------------------
  if (edits.draftCount > 0) {
    const age = minutesSince(edits.oldestDraftAt, now)
    if (age !== null && age > STALE_DRAFT_HOURS * 60) {
      findings.push({
        severity: 'info',
        check: 'stale_drafts',
        message:
          `${edits.draftCount} modifiche in bozza non pubblicate; la più vecchia risale a ${fmtHours(age)} fa. ` +
          'Save & Publish le stamperebbe e rilancerebbe i driver toccati.',
      })
    }
  }

  // --- insights_error (WARNING) --------------------------------------------
  if (analysis.v4_insights_status === 'error') {
    findings.push({
      severity: 'warning',
      check: 'insights_error',
      message:
        `la generazione insights dell'audit è in errore` +
        `${analysis.v4_insights_error ? `: ${analysis.v4_insights_error}` : ''}`,
      suggestion: 'rilancia la generazione insights dai risultati',
    })
  }

  return sortFindings(findings)
}

/** error > warning > info; within a severity, Business-first driver order —
 *  audit-level findings (no driver) lead, matching how the header reads. */
function sortFindings(findings: ControllerFinding[]): ControllerFinding[] {
  const sevRank: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 }
  const driverRank = (key?: string) =>
    key === undefined ? -1 : (getV4Driver(key)?.uiOrder ?? 99)
  return [...findings].sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      driverRank(a.driver_key) - driverRank(b.driver_key),
  )
}

/** Severity counts, the shape both routes and both UIs share. */
export function countFindings(findings: ControllerFinding[]): {
  error: number
  warning: number
  info: number
} {
  return {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  }
}
