/**
 * V4 driver — Compliance.
 *
 * Source: Semrush Site Audit, READ-ONLY (single source, no fallback).
 *
 * SCORE (Bibbia, Resolved 2026-06-22): raw = the Semrush SITE HEALTH score
 * (info.quality.value, natively 0-100). NO custom formula — the earlier
 * errors/crawled_pages ratio is superseded; it needed calibration Semrush
 * has already done.
 *
 * The issue breakdown (meta_issues + issue_details) feeds the QUALITATIVE
 * issues table only, never the score. Structured-data issues are flagged as
 * belonging to the Schema driver so the table can show ownership without
 * double-charging.
 *
 * Operationally: the USER creates the Semrush project and runs the crawl in
 * Semrush; the app only reads the latest snapshot. A domain with no project
 * (competitors, usually) is unmeasured with a reason — in V1 that returned a
 * mock and silently produced a plausible score, which is the exact bug the
 * V4 spec calls out.
 */

import { fetchSiteHealth } from '@/lib/seo-apis/semrush'
import type { SemrushSiteIssue } from '@/lib/seo-apis/types'
import type { DriverWorker, SiteRawValue } from '@/lib/v4/runner/types'
import { DriverSourceError, assertDeadline, mapPool, requireLive } from './source'

/**
 * Structured-data issues belong to the Schema driver. Semrush exposes issues
 * as free-text titles, so this is a keyword match, not a stable taxonomy:
 * flagged issues stay visible in the qualitative table, marked with their
 * owner, so the classification can be audited rather than trusted.
 */
const STRUCTURED_DATA_RE = /structured data|schema\.org|schema markup|json-?ld|microdata|rich (result|snippet)/i

export function isStructuredDataIssue(issue: SemrushSiteIssue): boolean {
  return STRUCTURED_DATA_RE.test(issue.title)
}

export interface ComplianceRaw {
  siteHealth: number
  topIssues: Array<{
    title: string
    type: SemrushSiteIssue['type']
    pages_count: number
    owned_by: 'compliance' | 'schema'
  }>
}

/**
 * Pure: raw = Site Health, issues classified for the qualitative table.
 * A missing Site Health is a hard error — the project exists but the crawl
 * has not produced a quality value, so there is nothing to score. Never 0.
 */
export function computeCompliance(
  siteHealth: number | null,
  issues: SemrushSiteIssue[],
): ComplianceRaw {
  if (siteHealth === null || !Number.isFinite(siteHealth)) {
    throw new DriverSourceError(
      'Semrush Site Audit reported no Site Health score: the crawl has not completed ' +
        '(or the project has never been crawled), so there is nothing to score',
    )
  }
  if (siteHealth < 0 || siteHealth > 100) {
    throw new DriverSourceError(
      `Semrush Site Health out of range: ${siteHealth} (expected 0-100)`,
    )
  }

  const topIssues = issues
    .slice()
    .sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0))
    .slice(0, 10)
    .map((i) => ({
      title: i.title,
      type: i.type,
      pages_count: i.pages_count,
      owned_by: (isStructuredDataIssue(i) ? 'schema' : 'compliance') as 'compliance' | 'schema',
    }))

  return { siteHealth, topIssues }
}

/**
 * Manual Semrush export uploads bound to this run (Sprint 1 item 4b).
 *
 * The files route parses the export at upload (lib/v4/semrush-export.ts) and
 * records the result on the attachment ({kind: 'compliance_semrush',
 * site_ref, parsed: {site_health, issues, ...}}); driverConfigFromSetup (or
 * the post-start merge in the files route) carries it into
 * driver_runs.config.attachments. Pure: config in, per-site map out.
 */
export function readManualSemrushUploads(
  config: Record<string, unknown> | null | undefined,
): Map<string, { site_health: number; issues: SemrushSiteIssue[]; name: string }> {
  const out = new Map<string, { site_health: number; issues: SemrushSiteIssue[]; name: string }>()
  const attachments = Array.isArray((config as { attachments?: unknown })?.attachments)
    ? ((config as { attachments: unknown[] }).attachments as Array<Record<string, unknown>>)
    : []

  for (const att of attachments) {
    if (att?.kind !== 'compliance_semrush') continue
    const siteRef = typeof att.site_ref === 'string' ? att.site_ref : 'client'
    const parsed = (att.parsed ?? null) as { site_health?: unknown; issues?: unknown } | null
    const health = Number(parsed?.site_health)
    if (!Number.isFinite(health) || health < 0 || health > 100) continue
    const issues: SemrushSiteIssue[] = Array.isArray(parsed?.issues)
      ? (parsed!.issues as Array<Record<string, unknown>>).map((i, idx) => ({
          id: String(i.id ?? idx),
          title: String(i.title ?? ''),
          type: (['error', 'warning', 'notice'].includes(String(i.type))
            ? String(i.type)
            : 'warning') as SemrushSiteIssue['type'],
          pages_count: Number(i.pages_count) || 0,
        }))
      : []
    // Later uploads win (the files route replaces per site anyway).
    out.set(siteRef, {
      site_health: health,
      issues,
      name: typeof att.name === 'string' ? att.name : 'export Semrush',
    })
  }
  return out
}

