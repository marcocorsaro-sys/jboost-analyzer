'use client'

/**
 * V4 setup wizard — the 5 exact STEPs of the UX-UI Bibbia 04, sheet
 * "New Audit (Setup)":
 *
 *   1 · Project data      (domain, brand, countries, site type, sector,
 *                          target audience, SEO maturity)
 *   2 · Competitors       (up to 4, URL + brand name each)
 *   3 · Drivers           (Business first, pre-flagged mandatory; each toggle
 *                          opens its inline config: J-Horizon recap, thematic
 *                          clusters, uploads, page templates + Import from
 *                          Speed)
 *   4 · Additional params (GA/GSC shown disabled as 'Future', words to avoid
 *                          + max insights, knowledge documents, notes)
 *   5 · Launch            (CTA enabled only with the required fields filled)
 *
 * Save draft + resume: the wizard can persist at any moment (POST creates the
 * draft, PATCH updates it while un-launched) and reopens it via ?resume=<id>.
 * The browser explains the rules; the server re-validates every one of them.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { driversInUiOrder } from '@/lib/scoring/registry'
import UrlAutocompleteInput from '@/components/v4/UrlAutocompleteInput'
import type { SitemapUrlEntry } from '@/lib/v4/url-autocomplete'
import {
  ANALYSIS_COUNTRIES,
  CLUSTERS_MAX,
  CLUSTERS_MIN,
  INDUSTRY_LABELS,
  INDUSTRY_PRESETS,
  SITE_TYPES,
  SITE_TYPE_LABELS,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  isHttpUrl,
  withMandatoryDrivers,
  type AttachmentKind,
  type IndustryPreset,
  type SetupAttachment,
} from '@/lib/v4/setup'
import { B } from '@/lib/brand'

const MAX_COMPETITORS = 4

// ---------------------------------------------------------------------------
// Shared styles (same palette as the rest of the V4 components)
// ---------------------------------------------------------------------------

/** Tall input: 48px total height (12+16+12+2 borders), 16px text. */
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: B.bg,
  border: `1px solid ${B.border}`,
  borderRadius: B.radius.input,
  color: B.ink,
  fontSize: '16px',
  lineHeight: 1.4,
  outline: 'none',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  ...B.type.label,
  display: 'block',
  color: B.muted,
  marginBottom: '8px',
}

const sectionStyle: React.CSSProperties = {
  background: B.bg,
  borderRadius: B.radius.card,
  border: `1px solid ${B.border}`,
  padding: '32px',
  boxShadow: B.shadow.card,
}

const sectionTitleStyle: React.CSSProperties = {
  ...B.type.h2,
  color: B.ink,
  marginBottom: '6px',
}

const hintStyle: React.CSSProperties = { fontSize: '15px', color: B.muted, lineHeight: 1.5, marginBottom: '24px' }
const smallHint: React.CSSProperties = { fontSize: '14px', color: B.muted, lineHeight: 1.5, marginTop: '8px' }

const ghostButton: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${B.border}`,
  borderRadius: B.radius.control,
  color: B.muted,
  padding: '10px 16px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: B.transition,
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  background: B.primarySoft,
  border: `1px solid ${B.primary}22`,
  borderRadius: '999px',
  fontSize: '13px',
  fontWeight: 600,
  color: B.primary,
}

interface CompetitorRow {
  domain: string
  brandName: string
}

/** The saved draft, reshaped for the wizard (built server-side on ?resume). */
export interface WizardInitial {
  analysisId: string
  clientDomain: string
  clientBrand: string
  brandVariants: string
  countries: string[]
  outputLanguage: 'it' | 'en'
  siteType: string
  industryPreset: string
  sector: string
  targetAudienceMode: string
  targetAudience: string
  seoMaturity: string
  competitors: CompetitorRow[]
  enabledDrivers: string[]
  jhorizonAnswer: string
  thematicClusters: string[]
  blocklist: string[]
  maxInsights: number | null
  additionalNotes: string
  driverTemplates: Record<string, string[]>
  templates: Record<string, Record<string, string>>
  attachments: SetupAttachment[]
}

function bareDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

// ---------------------------------------------------------------------------
// Input normalization + inline validation (every domain/URL field of the
// wizard normalizes on blur and explains what is wrong, in place)
// ---------------------------------------------------------------------------

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

/** Non-empty input that does not normalize to a plausible domain. */
function domainInvalid(raw: string): boolean {
  return raw.trim() !== '' && !DOMAIN_RE.test(bareDomain(raw))
}

/**
 * URL normalization on blur: strip spaces, add https:// when missing,
 * lowercase the host, drop the trailing slash of a bare origin. The PATH is
 * left untouched (paths can be case-sensitive).
 */
function normalizeUrlInput(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, '')
  if (!compact) return ''
  const withProto = /^https?:\/\//i.test(compact) ? compact : `https://${compact}`
  try {
    const u = new URL(withProto)
    u.hostname = u.hostname.toLowerCase()
    let s = u.toString()
    if (u.pathname === '/' && !u.search && !u.hash) s = s.replace(/\/$/, '')
    return s
  } catch {
    return compact
  }
}

/** Non-empty input that is not a valid http(s) URL. */
function urlInvalid(raw: string): boolean {
  return raw.trim() !== '' && !isHttpUrl(raw.trim())
}

/** 'zalando.com' -> 'Zalando' — competitor brand-name suggestion. */
function brandFromDomain(raw: string): string {
  const root = bareDomain(raw).split('.')[0] ?? ''
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : ''
}

const invalidInputStyle: React.CSSProperties = { ...inputStyle, border: `1px solid ${B.error}` }
const fieldErrorStyle: React.CSSProperties = { fontSize: '14px', color: B.error, marginTop: '4px' }

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------

