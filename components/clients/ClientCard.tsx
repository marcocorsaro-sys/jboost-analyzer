'use client'

import Link from 'next/link'
import { getScoreBand } from '@/lib/constants'
import type { ClientLifecycleStage } from '@/lib/types/client'
import { useLocale } from '@/lib/i18n'
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
  id, name, domain, industry, status, lifecycle_stage, analyses_count, latest_score, latest_analysis_at,
}: ClientCardProps) {
  const { t } = useLocale()
  const band = latest_score !== null ? getScoreBand(latest_score) : null
  const color = band ? BAND_COLORS[band.color] ?? '#6b7280' : '#6b7280'

  const stage: ClientLifecycleStage = lifecycle_stage ?? 'active'
  const stageClass = STAGE_STYLES[stage]
  const stageLabel = t(STAGE_LABEL_KEYS[stage])

  return (
    <Link href={`/clients/${id}`}>
      <div
        className="group relative overflow-hidden rounded-xl border transition-all duration-200 hover:border-[var(--lime)]/30 hover:shadow-lg hover:shadow-[var(--lime)]/5"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Top-right badges: lifecycle + (optional) archived marker */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold ${stageClass}`}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {stageLabel}
          </span>
          {status === 'archived' && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-400">
              Archived
            </span>
          )}
        </div>

        <div className="p-5">
          {/* Header: Name + Score */}
          <div className="flex items-start justify-between gap-3 mb-3 pr-20">
            <div className="min-w-0 flex-1">
              <h3
                className="font-semibold text-white text-[15px] truncate group-hover:text-[var(--lime)] transition-colors"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
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
              className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
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
            <span>{analyses_count} {analyses_count === 1 ? 'analisi' : 'analisi'}</span>
            {latest_analysis_at && (
              <span>
                Ultima: {new Date(latest_analysis_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
              </span>
            )}
            {band && (
              <span style={{ color }}>{band.label}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
