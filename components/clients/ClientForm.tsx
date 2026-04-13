'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import DomainAutocomplete from '@/components/ui/DomainAutocomplete'

interface ClientFormProps {
  initialData?: {
    name?: string
    domain?: string
    industry?: string
    website_url?: string
    contact_name?: string
    contact_email?: string
    contact_phone?: string
    notes?: string
  }
  clientId?: string
  mode: 'create' | 'edit'
}

const INDUSTRIES = [
  'E-commerce', 'SaaS', 'Finance', 'Healthcare', 'Education',
  'Media', 'Travel', 'Real Estate', 'Automotive', 'Fashion',
  'Food & Beverage', 'Technology', 'Manufacturing', 'Consulting',
  'Non-Profit', 'Government', 'Other',
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
  transition: 'border-color 0.2s',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#a0a0a0',
  marginBottom: '6px',
  fontFamily: "'JetBrains Mono', monospace",
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
}

export default function ClientForm({ initialData, clientId, mode }: ClientFormProps) {
  const router = useRouter()
  const { t } = useLocale()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: initialData?.name || '',
    domain: initialData?.domain || '',
    industry: initialData?.industry || '',
    website_url: initialData?.website_url || '',
    contact_name: initialData?.contact_name || '',
    contact_email: initialData?.contact_email || '',
    contact_phone: initialData?.contact_phone || '',
    notes: initialData?.notes || '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const url = mode === 'create' ? '/api/clients' : `/api/clients/${clientId}`
      const method = mode === 'create' ? 'POST' : 'PUT'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save client')

      // Phase 5D — after a fresh create, jump straight into the
      // structured onboarding wizard. Edits still return to the
      // client detail page.
      router.push(
        mode === 'create'
          ? `/clients/${data.client.id}/onboarding?from=create`
          : `/clients/${clientId}`
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#ef444420',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          color: '#ef4444',
          fontSize: '13px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Name */}
        <div>
          <label style={labelStyle}>{t('clientForm.clientName')}</label>
          <input
            style={inputStyle}
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="Es: Nike Italia"
            required
          />
        </div>

        {/* Domain */}
        <div>
          <label style={labelStyle}>{t('clientForm.domain')}</label>
          <DomainAutocomplete
            value={form.domain}
            onChange={(v) => updateField('domain', v)}
            placeholder="Es: nike.com"
            style={inputStyle}
          />
        </div>

        {/* Industry */}
        <div>
          <label style={labelStyle}>{t('clientForm.industry')}</label>
          <select
            style={inputStyle}
            value={form.industry}
            onChange={(e) => updateField('industry', e.target.value)}
          >
            <option value="">{t('clientForm.selectIndustry')}</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        {/* Website */}
        <div>
          <label style={labelStyle}>{t('clientForm.websiteUrl')}</label>
          <DomainAutocomplete
            value={form.website_url}
            onChange={(v) => updateField('website_url', v)}
            placeholder="https://www.nike.com"
            showWebsiteVariant
            style={inputStyle}
          />
        </div>

        {/* Contact Name */}
        <div>
          <label style={labelStyle}>{t('clientForm.contactName')}</label>
          <input
            style={inputStyle}
            value={form.contact_name}
            onChange={(e) => updateField('contact_name', e.target.value)}
            placeholder="Mario Rossi"
          />
        </div>

        {/* Contact Email */}
        <div>
          <label style={labelStyle}>{t('clientForm.contactEmail')}</label>
          <input
            type="email"
            style={inputStyle}
            value={form.contact_email}
            onChange={(e) => updateField('contact_email', e.target.value)}
            placeholder="mario@azienda.it"
          />
        </div>

        {/* Contact Phone */}
        <div>
          <label style={labelStyle}>{t('clientForm.contactPhone')}</label>
          <input
            style={inputStyle}
            value={form.contact_phone}
            onChange={(e) => updateField('contact_phone', e.target.value)}
            placeholder="+39 02 1234567"
          />
        </div>
      </div>

      {/* Notes — full width */}
      <div style={{ marginTop: '20px' }}>
        <label style={labelStyle}>{t('clientForm.notes')}</label>
        <textarea
          style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
          value={form.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder={t('clientForm.notesPlaceholder')}
        />
      </div>

      {/* Submit */}
      <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 24px',
            background: loading ? '#2a2d35' : '#c8e64a',
            color: loading ? '#6b7280' : '#111318',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {loading
            ? (mode === 'create' ? t('clientForm.creating') : t('clientForm.saving'))
            : (mode === 'create' ? t('clientForm.createClient') : t('clientForm.saveChanges'))
          }
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
          {t('clientForm.cancel')}
        </button>
      </div>
    </form>
  )
}
