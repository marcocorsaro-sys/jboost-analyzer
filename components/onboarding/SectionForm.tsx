'use client'

// ============================================================
// JBoost — Phase 5D — SectionForm
//
// Generic renderer for a single onboarding section. Reads the
// field definitions from `lib/onboarding/sections.ts` and
// emits typed values back up via `onChange`. Each field has
// a "skip" chip that toggles its path in the skipped set.
//
// Pure presentational: no fetch, no Supabase. The parent
// `OnboardingWizard` is responsible for persistence.
// ============================================================

import { useMemo, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import type { OnboardingField, OnboardingSection } from '@/lib/onboarding/sections'

interface SectionFormProps {
  section: OnboardingSection
  /** Full current profile (used to read existing values at each field path). */
  values: Record<string, unknown>
  /** Currently-skipped field paths (subset of section.fields[].path). */
  skipped: Set<string>
  onFieldChange: (path: string, value: unknown) => void
  onFieldSkipToggle: (path: string) => void
}

// ─── dotted-path helpers (mirror API route, duplicated to keep the
//     client bundle independent of server code) ───

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.')
  let cursor: unknown = obj
  for (const seg of segments) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

// ─── Styles ───────────────────────────────────────────────

const fieldWrapStyle: React.CSSProperties = {
  marginBottom: '20px',
  padding: '16px',
  background: '#0f1115',
  border: '1px solid #2a2d35',
  borderRadius: '10px',
}

const fieldHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#e6e7eb',
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const helpStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#8a8e97',
  marginBottom: '8px',
  lineHeight: 1.5,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: '#111318',
  border: '1px solid #2a2d35',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '14px',
  outline: 'none',
}

const skipChipStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '11px',
  fontWeight: 600,
  background: 'transparent',
  border: '1px solid #2a2d35',
  borderRadius: '999px',
  color: '#8a8e97',
  cursor: 'pointer',
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const skippedChipStyle: React.CSSProperties = {
  ...skipChipStyle,
  background: '#f59e0b20',
  borderColor: '#f59e0b80',
  color: '#f59e0b',
}

const importanceDotStyle = (importance: string): React.CSSProperties => ({
  display: 'inline-block',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  marginRight: '6px',
  background:
    importance === 'high' ? '#ef4444' :
    importance === 'medium' ? '#f59e0b' : '#6b7280',
})

// ─── Individual field renderers ──────────────────────────