/** Tag input: type, Enter/comma adds a chip; chips are removable. */
function ChipInput({
  values,
  onChange,
  placeholder,
  removeLabel,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  removeLabel: string
}) {
  const [text, setText] = useState('')

  const commit = () => {
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) return
    const next = [...values]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setText('')
  }

  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {values.map((v) => (
            <span key={v} style={chipStyle}>
              {v}
              <button
                type="button"
                aria-label={`${removeLabel} ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                style={{ background: 'none', border: 'none', color: B.muted, cursor: 'pointer', padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        style={inputStyle}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
      />
    </div>
  )
}

export default function SetupWizard({
  clientId,
  initialDraft,
}: {
  clientId?: string | null
  initialDraft?: WizardInitial | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const drivers = useMemo(() => driversInUiOrder(), [])
  const d = initialDraft

  // ---- persistence ----
  const [analysisId, setAnalysisId] = useState<string | null>(d?.analysisId ?? null)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  // ---- STEP 1 · Project data ----
  const [clientDomain, setClientDomain] = useState(d?.clientDomain ?? '')
  const [clientBrand, setClientBrand] = useState(d?.clientBrand ?? '')
  const [brandVariants, setBrandVariants] = useState(d?.brandVariants ?? '')
  const [countries, setCountries] = useState<string[]>(d?.countries ?? ['IT'])
  const [outputLanguage, setOutputLanguage] = useState<'it' | 'en'>(d?.outputLanguage ?? 'it')
  const [siteType, setSiteType] = useState(d?.siteType ?? '')
  const [industryPreset, setIndustryPreset] = useState<IndustryPreset | ''>(
    (d?.industryPreset as IndustryPreset | '') ?? '',
  )
  const [sector, setSector] = useState(d?.sector ?? '')
  const [targetAudienceMode, setTargetAudienceMode] = useState(d?.targetAudienceMode ?? '')
  const [targetAudience, setTargetAudience] = useState(d?.targetAudience ?? '')
  const [seoMaturity, setSeoMaturity] = useState(d?.seoMaturity ?? '')

  // ---- STEP 2 · Competitors ----
  const [competitors, setCompetitors] = useState<CompetitorRow[]>(
    d?.competitors && d.competitors.length > 0 ? d.competitors : [{ domain: '', brandName: '' }],
  )

  // ---- STEP 3 · Drivers ----
  // Business drivers are pre-flagged and NOT stored here: they are always on.
  const [devEnabled, setDevEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      drivers
        .filter((dr) => dr.family === 'development')
        .map((dr) => [dr.key, d ? d.enabledDrivers.includes(dr.key) : false]),
    ),
  )
  const [jhorizonAnswer, setJhorizonAnswer] = useState(d?.jhorizonAnswer ?? '')
  const [clusters, setClusters] = useState<string[]>(d?.thematicClusters ?? [])
  const [driverTemplates, setDriverTemplates] = useState<Record<string, string[]>>(
    d?.driverTemplates ?? {},
  )
  // site_ref -> template_key -> url (shared across the page drivers)
  const [templates, setTemplates] = useState<Record<string, Record<string, string>>>(
    d?.templates ?? {},
  )
  const [showSiteUrls, setShowSiteUrls] = useState(false)
  const [attachments, setAttachments] = useState<SetupAttachment[]>(d?.attachments ?? [])
  const [uploading, setUploading] = useState<AttachmentKind | null>(null)

  // ---- STEP 4 · Additional parameters ----
  const [blocklist, setBlocklist] = useState<string[]>(d?.blocklist ?? [])
  const [maxInsights, setMaxInsights] = useState(d?.maxInsights ? String(d.maxInsights) : '')
  const [additionalNotes, setAdditionalNotes] = useState(d?.additionalNotes ?? '')

  // ---- derived ----
  const filledCompetitors = competitors.filter((c) => bareDomain(c.domain))
  const hasCompetitor = filledCompetitors.length > 0

  const sites = useMemo(() => {
    const out: Array<{ site_ref: string; domain: string; label: string }> = []
    const cd = bareDomain(clientDomain)
    if (cd) out.push({ site_ref: 'client', domain: cd, label: `${t('v4setup.client_site')} · ${cd}` })
    filledCompetitors.slice(0, MAX_COMPETITORS).forEach((c, i) => {
      out.push({
        site_ref: `competitor_${i + 1}`,
        domain: bareDomain(c.domain),
        label: `Competitor ${i + 1} · ${bareDomain(c.domain)}`,
      })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientDomain, competitors])

  const selectedDrivers = withMandatoryDrivers(
    drivers.filter((dr) => dr.family === 'development' && devEnabled[dr.key]).map((dr) => dr.key),
  )

  const maxInsightsNum = maxInsights.trim() === '' ? null : Number(maxInsights)

  /** Required-at-launch checklist (mirror of lib/v4/setup — server re-checks). */
  const missing: string[] = []
  if (!bareDomain(clientDomain)) missing.push(t('v4setup.req_domain'))
  if (!clientBrand.trim()) missing.push(t('v4setup.req_brand'))
  if (countries.length === 0) missing.push(t('v4setup.req_country'))
  if (!siteType) missing.push(t('v4setup.req_site_type'))
  if (!hasCompetitor) missing.push(t('v4setup.req_competitor'))
  if (filledCompetitors.some((c) => !c.brandName.trim())) missing.push(t('v4setup.req_competitor_brand'))
  if (clusters.length > 0 && (clusters.length < CLUSTERS_MIN || clusters.length > CLUSTERS_MAX)) {
    missing.push(t('v4setup.req_clusters'))
  }
  if (maxInsightsNum !== null && (!Number.isInteger(maxInsightsNum) || maxInsightsNum <= 0)) {
    missing.push(t('v4setup.req_max_insights'))
  }
  const canLaunch = missing.length === 0 && !saving && !launching
  const canSaveDraft = Boolean(bareDomain(clientDomain)) && !saving && !launching

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  const buildBody = (mode: 'draft' | 'launch') => ({
    clientId: clientId ?? null,
    client: {
      domain: clientDomain,
      brandName: clientBrand || null,
      brandVariants: brandVariants.split(',').map((v) => v.trim()).filter(Boolean),
    },
    competitors: filledCompetitors.slice(0, MAX_COMPETITORS).map((c) => ({
      domain: c.domain,
      brandName: c.brandName || null,
    })),
    country: countries[0] ?? 'IT',
    countries,
    outputLanguage,
    industryPreset: industryPreset || null,
    sector: sector || null,
    siteType: siteType || null,
    targetAudienceMode: targetAudienceMode || null,
    targetAudience: targetAudience || null,
    seoMaturity: seoMaturity || null,
    drivers: selectedDrivers,
    templates,
    driverTemplates,
    jhorizonAnswer: jhorizonAnswer || null,
    thematicClusters: clusters,
    blocklist,
    maxInsights: maxInsightsNum,
    additionalNotes: additionalNotes || null,
    mode,
  })

  /** POST creates the draft, PATCH updates it. Returns the id, or null. */
  const persist = async (mode: 'draft' | 'launch'): Promise<string | null> => {
    const res = await fetch(analysisId ? `/api/v4/analyses/${analysisId}` : '/api/v4/analyses', {
      method: analysisId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(mode)),
    })
    const data = await res.json()
    if (!res.ok) {
      setErrors(Array.isArray(data.details) ? data.details : [data.error ?? t('v4setup.err_unknown')])
      return null
    }
    const id = (data.analysisId as string) ?? analysisId
    setAnalysisId(id)
    return id
  }

  const saveDraft = async (): Promise<string | null> => {
    setSaving(true)
    setErrors([])
    try {
      const id = await persist('draft')
      if (id) setSavedAt(new Date().toLocaleTimeString())
      return id
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t('v4setup.err_network')])
      return null
    } finally {
      setSaving(false)
    }
  }

  const launch = async () => {
    setLaunching(true)
    setErrors([])
    try {
      const id = await persist('launch')
      if (!id) return

      const startRes = await fetch(`/api/v4/analyses/${id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drivers: selectedDrivers }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) {
        // The setup is saved; the run did not start. Say exactly that.
        setErrors([
          `${t('v4setup.err_start_failed')} (${id}): ${
            Array.isArray(startData.details) ? startData.details.join(' | ') : startData.error
          }`,
        ])
        return
      }
      router.push(`/results/v4/${id}`)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t('v4setup.err_network')])
    } finally {
      setLaunching(false)
    }
  }

  // ---------------------------------------------------------------------
  // Uploads (references only — parsing is downstream)
  // ---------------------------------------------------------------------

  const uploadFile = async (kind: AttachmentKind, file: File) => {
    setErrors([])
    setUploading(kind)
    try {
      // Uploads hang off the analysis row: make sure the draft exists first.
      const id = analysisId ?? (await saveDraft())
      if (!id) return
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', file)
      const res = await fetch(`/api/v4/analyses/${id}/files`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setErrors([data.error ?? t('v4setup.err_upload')])
        return
      }
      setAttachments(data.attachments as SetupAttachment[])
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t('v4setup.err_upload')])
    } finally {
      setUploading(null)
    }
  }

  const removeFile = async (path: string) => {
    if (!analysisId) return
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await res.json()
      if (res.ok) setAttachments(data.attachments as SetupAttachment[])
      else setErrors([data.error ?? t('v4setup.err_upload')])
    } catch (err) {
      setErrors([err instanceof Error ? err.message : t('v4setup.err_upload')])
    }
  }

  // ---------------------------------------------------------------------
  // "Suggerisci con AI" — POST /api/v4/analyses/suggest (Firecrawl + Sonnet,
  // adapted from the V1 pre-sales intake). Every suggestion is a PREFILL of
  // EMPTY fields only: what the analyst already typed always wins, and
  // nothing is saved until they save/launch themselves.
  // ---------------------------------------------------------------------

  const [suggesting, setSuggesting] = useState(false)
  const [suggestNote, setSuggestNote] = useState<string | null>(null)
  const [suggestWarnings, setSuggestWarnings] = useState<string[]>([])

  const suggestWithAi = async () => {
    const domain = bareDomain(clientDomain)
    if (!domain || !DOMAIN_RE.test(domain)) {
      setSuggestNote(t('v4setup.ai_suggest_needs_domain'))
      return
    }
    setSuggesting(true)
    setSuggestNote(null)
    setSuggestWarnings([])
    try {
      const res = await fetch('/api/v4/analyses/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, country: countries[0] ?? null }),
      })
      const data = (await res.json()) as {
        error?: string
        brandName?: string | null
        brandVariants?: string[]
        siteType?: string | null
        industryPreset?: string | null
        sector?: string | null
        competitors?: Array<{ domain?: string; brandName?: string }>
        thematicClusters?: string[]
        templateUrls?: Record<string, string>
        warnings?: string[]
      }
      if (!res.ok) {
        setSuggestNote(`${t('v4setup.ai_suggest_failed')}: ${data.error ?? res.status}`)
        return
      }

      if (!clientBrand.trim() && data.brandName) setClientBrand(data.brandName)
      if (!brandVariants.trim() && (data.brandVariants?.length ?? 0) > 0) {
        setBrandVariants(data.brandVariants!.join(', '))
      }
      if (!siteType && data.siteType) setSiteType(data.siteType)
      if (!industryPreset && data.industryPreset) setIndustryPreset(data.industryPreset as IndustryPreset)
      if (!sector.trim() && data.sector) setSector(data.sector)

      if ((data.competitors?.length ?? 0) > 0) {
        setCompetitors((prev) => {
          const kept = prev.filter((c) => bareDomain(c.domain))
          const have = new Set(kept.map((c) => bareDomain(c.domain)))
          const merged = [...kept]
          for (const s of data.competitors!) {
            if (merged.length >= MAX_COMPETITORS) break
            const d = bareDomain(String(s.domain ?? ''))
            if (!d || d === domain || have.has(d)) continue
            have.add(d)
            merged.push({ domain: d, brandName: String(s.brandName ?? '') || brandFromDomain(d) })
          }
          return merged.length > 0 ? merged : prev
        })
      }

      if (clusters.length === 0 && (data.thematicClusters?.length ?? 0) > 0) {
        setClusters(data.thematicClusters!.map(String))
      }

      // Template example URLs come from the site's own sitemap (never
      // invented — Block 3). Fill only the client slots still empty, and flag
      // the templates on the four page drivers ONLY when the analyst has not
      // flagged anything yet (equivalent to the historical "every page driver
      // applies" default — and it makes the prefilled fields visible).
      const urls = data.templateUrls ?? {}
      const suggestedKeys = Object.keys(urls)
      if (suggestedKeys.length > 0) {
        setTemplates((prev) => {
          const client = { ...(prev.client ?? {}) }
          for (const [key, url] of Object.entries(urls)) {
            if (!client[key] && typeof url === 'string') client[key] = url
          }
          return { ...prev, client }
        })
        setDriverTemplates((prev) => {
          const anyFlag = Object.values(prev).some((arr) => (arr ?? []).length > 0)
          if (anyFlag) return prev
          const withHome = [...new Set(['homepage', ...suggestedKeys])]
          return { ...prev, speed: withHome, accessibility: withHome, schema: withHome, content: withHome }
        })
      }

      setSuggestWarnings((data.warnings ?? []).map(String))
      setSuggestNote(t('v4setup.ai_suggest_done'))
    } catch (err) {
      setSuggestNote(
        `${t('v4setup.ai_suggest_failed')}: ${err instanceof Error ? err.message : t('v4setup.err_network')}`,
      )
    } finally {
      setSuggesting(false)
    }
  }

  // ---------------------------------------------------------------------
  // Step-3 helpers
  // ---------------------------------------------------------------------

  // Sitemap URLs for the template-URL autocomplete, memoized PER DOMAIN at
  // wizard level: the promise goes into the cache before the first await, so
  // 9 template fields focusing on the same site still cost 1 network fetch.
  // A failed fetch is evicted (a later focus can retry); an empty sitemap is
  // a valid, cached answer.
  const sitemapCache = useRef(new Map<string, Promise<SitemapUrlEntry[]>>())
  const fetchSitemapFor = useCallback((domain: string): Promise<SitemapUrlEntry[]> => {
    const cached = sitemapCache.current.get(domain)
    if (cached) return cached
    const promise = fetch(`/api/v4/analyses/sitemap-urls?domain=${encodeURIComponent(domain)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`sitemap-urls ${res.status}`)
        const data = (await res.json()) as { urls?: SitemapUrlEntry[] }
        return Array.isArray(data.urls) ? data.urls : []
      })
      .catch((err: unknown) => {
        sitemapCache.current.delete(domain)
        throw err
      })
    sitemapCache.current.set(domain, promise)
    return promise
  }, [])

  const setTemplateUrl = (siteRef: string, key: string, value: string) => {
    setTemplates((prev) => ({ ...prev, [siteRef]: { ...(prev[siteRef] ?? {}), [key]: value } }))
  }

  const toggleDriverTemplate = (driverKey: string, templateKey: string) => {
    setDriverTemplates((prev) => {
      const cur = prev[driverKey] ?? []
      const next = cur.includes(templateKey) ? cur.filter((k) => k !== templateKey) : [...cur, templateKey]
      return { ...prev, [driverKey]: next }
    })
  }

  /** "Import from Speed": copy Speed's flagged templates into this driver
   *  (the example URLs are shared, so only the flags need copying). */
  const importFromSpeed = (driverKey: string) => {
    setDriverTemplates((prev) => ({
      ...prev,
      [driverKey]: [...new Set([...(prev[driverKey] ?? []), ...(prev.speed ?? [])])],
    }))
  }

  const attachmentsOf = (kind: AttachmentKind) => attachments.filter((a) => a.kind === kind)

  // ---------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------

  const stepLabels: TranslationKey[] = [
    'v4setup.step1',
    'v4setup.step2',
    'v4setup.step3',
    'v4setup.step4',
    'v4setup.step5',
  ]

  const uploadBlock = (kind: AttachmentKind, label: string, accept: string, hint: string) => (
    <div style={{ marginTop: '12px' }}>
      <label style={labelStyle}>{label}</label>
      {attachmentsOf(kind).map((a) => (
        <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span style={chipStyle}>{a.name}</span>
          <button
            type="button"
            onClick={() => removeFile(a.path)}
            style={{ ...ghostButton, padding: '2px 10px', fontSize: '14px' }}
          >
            {t('v4setup.remove')}
          </button>
        </div>
      ))}
      <input
        type="file"
        accept={accept}
        disabled={uploading !== null}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void uploadFile(kind, file)
          e.target.value = ''
        }}
        style={{ fontSize: '15px', color: B.muted }}
      />
      <div style={smallHint}>
        {uploading === kind ? t('v4setup.uploading') : hint} {t('v4setup.upload_parse_note')}
      </div>
    </div>
  )

  const templateSelector = (driverKey: string, withImport: boolean) => {
    const selected = driverTemplates[driverKey] ?? []
    return (
      <div style={{ marginTop: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>{t('v4setup.templates_label')}</label>
          {withImport && (
            <button
              type="button"
              onClick={() => importFromSpeed(driverKey)}
              disabled={(driverTemplates.speed ?? []).length === 0}
              style={{
                ...ghostButton,
                padding: '4px 12px',
                fontSize: '14px',
                opacity: (driverTemplates.speed ?? []).length === 0 ? 0.5 : 1,
              }}
              title={t('v4setup.import_from_speed_hint')}
            >
              {t('v4setup.import_from_speed')}
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
          {TEMPLATE_KEYS.map((key) => (
            <label
              key={key}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: B.ink, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={() => toggleDriverTemplate(driverKey, key)}
              />
              {TEMPLATE_LABELS[key]}
            </label>
          ))}
        </div>
        {/* 1 example URL per flagged template (client site). */}
        {selected.length > 0 && bareDomain(clientDomain) && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {TEMPLATE_KEYS.filter((k) => selected.includes(k)).map((key) => (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: B.muted }}>{TEMPLATE_LABELS[key]}</span>
                <div>
                  <UrlAutocompleteInput
                    value={templates.client?.[key] ?? ''}
                    invalid={urlInvalid(templates.client?.[key] ?? '')}
                    onChange={(v) => setTemplateUrl('client', key, v)}
                    onCommit={(v) => setTemplateUrl('client', key, normalizeUrlInput(v))}
                    domain={bareDomain(clientDomain)}
                    templateKey={key}
                    fetchSitemapFor={fetchSitemapFor}
                    placeholder={
                      key === 'homepage'
                        ? `https://${bareDomain(clientDomain)} (default)`
                        : t('v4setup.template_url_placeholder')
                    }
                  />
                  {urlInvalid(templates.client?.[key] ?? '') && (
                    <div style={fieldErrorStyle}>{t('v4setup.invalid_url')}</div>
                  )}
                </div>
              </div>
            ))}
            <div style={smallHint}>{t('v4setup.template_urls_shared')}</div>
          </div>
        )}
      </div>
    )
  }

  const driverConfigBlock = (key: string) => {
    switch (key) {
      case 'ai_visibility':
        return (
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>{t('v4setup.jhorizon_label')}</label>
            <textarea
              style={{ ...inputStyle, minHeight: '110px', resize: 'vertical' }}
              value={jhorizonAnswer}
              onChange={(e) => setJhorizonAnswer(e.target.value)}
              placeholder={t('v4setup.jhorizon_placeholder')}
            />
            <div style={smallHint}>{t('v4setup.jhorizon_hint')}</div>
          </div>
        )
      case 'discoverability':
        return (
          <div style={{ marginTop: '12px' }}>
            <label style={labelStyle}>
              {t('v4setup.clusters_label')} ({CLUSTERS_MIN}-{CLUSTERS_MAX})
            </label>
            <ChipInput
              values={clusters}
              onChange={setClusters}
              placeholder={t('v4setup.clusters_placeholder')}
              removeLabel={t('v4setup.remove')}
            />
            <div style={smallHint}>{t('v4setup.clusters_hint')}</div>
            {clusters.length > 0 && (clusters.length < CLUSTERS_MIN || clusters.length > CLUSTERS_MAX) && (
              <div style={{ fontSize: '14px', color: B.warning, marginTop: '4px' }}>
                {t('v4setup.req_clusters')}
              </div>
            )}
          </div>
        )
      case 'compliance':
        return uploadBlock(
          'compliance_crawl',
          t('v4setup.crawl_upload_label'),
          '.csv,.xlsx,.xls',
          t('v4setup.crawl_upload_hint'),
        )
      case 'authority':
        return uploadBlock(
          'authority_backlinks',
          t('v4setup.backlink_upload_label'),
          '.csv,.xlsx,.xls',
          t('v4setup.backlink_upload_hint'),
        )
      case 'schema':
        return templateSelector('schema', true)
      case 'speed':
        return templateSelector('speed', false)
      case 'accessibility':
        return templateSelector('accessibility', true)
      case 'content':
        return (
          <>
            {templateSelector('content', true)}
            <div style={smallHint}>{t('v4setup.content_questionnaire_note')}</div>
          </>
        )
      default:
        return null
    }
  }

  // ---------------------------------------------------------------------
  // The five steps
  // ---------------------------------------------------------------------

  const step1 = (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>1 · {t('v4setup.step1')}</h2>
      <p style={hintStyle}>{t('v4setup.step1_hint')}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={labelStyle}>{t('v4setup.domain')} *</label>
          <input
            style={domainInvalid(clientDomain) ? invalidInputStyle : inputStyle}
            value={clientDomain}
            onChange={(e) => setClientDomain(e.target.value)}
            onBlur={() => setClientDomain((v) => (v.trim() ? bareDomain(v) : v))}
            placeholder="es. benetton.com"
          />
          {domainInvalid(clientDomain) && <div style={fieldErrorStyle}>{t('v4setup.invalid_domain')}</div>}
        </div>
        <div>
          <label style={labelStyle}>{t('v4setup.brand_name')} *</label>
          <input
            style={inputStyle}
            value={clientBrand}
            onChange={(e) => setClientBrand(e.target.value)}
            placeholder="es. Benetton"
          />
        </div>
      </div>

      {/* AI-assisted prefill: fills the EMPTY fields of the whole wizard
          (brand, site type, sector, competitors, clusters, template URLs).
          Everything stays editable; nothing is saved on its own. */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void suggestWithAi()}
          disabled={suggesting}
          style={{
            ...ghostButton,
            borderColor: `${B.primary}40`,
            color: suggesting ? B.muted : B.primary,
          }}
        >
          {suggesting ? `↻ ${t('v4setup.ai_suggesting')}` : `✨ ${t('v4setup.ai_suggest')}`}
        </button>
        <span style={{ fontSize: '14px', color: B.muted, flex: 1, minWidth: '260px' }}>
          {t('v4setup.ai_suggest_hint')}
        </span>
      </div>
      {suggestNote && <div style={{ marginTop: '8px', fontSize: '14px', color: B.primary }}>{suggestNote}</div>}
      {suggestWarnings.length > 0 && (
        <div style={{ marginTop: '4px', fontSize: '14px', color: B.warning }}>{suggestWarnings.join(' · ')}</div>
      )}

      <div style={{ marginTop: '16px' }}>
        <label style={labelStyle}>{t('v4setup.brand_variants')}</label>
        <input
          style={inputStyle}
          value={brandVariants}
          onChange={(e) => setBrandVariants(e.target.value)}
          placeholder="united colors of benetton, benetton group"
        />
        <div style={smallHint}>{t('v4setup.brand_variants_hint')}</div>
      </div>

      <div style={{ marginTop: '16px' }}>
        <label style={labelStyle}>{t('v4setup.countries')} *</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
          {ANALYSIS_COUNTRIES.map((c) => (
            <label
              key={c.code}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: B.ink, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={countries.includes(c.code)}
                onChange={() =>
                  setCountries((prev) =>
                    prev.includes(c.code) ? prev.filter((x) => x !== c.code) : [...prev, c.code],
                  )
                }
              />
              {c.code} · {c.label}
            </label>
          ))}
        </div>
        <div style={smallHint}>{t('v4setup.countries_hint')}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
        <div>
          <label style={labelStyle}>{t('v4setup.site_type')} *</label>
          <select style={inputStyle} value={siteType} onChange={(e) => setSiteType(e.target.value)}>
            <option value="">—</option>
            {SITE_TYPES.map((s) => (
              <option key={s} value={s}>
                {SITE_TYPE_LABELS[s]}
              </option>
            ))}
          </select>
          <div style={smallHint}>{t('v4setup.site_type_hint')}</div>
        </div>
        <div>
          <label style={labelStyle}>{t('v4setup.sector')}</label>
          <select
            style={{ ...inputStyle, marginBottom: '8px' }}
            value={industryPreset}
            onChange={(e) => setIndustryPreset(e.target.value as IndustryPreset | '')}
          >
            <option value="">—</option>
            {INDUSTRY_PRESETS.map((p) => (
              <option key={p} value={p}>
                {INDUSTRY_LABELS[p]}
              </option>
            ))}
          </select>
          <input
            style={inputStyle}
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder={t('v4setup.sector_free_placeholder')}
          />
          <div style={smallHint}>{t('v4setup.sector_hint')}</div>
        </div>
        <div>
          <label style={labelStyle}>{t('v4setup.seo_maturity')}</label>
          <select style={inputStyle} value={seoMaturity} onChange={(e) => setSeoMaturity(e.target.value)}>
            <option value="">—</option>
            <option value="low">{t('v4setup.maturity_low')}</option>
            <option value="medium">{t('v4setup.maturity_medium')}</option>
            <option value="high">{t('v4setup.maturity_high')}</option>
          </select>
          <div style={smallHint}>{t('v4setup.seo_maturity_hint')}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
        <div>
          <label style={labelStyle}>{t('v4setup.target_audience')}</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            {(['b2b', 'b2c', 'both'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTargetAudienceMode(targetAudienceMode === m ? '' : m)}
                style={{
                  ...ghostButton,
                  padding: '6px 14px',
                  fontSize: '14px',
                  color: targetAudienceMode === m ? B.bg : B.muted,
                  background: targetAudienceMode === m ? B.primary : 'transparent',
                  fontWeight: targetAudienceMode === m ? 700 : 400,
                }}
              >
                {m === 'both' ? t('v4setup.audience_both') : m.toUpperCase()}
              </button>
            ))}
          </div>
          <input
            style={inputStyle}
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder={t('v4setup.target_audience_placeholder')}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('v4setup.output_language')}</label>
          <select
            style={inputStyle}
            value={outputLanguage}
            onChange={(e) => setOutputLanguage(e.target.value as 'it' | 'en')}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
    </section>
  )

  const step2 = (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>2 · {t('v4setup.step2')}</h2>
      <p style={hintStyle}>{t('v4setup.step2_hint')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {competitors.map((c, i) => (
          <div key={i}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 40px', gap: '12px' }}>
              <input
                style={domainInvalid(c.domain) ? invalidInputStyle : inputStyle}
                value={c.domain}
                onChange={(e) => {
                  const next = [...competitors]
                  next[i] = { ...next[i], domain: e.target.value }
                  setCompetitors(next)
                }}
                onBlur={() => {
                  // Normalize the domain and, when the brand is still empty,
                  // suggest it from the domain ('zalando.com' -> 'Zalando').
                  const next = [...competitors]
                  const nd = next[i].domain.trim() ? bareDomain(next[i].domain) : next[i].domain
                  const nb =
                    next[i].brandName.trim() === '' && nd && DOMAIN_RE.test(nd)
                      ? brandFromDomain(nd)
                      : next[i].brandName
                  next[i] = { domain: nd, brandName: nb }
                  setCompetitors(next)
                }}
                placeholder={`${t('v4setup.competitor_domain')} ${i + 1}`}
              />
              <input
                style={inputStyle}
                value={c.brandName}
                onChange={(e) => {
                  const next = [...competitors]
                  next[i] = { ...next[i], brandName: e.target.value }
                  setCompetitors(next)
                }}
                placeholder={`${t('v4setup.competitor_brand')} *`}
              />
              <button
                type="button"
                onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}
                style={{
                  background: 'transparent',
                  border: `1px solid ${B.border}`,
                  borderRadius: '8px',
                  color: B.muted,
                  cursor: 'pointer',
                }}
                aria-label={`${t('v4setup.remove')} competitor ${i + 1}`}
              >
                ×
              </button>
            </div>
            {domainInvalid(c.domain) && <div style={fieldErrorStyle}>{t('v4setup.invalid_domain')}</div>}
          </div>
        ))}
      </div>

      {competitors.length < MAX_COMPETITORS && (
        <button
          type="button"
          onClick={() => setCompetitors([...competitors, { domain: '', brandName: '' }])}
          style={{ ...ghostButton, marginTop: '12px', border: `1px dashed ${B.border}` }}
        >
          + {t('v4setup.add_competitor')}
        </button>
      )}
    </section>
  )

  const step3 = (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>3 · {t('v4setup.step3')}</h2>
      <p style={hintStyle}>{t('v4setup.step3_hint')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {drivers.map((dr) => {
          const isBusiness = dr.family === 'business'
          const enabled = isBusiness || Boolean(devEnabled[dr.key])
          return (
            <div
              key={dr.key}
              style={{
                padding: '12px 14px',
                background: B.bg,
                border: `1px solid ${enabled ? `${B.primary}40` : B.border}`,
                borderRadius: '8px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  cursor: isBusiness ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={isBusiness}
                  onChange={(e) => setDevEnabled({ ...devEnabled, [dr.key]: e.target.checked })}
                  style={{ marginTop: '3px' }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '16px', color: B.ink }}>
                    {dr.label}
                    {isBusiness && (
                      <span
                        style={{
                          marginLeft: '10px',
                          fontSize: '13px',
                          fontWeight: 600,
                          color: B.primary,
                          background: B.primarySoft,
                          borderRadius: B.radius.pill,
                          padding: '4px 10px',
                        }}
                      >
                        {t('v4setup.mandatory_badge')}
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', fontSize: '14px', color: B.muted }}>
                    {isBusiness ? 'Business' : 'Development'} · {t('v4setup.data_source')}: {dr.source}
                  </span>
                  {isBusiness && !hasCompetitor && (
                    <span style={{ display: 'block', fontSize: '14px', color: B.warning, marginTop: '4px' }}>
                      {t('v4setup.needs_competitor')}
                    </span>
                  )}
                </span>
              </label>
              {enabled && driverConfigBlock(dr.key)}
            </div>
          )
        })}
      </div>

      {/* Advanced: per-competitor template URLs (the comparison measures the
          same pages on every site; competitor URLs default to the homepage). */}
      {sites.length > 1 && (
        <div style={{ marginTop: '18px' }}>
          <button type="button" onClick={() => setShowSiteUrls(!showSiteUrls)} style={ghostButton}>
            {showSiteUrls ? t('v4setup.hide') : t('v4setup.competitor_urls')} ({sites.length - 1})
          </button>
          {showSiteUrls && (
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {sites
                .filter((s) => s.site_ref !== 'client')
                .map((site) => (
                  <div key={site.site_ref}>
                    <div
                      style={{
                        fontSize: '16px',
                        fontWeight: 650,
                        color: B.primary,
                        marginBottom: '10px',
                      }}
                    >
                      {site.label}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {TEMPLATE_KEYS.map((key) => (
                        <div
                          key={key}
                          style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px', alignItems: 'center' }}
                        >
                          <span style={{ fontSize: '14px', color: B.muted }}>{TEMPLATE_LABELS[key]}</span>
                          <div>
                            <UrlAutocompleteInput
                              value={templates[site.site_ref]?.[key] ?? ''}
                              invalid={urlInvalid(templates[site.site_ref]?.[key] ?? '')}
                              onChange={(v) => setTemplateUrl(site.site_ref, key, v)}
                              onCommit={(v) => setTemplateUrl(site.site_ref, key, normalizeUrlInput(v))}
                              domain={site.domain}
                              templateKey={key}
                              fetchSitemapFor={fetchSitemapFor}
                              placeholder={
                                key === 'homepage'
                                  ? `https://${site.domain} (default)`
                                  : t('v4setup.template_url_placeholder')
                              }
                            />
                            {urlInvalid(templates[site.site_ref]?.[key] ?? '') && (
                              <div style={fieldErrorStyle}>{t('v4setup.invalid_url')}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </section>
  )

  const step4 = (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>4 · {t('v4setup.step4')}</h2>
      <p style={hintStyle}>{t('v4setup.step4_hint')}</p>

      {/* GA / GSC — shown, disabled, labelled Future (field #21). */}
      <div
        style={{
          padding: '12px 14px',
          background: B.bg,
          border: `1px dashed ${B.border}`,
          borderRadius: '8px',
          opacity: 0.6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px', color: B.ink }}>{t('v4setup.ga_gsc')}</span>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '999px',
              background: `${B.muted}20`,
              color: B.muted,
            }}
          >
            {t('v4setup.future_badge')}
          </span>
        </div>
        <div style={smallHint}>{t('v4setup.ga_gsc_hint')}</div>
        <button type="button" disabled style={{ ...ghostButton, marginTop: '8px', cursor: 'not-allowed', opacity: 0.5 }}>
          {t('v4setup.connect')}
        </button>
      </div>

      {/* Words to avoid + max insights (field #22). */}
      <div style={{ marginTop: '18px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        <div>
          <label style={labelStyle}>{t('v4setup.blocklist')}</label>
          <ChipInput
            values={blocklist}
            onChange={setBlocklist}
            placeholder={t('v4setup.blocklist_placeholder')}
            removeLabel={t('v4setup.remove')}
          />
          <div style={smallHint}>{t('v4setup.blocklist_hint')}</div>
        </div>
        <div>
          <label style={labelStyle}>{t('v4setup.max_insights')}</label>
          <input
            style={inputStyle}
            type="number"
            min={1}
            step={1}
            value={maxInsights}
            onChange={(e) => setMaxInsights(e.target.value)}
            placeholder="es. 3"
          />
          <div style={smallHint}>{t('v4setup.max_insights_hint')}</div>
        </div>
      </div>

      {/* Knowledge documents (field #23). */}
      <div style={{ marginTop: '18px' }}>
        {uploadBlock(
          'knowledge_doc',
          t('v4setup.knowledge_docs'),
          '.pdf,.docx,.doc,.txt,.md,.pptx,.xlsx,.xls,.csv',
          t('v4setup.knowledge_docs_hint'),
        )}
      </div>

      {/* Additional notes (field #24). */}
      <div style={{ marginTop: '18px' }}>
        <label style={labelStyle}>{t('v4setup.notes')}</label>
        <textarea
          style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
          value={additionalNotes}
          onChange={(e) => setAdditionalNotes(e.target.value)}
          placeholder={t('v4setup.notes_placeholder')}
        />
      </div>
    </section>
  )

  const step5 = (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>5 · {t('v4setup.step5')}</h2>
      <p style={hintStyle}>{t('v4setup.step5_hint')}</p>

      <div style={{ fontSize: '15px', color: B.ink, lineHeight: 2 }}>
        <div>
          {t('v4setup.summary_site')}: <strong>{bareDomain(clientDomain) || '—'}</strong>
          {clientBrand ? ` (${clientBrand})` : ''} · {countries.join(', ') || '—'}
        </div>
        <div>
          {t('v4setup.summary_competitors')}:{' '}
          <strong>{filledCompetitors.map((c) => bareDomain(c.domain)).join(', ') || '—'}</strong>
        </div>
        <div>
          {t('v4setup.summary_drivers')} ({selectedDrivers.length}):{' '}
          <strong>
            {drivers
              .filter((dr) => selectedDrivers.includes(dr.key))
              .map((dr) => dr.label)
              .join(', ')}
          </strong>
        </div>
        {attachments.length > 0 && (
          <div>
            {t('v4setup.summary_attachments')}: {attachments.map((a) => a.name).join(', ')}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px 16px',
            background: `${B.warning}15`,
            border: `1px solid ${B.warning}40`,
            borderRadius: '8px',
            color: B.warning,
            fontSize: '15px',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>{t('v4setup.missing_title')}</div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: '20px', fontSize: '14px', color: B.muted }}>
        {t('v4setup.launch_note')}
      </div>

      <button
        type="button"
        onClick={launch}
        disabled={!canLaunch}
        style={{
          marginTop: '20px',
          padding: '14px 28px',
          background: canLaunch ? B.primary : B.surface2,
          color: canLaunch ? B.onPrimary : B.muted,
          border: 'none',
          borderRadius: B.radius.control,
          fontSize: '16px',
          fontWeight: 650,
          cursor: canLaunch ? 'pointer' : 'default',
          transition: B.transition,
        }}
      >
        {launching ? t('v4setup.launching') : t('v4setup.launch_cta')}
      </button>
    </section>
  )

  const steps = [step1, step2, step3, step4, step5]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stepper — large, readable steps */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {stepLabels.map((k, i) => {
          const n = i + 1
          const active = step === n
          return (
            <button
              key={k}
              type="button"
              onClick={() => setStep(n)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 20px',
                borderRadius: B.radius.pill,
                border: `1px solid ${active ? `${B.primary}55` : B.border}`,
                background: active ? B.primarySoft : B.bg,
                color: active ? B.primary : B.muted,
                fontSize: '15px',
                fontWeight: active ? 650 : 600,
                cursor: 'pointer',
                transition: B.transition,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: active ? B.primary : B.surface2,
                  color: active ? B.onPrimary : B.muted,
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                {n}
              </span>
              {t(k)}
            </button>
          )
        })}
      </div>

      {steps[step - 1]}

      {errors.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            background: `${B.error}20`,
            border: `1px solid ${B.error}`,
            borderRadius: '8px',
            color: B.error,
            fontSize: '15px',
          }}
        >
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer: navigation + Save draft, always available */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {step > 1 && (
          <button type="button" onClick={() => setStep(step - 1)} style={ghostButton}>
            ← {t('v4setup.back')}
          </button>
        )}
        {step < 5 && (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            style={{ ...ghostButton, borderColor: `${B.primary}40`, color: B.primary }}
          >
            {t('v4setup.next')} →
          </button>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {savedAt && (
            <span style={{ fontSize: '14px', color: B.muted }}>
              {t('v4setup.draft_saved')} {savedAt}
            </span>
          )}
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={!canSaveDraft}
            style={{
              ...ghostButton,
              opacity: canSaveDraft ? 1 : 0.5,
              cursor: canSaveDraft ? 'pointer' : 'default',
            }}
            title={canSaveDraft ? '' : t('v4setup.draft_needs_domain')}
          >
            {saving ? t('v4setup.saving') : t('v4setup.save_draft')}
          </button>
        </span>
      </div>
    </div>
  )
}
