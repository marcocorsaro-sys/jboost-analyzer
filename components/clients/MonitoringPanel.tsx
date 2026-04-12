'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'

interface MonitoringSubscription {
  client_id: string
  is_active: boolean
  frequency: 'weekly' | 'biweekly' | 'monthly'
  frequency_days: number | null
  enabled_drivers: string[]
  martech_scan: boolean
  pagespeed_scan: boolean
  next_run_at: string | null
  last_run_at: string | null
  paused_until: string | null
}

interface MonitoringPanelProps {
  clientId: string
  canEdit: boolean
}

type FrequencyMode = 'weekly' | 'biweekly' | 'monthly' | 'custom'

/**
 * Monitoring subscription panel for the client detail page (Phase 4C).
 * Lets editor+ members configure how often the cron worker refreshes
 * this client and trigger an immediate run on demand.
 */
export default function MonitoringPanel({ clientId, canEdit }: MonitoringPanelProps) {
  const { t } = useLocale()
  const router = useRouter()

  const [subscription, setSubscription] = useState<MonitoringSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state (mirrors subscription, mutable until saved)
  const [enabled, setEnabled] = useState(false)
  const [frequencyMode, setFrequencyMode] = useState<FrequencyMode>('weekly')
  const [customDays, setCustomDays] = useState<number>(7)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/monitoring`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      const sub: MonitoringSubscription | null = data.subscription
      setSubscription(sub)
      if (sub) {
        setEnabled(sub.is_active)
        if (sub.frequency_days && sub.frequency_days > 0) {
          setFrequencyMode('custom')
          setCustomDays(sub.frequency_days)
        } else {
          setFrequencyMode(sub.frequency)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  async function handleSave() {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const body: Record<string, unknown> = {
        is_active: enabled,
      }
      if (frequencyMode === 'custom') {
        body.frequency = 'weekly' // fallback preset; ignored when frequency_days is set
        body.frequency_days = customDays
      } else {
        body.frequency = frequencyMode
        body.frequency_days = null
      }
      const res = await fetch(`/api/clients/${clientId}/monitoring`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setSubscription(data.subscription)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRunNow() {
    if (!canEdit) return
    setRunning(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/monitoring/run-now`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start run')
      setSuccess(t('clients.monitoring_run_started'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : t('clients.monitoring_never')

  return (
    <div
      style={{
        background: '#1a1c24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
        <div>
          <h3
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '13px',
              fontWeight: 600,
              color: '#c8e64a',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              margin: 0,
            }}
          >
            {t('clients.monitoring_title')}
          </h3>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            {t('clients.monitoring_subtitle')}
          </div>
        </div>
        {canEdit && subscription && (
          <button
            type="button"
            onClick={handleRunNow}
            disabled={running || saving}
            style={{
              padding: '8px 14px',
              background: running ? '#2a2d35' : '#c8e64a',
              color: running ? '#6b7280' : '#111318',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: running ? 'default' : 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}
          >
            {running ? t('clients.monitoring_running') : t('clients.monitoring_run_now')}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', fontSize: '13px' }}>{t('clients.monitoring_loading')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          {/* Enable toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: '#111318',
              borderRadius: '8px',
              cursor: canEdit ? 'pointer' : 'default',
              gridColumn: '1 / -1',
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || saving}
              onChange={e => setEnabled(e.target.checked)}
              style={{ accentColor: '#c8e64a', width: 16, height: 16 }}
            />
            <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 600 }}>
              {enabled ? t('clients.monitoring_enabled') : t('clients.monitoring_disabled')}
            </span>
          </label>

          {/* Frequency */}
          <div style={{ padding: '10px 14px', background: '#111318', borderRadius: '8px', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
              {t('clients.monitoring_frequency')}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {(['weekly', 'biweekly', 'monthly', 'custom'] as FrequencyMode[]).map(mode => (
                <button
                  key={mode}
                  type="button"
                  disabled={!canEdit || saving}
                  onClick={() => setFrequencyMode(mode)}
                  style={{
                    padding: '6px 12px',
                    background: frequencyMode === mode ? '#c8e64a15' : 'transparent',
                    color: frequencyMode === mode ? '#c8e64a' : '#6b7280',
                    border: `1px solid ${frequencyMode === mode ? '#c8e64a40' : '#2a2d35'}`,
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: canEdit ? 'pointer' : 'default',
                    fontFamily: "'JetBrains Mono', monospace",
                    textTransform: 'uppercase',
                  }}
                >
                  {t(`clients.monitoring_freq_${mode}` as 'clients.monitoring_freq_weekly')}
                </button>
              ))}
              {frequencyMode === 'custom' && (
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={customDays}
                  disabled={!canEdit || saving}
                  onChange={e => setCustomDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
                  style={{
                    width: '70px',
                    padding: '6px 10px',
                    background: '#1a1c24',
                    border: '1px solid #2a2d35',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                  }}
                />
              )}
            </div>
          </div>

          {/* Last / next run */}
          <div style={{ padding: '10px 14px', background: '#111318', borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontFamily: "'JetBrains Mono', monospace" }}>
              {t('clients.monitoring_last_run')}
            </div>
            <div style={{ fontSize: '12px', color: '#ffffff' }}>
              {formatDate(subscription?.last_run_at ?? null)}
            </div>
          </div>
          <div style={{ padding: '10px 14px', background: '#111318', borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontFamily: "'JetBrains Mono', monospace" }}>
              {t('clients.monitoring_next_run')}
            </div>
            <div style={{ fontSize: '12px', color: '#ffffff' }}>
              {formatDate(subscription?.next_run_at ?? null)}
            </div>
          </div>

          {!subscription && (
            <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#6b7280', fontStyle: 'italic' }}>
              {t('clients.monitoring_no_subscription')}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: '12px',
            padding: '8px 12px',
            background: '#ef444415',
            border: '1px solid #ef444440',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            marginTop: '12px',
            padding: '8px 12px',
            background: '#22c55e15',
            border: '1px solid #22c55e40',
            borderRadius: '6px',
            color: '#22c55e',
            fontSize: '12px',
          }}
        >
          {success}
        </div>
      )}

      {canEdit && !loading && (
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || running}
            style={{
              padding: '8px 18px',
              background: saving ? '#2a2d35' : '#22c55e',
              color: saving ? '#6b7280' : '#111318',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}
          >
            {saving ? '...' : t('clients.monitoring_save')}
          </button>
        </div>
      )}
    </div>
  )
}