function ListInput({
  value, onChange, placeholder,
}: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
        {value.map((item, i) => (
          <span key={`${item}-${i}`} style={{
            padding: '4px 10px',
            background: '#1a1d25',
            border: '1px solid #2a2d35',
            borderRadius: '999px',
            fontSize: '12px',
            color: '#e6e7eb',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            {item}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8a8e97',
                cursor: 'pointer',
                fontSize: '14px',
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          style={inputStyle}
          value={draft}
          placeholder={placeholder || 'Aggiungi e premi Enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault()
              onChange([...value, draft.trim()])
              setDraft('')
            }
          }}
        />
      </div>
    </div>
  )
}

function KvInput({
  value, onChange,
}: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value)
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  return (
    <div>
      {entries.map(([key, val]) => (
        <div key={key} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
          <span style={{ ...inputStyle, flex: 1, fontSize: '13px' }}>{key}: {val}</span>
          <button
            type="button"
            onClick={() => {
              const { [key]: _removed, ...rest } = value
              onChange(rest)
            }}
            style={{ ...skipChipStyle, padding: '6px 10px' }}
          >
            ×
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '6px' }}>
        <input style={{ ...inputStyle, flex: 1 }} value={k} onChange={(e) => setK(e.target.value)} placeholder="Metrica" />
        <input style={{ ...inputStyle, flex: 2 }} value={v} onChange={(e) => setV(e.target.value)} placeholder="Valore" />
        <button
          type="button"
          onClick={() => {
            if (k.trim() && v.trim()) {
              onChange({ ...value, [k.trim()]: v.trim() })
              setK('')
              setV('')
            }
          }}
          style={{ ...skipChipStyle, padding: '6px 12px' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

interface PersonaLike { name: string; description: string; pain_points?: string[] }
function PersonasInput({
  value, onChange,
}: { value: PersonaLike[]; onChange: (v: PersonaLike[]) => void }) {
  const [draft, setDraft] = useState<PersonaLike>({ name: '', description: '', pain_points: [] })
  return (
    <div>
      {value.map((p, i) => (
        <div key={i} style={{ padding: '10px', background: '#1a1d25', borderRadius: '8px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e6e7eb' }}>{p.name}</div>
          <div style={{ fontSize: '12px', color: '#8a8e97' }}>{p.description}</div>
          {p.pain_points && p.pain_points.length > 0 && (
            <div style={{ fontSize: '11px', color: '#c8e64a', marginTop: '4px' }}>
              Pain: {p.pain_points.join(', ')}
            </div>
          )}
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            style={{ ...skipChipStyle, marginTop: '6px' }}
          >
            Rimuovi
          </button>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr auto', gap: '6px', alignItems: 'center' }}>
        <input style={inputStyle} placeholder="Nome" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input style={inputStyle} placeholder="Descrizione" value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <input style={inputStyle} placeholder="Pain (separati da ,)"
          value={(draft.pain_points || []).join(', ')}
          onChange={(e) => setDraft({ ...draft, pain_points: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
        <button
          type="button"
          onClick={() => {
            if (draft.name.trim() && draft.description.trim()) {
              onChange([...value, draft])
              setDraft({ name: '', description: '', pain_points: [] })
            }
          }}
          style={{ ...skipChipStyle, padding: '6px 12px' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

interface StakeholderLike {
  name: string; role: string; department?: string
  email?: string; phone?: string
  is_decision_maker?: boolean; approval_scope?: string
}
function StakeholdersInput({
  value, onChange,
}: { value: StakeholderLike[]; onChange: (v: StakeholderLike[]) => void }) {
  const [draft, setDraft] = useState<StakeholderLike>({ name: '', role: '' })
  return (
    <div>
      {value.map((s, i) => (
        <div key={i} style={{ padding: '10px', background: '#1a1d25', borderRadius: '8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#e6e7eb' }}>
                {s.name} {s.is_decision_maker && <span style={{ color: '#c8e64a' }}>(DM)</span>}
              </div>
              <div style={{ fontSize: '12px', color: '#8a8e97' }}>
                {s.role}{s.department ? ` · ${s.department}` : ''}{s.email ? ` · ${s.email}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              style={skipChipStyle}
            >
              Rimuovi
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '6px' }}>
        <input style={inputStyle} placeholder="Nome" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input style={inputStyle} placeholder="Ruolo" value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
        <select style={inputStyle} value={draft.department || ''}
          onChange={(e) => setDraft({ ...draft, department: e.target.value || undefined })}>
          <option value="">-- dipartimento --</option>
          <option value="c_level">C-Level</option>
          <option value="marketing">Marketing</option>
          <option value="content">Content</option>
          <option value="technical">Technical</option>
          <option value="legal">Legal</option>
          <option value="agency">Agency</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '6px', alignItems: 'center' }}>
        <input style={inputStyle} placeholder="Email" value={draft.email || ''}
          onChange={(e) => setDraft({ ...draft, email: e.target.value || undefined })} />
        <input style={inputStyle} placeholder="Approval scope" value={draft.approval_scope || ''}
          onChange={(e) => setDraft({ ...draft, approval_scope: e.target.value || undefined })} />
        <label style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.is_decision_maker || false}
            onChange={(e) => setDraft({ ...draft, is_decision_maker: e.target.checked })} />
          <span style={{ fontSize: '12px' }}>Decision maker</span>
        </label>
        <button
          type="button"
          onClick={() => {
            if (draft.name.trim() && draft.role.trim()) {
              onChange([...value, draft])
              setDraft({ name: '', role: '' })
            }
          }}
          style={{ ...skipChipStyle, padding: '6px 12px' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

interface AuthorLike { name: string; credentials?: string }
function AuthorsInput({
  value, onChange,
}: { value: AuthorLike[]; onChange: (v: AuthorLike[]) => void }) {
  const [draft, setDraft] = useState<AuthorLike>({ name: '' })
  return (
    <div>
      {value.map((a, i) => (
        <div key={i} style={{ padding: '8px', background: '#1a1d25', borderRadius: '8px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '13px', color: '#e6e7eb' }}>
            {a.name}{a.credentials ? ` — ${a.credentials}` : ''}
          </div>
          <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} style={skipChipStyle}>×</button>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '6px' }}>
        <input style={inputStyle} placeholder="Nome autore" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input style={inputStyle} placeholder="Credenziali" value={draft.credentials || ''}
          onChange={(e) => setDraft({ ...draft, credentials: e.target.value || undefined })} />
        <button
          type="button"
          onClick={() => {
            if (draft.name.trim()) {
              onChange([...value, draft])
              setDraft({ name: '' })
            }
          }}
          style={{ ...skipChipStyle, padding: '6px 12px' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ─── Main renderer ───────────────────────────────────────

export default function SectionForm({
  section, values, skipped, onFieldChange, onFieldSkipToggle,
}: SectionFormProps) {
  const { t } = useLocale()

  const tr = useMemo(
    () => (key: string) => t(key as TranslationKey),
    [t]
  )

  const renderField = (field: OnboardingField) => {
    const current = getAtPath(values, field.path)
    const isSkipped = skipped.has(field.path)
    const label = tr(field.labelKey)
    const help = field.helpKey ? tr(field.helpKey) : null

    const change = (v: unknown) => onFieldChange(field.path, v)

    let control: React.ReactNode = null
    switch (field.type) {
      case 'text':
        control = (
          <input
            style={inputStyle}
            value={(current as string) || ''}
            onChange={(e) => change(e.target.value)}
            placeholder={field.placeholderKey ? tr(field.placeholderKey) : ''}
          />
        )
        break
      case 'textarea':
        control = (
          <textarea
            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }}
            value={(current as string) || ''}
            onChange={(e) => change(e.target.value)}
          />
        )
        break
      case 'list':
        control = (
          <ListInput
            value={(current as string[]) || []}
            onChange={change}
          />
        )
        break
      case 'select':
        control = (
          <select
            style={inputStyle}
            value={(current as string) || ''}
            onChange={(e) => change(e.target.value || undefined)}
          >
            <option value="">—</option>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>
                {tr(opt.labelKey)}
              </option>
            ))}
          </select>
        )
        break
      case 'multiselect': {
        const arr = (current as string[]) || []
        control = (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {field.options?.map(opt => {
              const active = arr.includes(opt.value)
              return (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => {
                    const next = active ? arr.filter(v => v !== opt.value) : [...arr, opt.value]
                    change(next)
                  }}
                  style={{
                    padding: '8px 14px',
                    background: active ? '#c8e64a' : 'transparent',
                    color: active ? '#111318' : '#e6e7eb',
                    border: `1px solid ${active ? '#c8e64a' : '#2a2d35'}`,
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {tr(opt.labelKey)}
                </button>
              )
            })}
          </div>
        )
        break
      }
      case 'toggle':
        control = (
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(current)}
              onChange={(e) => change(e.target.checked)}
              style={{ width: '18px', height: '18px' }}
            />
            <span style={{ fontSize: '13px', color: '#e6e7eb' }}>
              {Boolean(current) ? 'Si' : 'No'}
            </span>
          </label>
        )
        break
      case 'personas':
        control = (
          <PersonasInput
            value={(current as PersonaLike[]) || []}
            onChange={change}
          />
        )
        break
      case 'stakeholders':
        control = (
          <StakeholdersInput
            value={(current as StakeholderLike[]) || []}
            onChange={change}
          />
        )
        break
      case 'authors':
        control = (
          <AuthorsInput
            value={(current as AuthorLike[]) || []}
            onChange={change}
          />
        )
        break
      case 'kv':
        control = (
          <KvInput
            value={(current as Record<string, string>) || {}}
            onChange={change}
          />
        )
        break
    }

    return (
      <div key={field.path} style={{
        ...fieldWrapStyle,
        opacity: isSkipped ? 0.55 : 1,
        borderColor: isSkipped ? '#f59e0b40' : '#2a2d35',
      }}>
        <div style={fieldHeaderStyle}>
          <div style={labelStyle}>
            <span style={importanceDotStyle(field.importance)} />
            {label}
          </div>
          <button
            type="button"
            onClick={() => onFieldSkipToggle(field.path)}
            style={isSkipped ? skippedChipStyle : skipChipStyle}
          >
            {isSkipped ? 'Saltato — ripristina' : 'Rispondi dopo'}
          </button>
        </div>
        {help && <div style={helpStyle}>{help}</div>}
        {!isSkipped && control}
      </div>
    )
  }

  return (
    <div>
      <h2 style={{
        fontSize: '20px',
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: '8px',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {tr(section.titleKey)}
      </h2>
      {section.descriptionKey && (
        <p style={{ fontSize: '14px', color: '#8a8e97', marginBottom: '24px', lineHeight: 1.6 }}>
          {tr(section.descriptionKey)}
        </p>
      )}
      {section.fields.map(renderField)}
    </div>
  )
}
