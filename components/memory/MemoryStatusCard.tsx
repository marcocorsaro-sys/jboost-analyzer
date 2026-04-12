'use client'

import { useState } from 'react'
import type { ClientMemoryStatus } from '@/lib/types/client'
import { useLocale, formatLocalDate } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface MemoryStatusCardProps {
  status: ClientMemoryStatus
  completeness: number
  lastRefreshedAt: string | null
  errorMessage: string | null
  factsCount: number
  gapsCount: number
  onRefresh: () => Promise<void>
  onViewMemory: () => void
}

export default function MemoryStatusCard({
  status,
  completeness,
  lastRefreshedAt,
  errorMessage,
  factsCount,
  gapsCount,
  onRefresh,
  onViewMemory,
}: MemoryStatusCardProps) {
  const [refreshing, setRefreshing] = useState(false)
  const { t, locale } = useLocale()

  const statusLabels: Record<ClientMemoryStatus, string> = {
    empty: t('memory.statusEmpty'),
    building: t('memory.statusBuilding'),
    ready: t('memory.statusReady'),
    refreshing: t('memory.statusRefreshing'),
    failed: t('memory.statusFailed'),
  }

  const statusColors: Record<ClientMemoryStatus, string> = {
    empty: '#6b7280',
    building: '#f59e0b',
    ready: '#c8e64a',
    refreshing: '#f59e0b',
    failed: '#ef4444',
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const isWorking = status === 'building' || status === 'refreshing' || refreshing

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return t('memory.now')
    if (diffMins < 60) return `${diffMins} ${t('memory.minAgo')}`
    if (diffHours < 24) return `${diffHours} ${t('memory.hoursAgo')}`
    if (diffDays < 7) return `${diffDays} ${t('memory.daysAgo')}`
    return formatLocalDate(dateStr, locale)
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10 text-base">
            🧠
          </span>
          <div>
            <div className="font-mono text-sm font-bold text-primary">
              {t('memory.clientMemory')}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t('memory.aiDossier')}
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-1 text-[11px] font-semibold font-mono"
          style={{ color: statusColors[status] }}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full inline-block',
              isWorking && 'animate-pulse'
            )}
            style={{ background: statusColors[status] }}
          />
          {statusLabels[status]}
        </div>
      </div>

      {/* Completeness bar */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-muted-foreground">{t('memory.completeness')}</span>
          <span className="text-xs font-bold text-primary font-mono">
            {completeness}%
          </span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-out',
              completeness >= 75
                ? 'bg-primary'
                : completeness >= 40
                  ? 'bg-amber'
                  : 'bg-destructive'
            )}
            style={{ width: `${completeness}%` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 mb-4 text-xs text-muted-foreground">
        <span>
          <strong className="text-muted-foreground/80">{factsCount}</strong> {t('memory.facts')}
        </span>
        <span>
          <strong className={gapsCount > 0 ? 'text-amber' : 'text-muted-foreground/80'}>
            {gapsCount}
          </strong>{' '}
          {t('memory.gaps')}
        </span>
        {lastRefreshedAt && (
          <span>
            {t('memory.updated')}:{' '}
            <strong className="text-muted-foreground/80">{formatDate(lastRefreshedAt)}</strong>
          </span>
        )}
      </div>

      {/* Error message */}
      {status === 'failed' && errorMessage && (
        <div className="px-3 py-2 bg-destructive/[0.08] border border-destructive/20 rounded-lg text-xs text-destructive mb-4">
          {errorMessage}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleRefresh}
          disabled={isWorking}
          className={cn(
            'flex-1 px-4 py-2.5 border-none rounded-lg text-xs font-bold font-mono',
            'flex items-center justify-center gap-1.5 transition-all duration-200',
            isWorking
              ? 'bg-secondary text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-background cursor-pointer'
          )}
        >
          {isWorking ? (
            <>
              <span className="inline-block animate-spin">⟳</span>
              {status === 'empty' ? t('memory.building') : t('memory.refreshing')}
            </>
          ) : (
            <>
              🔄 {status === 'empty' ? t('memory.buildMemory') : t('memory.refreshMemory')}
            </>
          )}
        </button>

        {status === 'ready' && (
          <button
            onClick={onViewMemory}
            className="px-4 py-2.5 bg-secondary text-muted-foreground border-none rounded-lg text-xs font-semibold font-mono cursor-pointer transition-all duration-200"
          >
            👁 {t('memory.view')}
          </button>
        )}
      </div>
    </div>
  )
}
