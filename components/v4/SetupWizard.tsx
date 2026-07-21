'use client'

/**
 * V4 setup wizard (Block 3).
 *
 * One page, four sections — the analyst sees the whole configuration at once
 * instead of discovering a blocking rule three steps in. The gating rules are
 * shown inline (a Business driver is visibly disabled, with the reason, until
 * a competitor exists) but the server re-validates everything: the browser is
 * where the rules are explained, never where they are enforced.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { driversInUiOrder } from '@/lib/scoring/registry'
import {
  INDUSTRY_LABELS,
  INDUSTRY_PRESETS,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  type IndustryPreset,
} from '@/lib/v4/setup'

const MAX_COMPETITORS = 4

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: '#111318',
  border: '1px solid #2a2d35',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '14px',
  outline: 'none',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#a0a0a0',
  marginBottom: '6px',
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const sectionStyle: React.CSSProperties = {
  background: '#1a1c24',
  borderRadius: '12px',
  border: '1px solid #2a2d35',
  padding: '24px',
}

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '14px',
  fontWeight: 700,
  color: '#ffffff',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '4px',
}

const hintStyle: React.CSSProperties = { fontSize: '12px', color: '#6b7280', marginBottom: '18px' }

interface CompetitorRow {
  domain: string
  brandName: string
}

function bareDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

export default function SetupWizard({ clientId }: { clientId?: string | null }) {
  const router = useRouter()
  const drivers = useMemo(() => driversInUiOrder(), [])

  const [clientDomain, setClientDomain] = useState('')
  const [clientBrand, setClientBrand] = useState('')
  const [brandVariants, setBrandVariants] = useState('')
  const [country, setCountry] = useState('IT')
  const [outputLanguage, setOutputLanguage] = useState<'it' | 'en'>('it')
  const [industryPreset, setIndustryPreset] = useState<IndustryPreset | ''>('')
  const [seoMaturity, setSeoMaturity] = useState<'' | 'low' | 'medium' | 'high'>('')
  const [targetAudience, setTargetAudience] = useState('')

  const [competitors, setCompetitors] = useState<CompetitorRow[]>([{ domain: '', brandName: '' }])

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(drivers.map((d) => [d.key, d.family === 'development'])),
  )

  const [showTemplates, setShowTemplates] = useState(false)
  // site_ref -> template_key -> url
  const [templates, setTemplates] = useState<Record<string, Record<string, string>>>({})

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const filledCompetitors = competitors.filter((c) => bareDomain(c.domain))
  const hasCompetitor = filledCompetitors.length > 0

  const sites = useMemo(() => {
    const out: Array<{ site_ref: string; domain: string; label: string }> = []
    const cd = bareDomain(clientDomain)
    if (cd) out.push({ site_ref: 'client', domain: cd, label: `Cliente · ${cd}` })
    filledCompetitors.slice(0, MAX_COMPETITORS).forEach((c, i) => {
      out.push({
        site_ref: `competitor_${i + 1}`,
        domain: bareDomain(c.domain),
        label: `Competitor ${i + 1} · ${bareDomain(c.domain)}`,
      })
    })
    return out
  }, [clientDomain, filledCompetitors])

  const selectedDrivers = drivers
    .filter((d) => enabled[d.key] && (hasCompetitor || !d.competitorMandatory))
    .map((d) => d.key)

  const setTemplateUrl = (siteRef: string, key: string, value: string) => {
    setTemplates((prev) => ({ ...prev, [siteRef]: { ...(prev[siteRef] ?? {}), [key]: value } }))
  }

  const submit = async (startNow: boolean) => {
    setSubmitting(true)
    setErrors([])
    try {
      const res = await fetch('/api/v4/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
          country,
          outputLanguage,
          industryPreset: industryPreset || null,
          seoMaturity: seoMaturity || null,
          targetAudience: targetAudience || null,
          drivers: selectedDrivers,
          templates,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors(Array.isArray(data.details) ? data.details : [data.error ?? 'errore sconosciuto'])
        setSubmitting(false)
        return
      }

      if (!startNow) {
        router.push(`/results/v4/${data.analysisId}`)
        return
      }

      const startRes = await fetch(`/api/v4/analyses/${data.analysisId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drivers: selectedDrivers }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) {
        // The analysis exists; the run did not start. Say exactly that instead
        // of leaving the analyst to guess from a generic failure.
        setErrors([
          `Analisi creata (${data.analysisId}) ma l'avvio è fallito: ${
            Array.isArray(startData.details) ? startData.details.join(' | ') : startData.error
          }`,
        ])
        setSubmitting(false)
        return
      }

      router.push(`/results/v4/${data.analysisId}`)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'errore di rete'])
      setSubmitting(false)
    }
  }

  const canSubmit = Boolean(bareDomain(clientDomain)) && selectedDrivers.length > 0 && !submitting

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ---------- 1. Cliente ---------- */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>1 · Cliente</h2>
        <p style={hintStyle}>Il sito oggetto del report. Uno solo, sempre.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Dominio</label>
            <input
              style={inputStyle}
              value={clientDomain}
              onChange={(e) => setClientDomain(e.target.value)}
              placeholder="es. benetton.com"
            />
          </div>
          <div>
            <label style={labelStyle}>Brand name</label>
            <input
              style={inputStyle}
              value={clientBrand}
              onChange={(e) => setClientBrand(e.target.value)}
              placeholder="es. Benetton"
            />
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <label style={labelStyle}>Varianti del brand (separate da virgola)</label>
          <input
            style={inputStyle}
            value={brandVariants}
            onChange={(e) => setBrandVariants(e.target.value)}
            placeholder="united colors of benetton, benetton group"
          />
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            Usate dal driver Awareness per raccogliere il cluster di keyword di brand.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
          <div>
            <label style={labelStyle}>Paese</label>
            <input style={inputStyle} value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Lingua output</label>
            <select
              style={inputStyle}
              value={outputLanguage}
              onChange={(e) => setOutputLanguage(e.target.value as 'it' | 'en')}
            >
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Maturità SEO</label>
            <select
              style={inputStyle}
              value={seoMaturity}
              onChange={(e) => setSeoMaturity(e.target.value as typeof seoMaturity)}
            >
              <option value="">—</option>
              <option value="low">Bassa</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
          <div>
            <label style={labelStyle}>Industry preset</label>
            <select
              style={inputStyle}
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
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
              Determina i markup type attesi dal driver Schema.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Target audience</label>
            <input
              style={inputStyle}
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="es. donne 25-45, urban"
            />
          </div>
        </div>
      </section>

      {/* ---------- 2. Competitor ---------- */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>2 · Competitor</h2>
        <p style={hintStyle}>
          Fino a {MAX_COMPETITORS}. Senza almeno un competitor i driver Business non sono calcolabili:
          il loro punteggio è un indice relativo al set, non un valore assoluto.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {competitors.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 40px', gap: '12px' }}>
              <input
                style={inputStyle}
                value={c.domain}
                onChange={(e) => {
                  const next = [...competitors]
                  next[i] = { ...next[i], domain: e.target.value }
                  setCompetitors(next)
                }}
                placeholder={`Dominio competitor ${i + 1}`}
              />
              <input
                style={inputStyle}
                value={c.brandName}
                onChange={(e) => {
                  const next = [...competitors]
                  next[i] = { ...next[i], brandName: e.target.value }
                  setCompetitors(next)
                }}
                placeholder="Brand name (opzionale)"
              />
              <button
                type="button"
                onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2d35',
                  borderRadius: '8px',
                  color: '#6b7280',
                  cursor: 'pointer',
                }}
                aria-label={`Rimuovi competitor ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {competitors.length < MAX_COMPETITORS && (
          <button
            type="button"
            onClick={() => setCompetitors([...competitors, { domain: '', brandName: '' }])}
            style={{
              marginTop: '12px',
              background: 'transparent',
              border: '1px dashed #2a2d35',
              borderRadius: '8px',
              color: '#a0a0a0',
              padding: '8px 16px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            + Aggiungi competitor
          </button>
        )}
      </section>

      {/* ---------- 3. Driver ---------- */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>3 · Driver</h2>
        <p style={hintStyle}>
          I driver Business richiedono almeno un competitor; i Development possono girare da soli.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {drivers.map((d) => {
            const blocked = d.competitorMandatory && !hasCompetitor
            const checked = Boolean(enabled[d.key]) && !blocked
            return (
              <label
                key={d.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  background: '#111318',
                  border: `1px solid ${checked ? '#c8e64a40' : '#2a2d35'}`,
                  borderRadius: '8px',
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  opacity: blocked ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={blocked}
                  onChange={(e) => setEnabled({ ...enabled, [d.key]: e.target.checked })}
                  style={{ marginTop: '3px' }}
                />
                <span>
                  <span style={{ display: 'block', fontSize: '14px', color: '#ffffff' }}>{d.label}</span>
                  <span style={{ display: 'block', fontSize: '12px', color: '#6b7280' }}>
                    {d.family === 'business' ? 'Business' : 'Development'} · {d.source}
                  </span>
                  {blocked && (
                    <span style={{ display: 'block', fontSize: '12px', color: '#f59e0b', marginTop: '4px' }}>
                      Richiede almeno un competitor
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </section>

      {/* ---------- 4. Template ---------- */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>4 · Template di pagina</h2>
        <p style={hintStyle}>
          Speed, Accessibility, Schema e Content misurano queste pagine. Se non ne indichi, viene
          misurata solo la homepage di ogni sito — il confronto resta corretto, ma il punteggio
          descrive una pagina sola.
        </p>

        {sites.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Inserisci prima il dominio del cliente.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              style={{
                background: 'transparent',
                border: '1px solid #2a2d35',
                borderRadius: '8px',
                color: '#a0a0a0',
                padding: '8px 16px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {showTemplates ? 'Nascondi' : 'Configura'} template ({sites.length} siti)
            </button>

            {showTemplates && (
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {sites.map((site) => (
                  <div key={site.site_ref}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#c8e64a',
                        marginBottom: '10px',
                        fontFamily: "'JetBrains Mono', monospace",
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
                          <span style={{ fontSize: '12px', color: '#a0a0a0' }}>{TEMPLATE_LABELS[key]}</span>
                          <input
                            style={inputStyle}
                            value={templates[site.site_ref]?.[key] ?? ''}
                            onChange={(e) => setTemplateUrl(site.site_ref, key, e.target.value)}
                            placeholder={
                              key === 'homepage'
                                ? `https://${site.domain} (default)`
                                : 'lascia vuoto se il sito non ha questo template'
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {errors.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            background: '#ef444420',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#ef4444',
            fontSize: '13px',
          }}
        >
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={!canSubmit}
          style={{
            padding: '12px 26px',
            background: canSubmit ? '#c8e64a' : '#2a2d35',
            color: canSubmit ? '#111318' : '#6b7280',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: canSubmit ? 'pointer' : 'default',
          }}
        >
          {submitting ? 'Avvio…' : `Crea e avvia (${selectedDrivers.length} driver)`}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={!canSubmit}
          style={{
            padding: '12px 20px',
            background: 'transparent',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            color: '#a0a0a0',
            fontSize: '13px',
            cursor: canSubmit ? 'pointer' : 'default',
          }}
        >
          Crea senza avviare
        </button>
      </div>
    </div>
  )
}
