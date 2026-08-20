'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'

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
        background: B.surface,
        borderRadius: '12px',
        border: `1px solid ${B.border}`,
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
        <div>
          <h3
            style={{
              fontFamily: B.fontMono,
              fontSize: '13px',
              fontWeight: 600,
              color: B.primary,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              margin: 0,
            }}
          >
            {t('clients.monitoring_title')}
          </h3>
          <div style={{ fontSize: '12px', color: B.muted, marginTop: '4px' }}>
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
              background: running ? B.border : B.primary,
              color: running ? B.muted : B.bg,
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: running ? 'default' : 'pointer',
              fontFamily: B.fontMono,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}
          >
            {running ? t('clients.monitoring_running') : t('clients.monitoring_run_now')}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: B.muted, fontSize: '13px' }}>{t('clients.monitoring_loading')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          {/* Enable toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: B.bg,
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
              style={{ accentColor: B.primary, width: 16, height: 16 }}
            />
            <span style={{ fontSize: '13px', color: B.ink, fontWeight: 600 }}>
              {enabled ? t('clients.monitoring_enabled') : t('clients.monitoring_disabled')}
            </span>
          </label>

          {/* Frequency */}
          <div style={{ padding: '10px 14px', background: B.bg, borderRadius: '8px', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '11px', color: B.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontFamily: B.fontMono }}>
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
                    background: frequencyMode === mode ? B.primarySoft : 'transparent',
                    color: frequencyMode === mode ? B.primary : B.muted,
                    border: `1px solid ${frequencyMode === mode ? `${B.primary}40` : B.border}`,
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: canEdit ? 'pointer' : 'default',
                    fontFamily: B.fontMono,
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
                    background: B.surface,
                    border: `1px solid ${B.border}`,
                    borderRadius: '6px',
                    color: B.ink,
                    fontSize: '12px',
                    fontFamily: 'inherit',
                  }}
                />
              )}
            </div>
          </div>

          {/* Last / next run */}
          <div style={{ padding: '10px 14px', background: B.bg, borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', color: B.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontFamily: B.fontMono }}>
              {t('clients.monitoring_last_run')}
            </div>
            <div style={{ fontSize: '12px', color: B.ink }}>
              {formatDate(subscription?.last_run_at ?? null)}
            </div>
          </div>
          <div style={{ padding: '10px 14px', background: B.bg, borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', color: B.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontFamily: B.fontMono }}>
              {t('clients.monitoring_next_run')}
            </div>
            <div style={{ fontSize: '12px', color: B.ink }}>
              {formatDate(subscription?.next_run_at ?? null)}
            </div>
          </div>

          {!subscription && (
            <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: B.muted, fontStyle: 'italic' }}>
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
            background: `${B.error}15`,
            border: `1px solid ${B.error}40`,
            borderRadius: '6px',
            color: B.error,
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
            background: `${B.success}15`,
            border: `1px solid ${B.success}40`,
            borderRadius: '6px',
            color: B.success,
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
              background: saving ? B.border : B.success,
              color: saving ? B.muted : B.bg,
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              fontFamily: B.fontMono,
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
