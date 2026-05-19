'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// URL-first prospect intake. User types a URL/domain, clicks "Analizza",
// Firecrawl + Sonnet pre-fill every field. The user verifies/edits and
// hits "Crea prospect". Competitors come back as 4 suggestions; user can
// remove any or add up to 8 total via autocomplete (free-form domain
// input — autocomplete suggests popular sector-mates from the LLM
// payload).

interface IntakeResponse {
  name: string
  domain: string
  country: 'IT' | 'US' | 'DE' | 'FR' | 'ES' | 'UK'
  language: 'it' | 'en' | 'de' | 'fr' | 'es'
  industry: string | null
  competitors: string[]
  warnings: string[]
}

const COUNTRY_OPTIONS: Array<{ code: IntakeResponse['country']; label: string; lang: IntakeResponse['language'] }> = [
  { code: 'IT', label: 'Italy', lang: 'it' },
  { code: 'US', label: 'United States', lang: 'en' },
  { code: 'DE', label: 'Germany', lang: 'de' },
  { code: 'FR', label: 'France', lang: 'fr' },
  { code: 'ES', label: 'Spain', lang: 'es' },
  { code: 'UK', label: 'United Kingdom', lang: 'en' },
]

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

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

export default function NewProspectIntake() {
  const router = useRouter()

  const [urlInput, setUrlInput] = useState('')
  const [intakeLoading, setIntakeLoading] = useState(false)
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [intake, setIntake] = useState<IntakeResponse | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  // Editable form state (initialized from intake on success).
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [country, setCountry] = useState<IntakeResponse['country']>('IT')
  const [language, setLanguage] = useState<IntakeResponse['language']>('it')
  const [industry, setIndustry] = useState('')
  const [competitors, setCompetitors] = useState<string[]>([])
  const [competitorInput, setCompetitorInput] = useState('')

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const runIntake = async () => {
    const url = urlInput.trim()
    if (!url) {
      setIntakeError('Inserisci una URL')
      return
    }
    setIntakeLoading(true)
    setIntakeError(null)
    setWarnings([])
    try {
      const res = await fetch('/api/pre-sales/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setIntakeError(data.error || `HTTP ${res.status}`)
        setIntakeLoading(false)
        return
      }
      const data = (await res.json()) as IntakeResponse
      setIntake(data)
      setWarnings(data.warnings || [])
      setName(data.name)
      setDomain(data.domain)
      setCountry(data.country)
      setLanguage(data.language)
      setIndustry(data.industry ?? '')
      setCompetitors(data.competitors)
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'network error')
    } finally {
      setIntakeLoading(false)
    }
  }

  const onCountryChange = (code: IntakeResponse['country']) => {
    setCountry(code)
    // Auto-track language to country's default; user can change it after.
    const found = COUNTRY_OPTIONS.find(c => c.code === code)
    if (found) setLanguage(found.lang)
  }

  const addCompetitor = () => {
    const d = normalizeDomain(competitorInput)
    if (!d) return
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      setCreateError('Dominio competitor non valido')
      return
    }
    if (d === domain) {
      setCreateError('Il dominio del cliente non può essere un competitor')
      return
    }
    if (competitors.includes(d)) {
      setCompetitorInput('')
      return
    }
    if (competitors.length >= 8) {
      setCreateError('Max 8 competitors')
      return
    }
    setCompetitors([...competitors, d])
    setCompetitorInput('')
    setCreateError(null)
  }

  const removeCompetitor = (d: string) => {
    setCompetitors(competitors.filter(c => c !== d))
  }

  const onCreateProspect = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          domain,
          industry: industry || null,
          notes: `Country: ${country} · Language: ${language}\nCompetitors: ${competitors.join(', ')}`,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create prospect')
        setCreating(false)
        return
      }
      router.push(`/clients/${data.client.id}/onboarding?from=create`)
      router.refresh()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'network error')
      setCreating(false)
    }
  }

  // Stage 1 — URL input only.
  if (!intake) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={labelStyle}>URL del cliente / prospect</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runIntake() } }}
              placeholder="es. https://www.replayjeans.com  ·  oppure  casaforte.it"
              autoFocus
            />
            <button
              type="button"
              onClick={runIntake}
              disabled={intakeLoading || !urlInput.trim()}
              style={{
                padding: '10px 22px',
                background: intakeLoading || !urlInput.trim() ? '#2a2d35' : '#c8e64a',
                color: intakeLoading || !urlInput.trim() ? '#6b7280' : '#111318',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: intakeLoading || !urlInput.trim() ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {intakeLoading ? 'Analizzo…' : 'Analizza dominio'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
            Firecrawl renderizza il sito + Claude Sonnet estrae nome, paese, lingua, settore e 4 competitor suggeriti.
            Tutto è modificabile prima del salvataggio.
          </div>
        </div>
        {intakeError && (
          <div style={{
            padding: '12px 16px',
            background: '#ef444420',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#ef4444',
            fontSize: '13px',
          }}>
            {intakeError}
          </div>
        )}
      </div>
    )
  }

  // Stage 2 — form pre-filled, user verifies + creates.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{
        padding: '10px 14px',
        background: '#14b8a615',
        border: '1px solid #14b8a640',
        borderRadius: '8px',
        color: '#14b8a6',
        fontSize: '13px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Estratto da <strong>{intake.domain}</strong>. Verifica e modifica i campi.</span>
        <button
          type="button"
          onClick={() => setIntake(null)}
          style={{
            background: 'transparent',
            border: '1px solid #14b8a640',
            color: '#14b8a6',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Cambia URL
        </button>
      </div>

      {warnings.length > 0 && (
        <div style={{
          padding: '10px 14px',
          background: '#f59e0b15',
          border: '1px solid #f59e0b40',
          borderRadius: '8px',
          color: '#f59e0b',
          fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={labelStyle}>Nome</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Dominio</label>
          <input style={inputStyle} value={domain} onChange={(e) => setDomain(normalizeDomain(e.target.value))} />
        </div>
        <div>
          <label style={labelStyle}>Paese</label>
          <select
            style={inputStyle}
            value={country}
            onChange={(e) => onCountryChange(e.target.value as IntakeResponse['country'])}
          >
            {COUNTRY_OPTIONS.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Lingua</label>
          <select
            style={inputStyle}
            value={language}
            onChange={(e) => setLanguage(e.target.value as IntakeResponse['language'])}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
          </select>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Settore (opzionale)</label>
          <input
            style={inputStyle}
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="es. Fashion E-commerce"
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Competitor ({competitors.length}/8)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {competitors.map(c => (
            <span key={c} style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: '#1e2028',
              border: '1px solid #2a2d35',
              borderRadius: '999px',
              fontSize: '12px',
              color: '#ffffff',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {c}
              <button
                type="button"
                onClick={() => removeCompetitor(c)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '14px',
                  lineHeight: '1',
                }}
                aria-label={`Rimuovi ${c}`}
              >
                ×
              </button>
            </span>
          ))}
          {competitors.length === 0 && (
            <span style={{ fontSize: '12px', color: '#6b7280' }}>Nessun competitor suggerito — aggiungili sotto.</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={competitorInput}
            onChange={(e) => setCompetitorInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCompetitor() } }}
            placeholder="aggiungi competitor (es. zalando.it)"
          />
          <button
            type="button"
            onClick={addCompetitor}
            disabled={!competitorInput.trim() || competitors.length >= 8}
            style={{
              padding: '10px 16px',
              background: !competitorInput.trim() || competitors.length >= 8 ? '#2a2d35' : '#1e2028',
              color: !competitorInput.trim() || competitors.length >= 8 ? '#6b7280' : '#ffffff',
              border: '1px solid #2a2d35',
              borderRadius: '8px',
              fontSize: '13px',
              cursor: !competitorInput.trim() || competitors.length >= 8 ? 'default' : 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Aggiungi
          </button>
        </div>
      </div>

      {createError && (
        <div style={{
          padding: '12px 16px',
          background: '#ef444420',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '13px',
        }}>
          {createError}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          type="button"
          onClick={onCreateProspect}
          disabled={creating || !name.trim() || !domain.trim()}
          style={{
            padding: '10px 24px',
            background: creating || !name.trim() || !domain.trim() ? '#2a2d35' : '#c8e64a',
            color: creating || !name.trim() || !domain.trim() ? '#6b7280' : '#111318',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: creating || !name.trim() || !domain.trim() ? 'default' : 'pointer',
          }}
        >
          {creating ? 'Creo…' : 'Crea prospect'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: '10px 24px',
            background: 'transparent',
            color: '#6b7280',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Annulla
        </button>
      </div>
    </div>
  )
}