export const complianceWorker: DriverWorker = async (ctx) => {
  /** Per-domain failure reasons, so the client's own error can be told apart. */
  const errorsByDomain = new Map<string, string>()
  const manual = readManualSemrushUploads(ctx.config)

  const sites = await mapPool(ctx.sites, 2, async (site): Promise<SiteRawValue | null> => {
    // Manual export (item 4b) beats the API for that site: the analyst
    // uploaded it exactly because the API has no project for the domain.
    const upload = manual.get(site.site_ref)
    if (upload) {
      try {
        const computed = computeCompliance(upload.site_health, upload.issues)
        return {
          site_ref: site.site_ref,
          domain: site.domain,
          raw: computed.siteHealth,
          score_absolute: Math.round(computed.siteHealth),
          evidence: {
            method: 'manual_upload',
            source_file: upload.name,
            site_health: computed.siteHealth,
            top_issues: computed.topIssues,
            note:
              'score = Site Health dall’export Semrush caricato manualmente; ' +
              'issues qualitative, mai nel punteggio',
          },
        }
      } catch (err) {
        errorsByDomain.set(site.domain, err instanceof Error ? err.message : String(err))
        return null
      }
    }

    try {
      assertDeadline(ctx.deadlineAt, `Compliance for ${site.domain}`)
      // The three Semrush requests share a per-request abort coherent with
      // the job deadline (Sprint 1 item 1c): never hang past the budget.
      const timeoutMs = Math.max(
        5_000,
        Math.min(60_000, ctx.deadlineAt - Date.now() - 10_000),
      )
      const health = requireLive(
        await fetchSiteHealth(site.domain, { timeoutMs }),
        `Compliance for ${site.domain}`,
      )
      const computed = computeCompliance(health.site_health_score, health.issues)
      return {
        site_ref: site.site_ref,
        domain: site.domain,
        raw: computed.siteHealth,
        score_absolute: Math.round(computed.siteHealth),
        evidence: {
          method: 'semrush_api',
          site_health: computed.siteHealth,
          site_health_delta: health.site_health_delta,
          pages_crawled: health.pages_crawled,
          top_issues: computed.topIssues,
          note: 'score = Semrush Site Health (info.quality.value); issues are qualitative only',
          endpoint: 'semrush:management/v1/siteaudit (read-only)',
        },
      }
    } catch (err) {
      errorsByDomain.set(site.domain, err instanceof Error ? err.message : String(err))
      return null
    }
  })

  const measured = sites.filter((s): s is SiteRawValue => s !== null)
  const errors = [...errorsByDomain.entries()].map(([domain, msg]) => `${domain}: ${msg}`)

  const clientSite = ctx.sites.find((s) => s.is_client)
  const clientRef = clientSite?.site_ref
  if (!measured.some((s) => s.site_ref === clientRef)) {
    // Item 4a: the error names the CLIENT domain and the client's OWN
    // failure reason — the old message said "for the client site" while
    // quoting a competitor's error.
    const clientDomain = clientSite?.domain ?? 'sconosciuto'
    const clientReason = clientSite ? errorsByDomain.get(clientSite.domain) : undefined
    return {
      status: 'error',
      error:
        `Compliance non misurabile per il sito cliente ${clientDomain}: serve un progetto ` +
        `Semrush Site Audit per quel dominio (con un crawl completato), oppure carica ` +
        `l'export Semrush Site Audit del cliente dal setup o dalla tab Compliance. ` +
        `Dettaglio: ${clientReason ?? 'nessuna risposta dalla fonte'}`,
      rawPayload: { errors },
    }
  }

  // Item 4a: competitors without a Semrush project no longer fail the run.
  // The partial coverage is DECLARED, in the payload and in the UI.
  const missing = ctx.sites.filter((s) => !measured.some((m) => m.site_ref === s.site_ref))
  const partialNote =
    missing.length > 0
      ? `misurato ${measured.length} siti su ${ctx.sites.length}; mancano progetti Semrush per: ` +
        missing.map((s) => s.domain).join(', ')
      : null

  return {
    status: 'done',
    sites: measured,
    rawPayload: {
      source: 'semrush:site-audit',
      note:
        'Score = Site Health, read from the user-provisioned Semrush project or from a ' +
        'manually uploaded Site Audit export (the app never starts crawls). Domains without ' +
        'a project are reported as unmeasured, never scored.',
      unmeasured: missing.map((s) => s.domain),
      ...(partialNote ? { partial_note: partialNote } : {}),
      errors,
    },
  }
}
