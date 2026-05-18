'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getScoreBand } from '@/lib/constants'
import type { ClientLifecycleStage } from '@/lib/types/client'
import { useLocale, formatLocalDate } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

interface ClientCardProps {
  id: string
  name: string
  domain: string | null
  industry: string | null
  status: 'active' | 'archived'
  lifecycle_stage?: ClientLifecycleStage
  analyses_count: number
  latest_score: number | null
  latest_analysis_at: string | null
  onDeleted?: (id: string) => void
}

const BAND_COLORS: Record<string, string> = {
  green: '#22c55e',
  teal: '#14b8a6',
  amber: '#f59e0b',
  red: '#ef4444',
}

// Stage badge styling — kept consistent with Tailwind tokens used elsewhere.
const STAGE_STYLES: Record<ClientLifecycleStage, string> = {
  prospect: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  active: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  churned: 'bg-gray-500/15 text-gray-400 border border-gray-500/30',
  archived: 'bg-white/5 text-gray-500 border border-white/10',
}

const STAGE_LABEL_KEYS: Record<ClientLifecycleStage, TranslationKey> = {
  prospect: 'clients.prospect_label',
  active: 'clients.active_label',
  churned: 'clients.churned_label',
  archived: 'clients.archived_label',
}

export default function ClientCard({
  id, name, domain, industry, status, lifecycle_stage, analyses_count, latest_score, latest_analysis_at, onDeleted,
}: ClientCardProps) {
  const { t, locale } = useLocale()
  const [deleting, setDeleting] = useState(false)
  const band = latest_score !== null ? getScoreBand(latest_score) : null
  const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  const stage: ClientLifecycleStage = lifecycle_stage ?? 'active'
  const stageClass = STAGE_STYLES[stage]
  const stageLabel = t(STAGE_LABEL_KEYS[stage])

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${id}?mode=hard`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(`Cancellazione fallita: ${data.error || res.statusText}`)
        setDeleting(false)
        return
      }
      onDeleted?.(id)
    } catch (err) {
      alert(`Errore di rete: ${err instanceof Error ? err.message : 'sconosciuto'}`)
      setDeleting(false)
    }
  }

  return (
    <Link href={`/clients/${id}`}>
      <div
        className={`group relative overflow-hidden rounded-xl border bg-card border-border transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 ${deleting ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {/* Top-right badges: lifecycle + (optional) archived marker + delete */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold font-mono ${stageClass}`}
          >
            {stageLabel}
          </span>
          {status === 'archived' && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-400">
              Archived
            </span>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Elimina definitivamente"
            aria-label={`Elimina ${name}`}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-6 h-6 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {/* Header: Name + Score */}
          <div className="flex items-start justify-between gap-3 mb-3 pr-20">
            <div className="min-w-0 flex-1">
              <h3
                className="font-semibold text-white text-[15px] truncate group-hover:text-[var(--lime)] transition-colors font-mono"
              >
                {name}
              </h3>
              {domain && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">{domain}</p>
              )}
            </div>
          </div>

          {/* Score badge row */}
          <div className="flex items-center gap-3 mb-3">
            <div
              className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold font-mono"
              style={{
                background: `${color}15`,
                color: color,
              }}
            >
              {latest_score ?? '—'}
            </div>
            {industry && (
              <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400">
                {industry}
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-[11px] text-gray-500 pt-3 border-t border-white/5">
            <span>{analyses_count} {t('clients.analysisCount')}</span>
            {latest_analysis_at && (
              <span>
                {t('clients.lastAnalysis')}: {formatLocalDate(latest_analysis_at, locale, { day: '2-digit', month: 'short' })}
              </span>
            )}
            {band && (
              <span style={{ color }}>{t(band.label as TranslationKey)}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
