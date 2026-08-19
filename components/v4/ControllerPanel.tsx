'use client'

/**
 * V4 — Controller chip + findings panel (ResultsView header).
 *
 * The chip is the always-visible verdict of the deterministic reviewer:
 * red when at least one ERROR finding exists, amber when only warnings,
 * green when the audit is clean. Clicking it opens the inline findings
 * panel; "Ricontrolla" simply re-GETs the route — findings are computed
 * on demand and never persisted, so re-checking is always safe.
 *
 * Finding messages arrive in Italian from the engine (like the pause
 * messages); only the panel chrome is translated here.
 */

import { useLocale } from '@/lib/i18n'
import { getV4Driver } from '@/lib/scoring/registry'
import { card, ghostButton, pill } from './results-shared'

export interface ControllerFindingDto {
  severity: 'error' | 'warning' | 'info'
  check: string
  driver_key?: string
  message: string
  suggestion?: string
}

export interface ControllerResponse {
  findings: ControllerFindingDto[]
  counts: { error: number; warning: number; info: number }
  checked_at: string
}

const SEVERITY_COLOR: Record<ControllerFindingDto['severity'], string> = {
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#6b7280',
}

export function controllerChipColor(counts: ControllerResponse['counts']): string {
  if (counts.error > 0) return '#ef4444'
  if (counts.warning > 0) return '#f59e0b'
  return '#22c55e'
}

export function ControllerChip({
  data,
  open,
  onToggle,
}: {
  data: ControllerResponse | null
  open: boolean
  onToggle: () => void
}) {
  const { t } = useLocale()
  if (!data) return null
  const total = data.counts.error + data.counts.warning + data.counts.info
  const color = controllerChipColor(data.counts)
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        ...pill(color),
        border: `1px solid ${open ? color : 'transparent'}`,
        cursor: 'pointer',
        background: `${color}18`,
      }}
      title={t('v4ctrl.title')}
    >
      {t('v4ctrl.chip')} · {total}
    </button>
  )
}

export function ControllerPanel({
  data,
  loading,
  error,
  onRecheck,
}: {
  data: ControllerResponse | null
  loading: boolean
  error: string | null
  onRecheck: () => void
}) {
  const { t } = useLocale()

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>{t('v4ctrl.title')}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>{t('v4ctrl.subtitle')}</div>
        </div>
        <button
          type="button"
          onClick={onRecheck}
          disabled={loading}
          style={{ ...ghostButton, marginLeft: 'auto', color: loading ? '#6b7280' : '#a0a0a0' }}
        >
          {loading ? t('v4ctrl.rechecking') : t('v4ctrl.recheck')}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '12px', color: '#ef4444' }}>
          {t('v4ctrl.load_error')}: {error}
        </div>
      )}

      {!error && !data && <div style={{ fontSize: '13px', color: '#6b7280' }}>{t('v4ctrl.loading')}</div>}

      {data && data.findings.length === 0 && (
        <div style={{ fontSize: '13px', color: '#22c55e' }}>{t('v4ctrl.clean')}</div>
      )}

      {data && data.findings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {data.findings.map((f, i) => (
            <div
              key={`${f.check}-${f.driver_key ?? 'audit'}-${i}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: `1px solid ${SEVERITY_COLOR[f.severity]}40`,
                background: `${SEVERITY_COLOR[f.severity]}0d`,
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={pill(SEVERITY_COLOR[f.severity])}>
                  {t(
                    f.severity === 'error'
                      ? 'v4ctrl.sev_error'
                      : f.severity === 'warning'
                        ? 'v4ctrl.sev_warning'
                        : 'v4ctrl.sev_info',
                  )}
                </span>
                {f.driver_key && (
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                    {getV4Driver(f.driver_key)?.label ?? f.driver_key}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>
                  {f.check}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: '#d0d0d0', lineHeight: 1.5 }}>{f.message}</div>
              {f.suggestion && (
                <div style={{ fontSize: '12px', color: '#c8e64a' }}>
                  {t('v4ctrl.suggestion')}: {f.suggestion}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data && (
        <div style={{ fontSize: '11px', color: '#6b7280' }}>
          {t('v4ctrl.checked_at')} {new Date(data.checked_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
