'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ClientMemory, ClientMemoryStatus, MemoryGap } from '@/lib/types/client'

interface MemoryMainCardProps {
  clientId: string
}

const STATUS_COLORS: Record<ClientMemoryStatus, string> = {
  empty:      '#6b7280',
  building:   '#f59e0b',
  refreshing: '#f59e0b',
  ready:      '#c8e64a',
  stale:      '#f59e0b',
  failed:     '#ef4444',
}

/**
 * Compact memory card mounted on /clients/[id] (Phase 5D).
 *
 * Goal: make the client memory the second thing the user sees on the
 * client detail page (right after the lifecycle banner). Shows status +
 * completeness + the top 3 open gaps as quick links to the full memory
 * page where they can be answered.
 *
 * Polls /api/clients/[id]/memory every 4s while status is building or
 * refreshing so the user sees the state change without reloading the
 * page. No realtime channel because the polling cadence is short and
 * the row is read-only at this layer.
 */
export default function MemoryMainCard({ clientId }: MemoryMainCardProps) {
  const { t } = useLocale()
  const [memory, setMemory] = useState<ClientMemory | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/memory`)
      const data = await res.json()
      if (res.ok && data.memory) {
        setMemory(data.memory)
      }
    } catch (err) {
      console.error('[MemoryMainCard] load failed', err)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  // Poll while a refresh is in flight so the UI stays current.
  useEffect(() => {
    if (!memory) return
    const transient = memory.status === 'building' || memory.status === 'refreshing'
    if (!transient) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [memory, load])

  async function handleQuickRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/memory/refresh`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Refresh failed')
      // Status will be 'refreshing' on the next poll. Force one immediate load.
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 mb-6 text-xs text-muted-foreground">
        ⟳ {t('memory.clientMemory')}...
      </div>
    )
  }

  const status: ClientMemoryStatus = memory?.status ?? 'empty'
  const completeness = memory?.completeness ?? 0
  const topGaps: MemoryGap[] = (memory?.gaps ?? [])
    .slice()
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 } as const
      return order[a.importance] - order[b.importance]
    })
    .slice(0, 3)

  const statusColor = STATUS_COLORS[status]
  const isWorking =
    status === 'building' || status === 'refreshing' || refreshing
  const isStaleOrEmpty = status === 'stale' || status === 'empty'

  return (
    <div className="bg-card rounded-xl border border-border p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full inline-block',
              isWorking && 'animate-pulse'
            )}
            style={{ background: statusColor }}
          />
          <span className="font-mono text-[12px] font-semibold text-primary uppercase tracking-wider">
            🧠 {t('memory.clientMemory')}
          </span>
          <span
            className="font-mono text-[11px] font-semibold"
            style={{ color: statusColor }}
          >
            {t(
              `memory.status${status.charAt(0).toUpperCase() + status.slice(1)}` as
                | 'memory.statusReady'
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {memory && memory.status !== 'empty' && (
            <span className="font-mono text-xs text-muted-foreground">
              {completeness}%
            </span>
          )}
          <button
            type="button"
            onClick={handleQuickRefresh}
            disabled={isWorking}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-bold font-mono uppercase tracking-wide border',
              isWorking
                ? 'border-border bg-secondary text-muted-foreground cursor-not-allowed'
                : isStaleOrEmpty
                ? 'border-amber-500/40 bg-amber-500/[0.08] text-amber-500 cursor-pointer'
                : 'border-border bg-background text-muted-foreground cursor-pointer'
            )}
          >
            {isWorking
              ? '...'
              : status === 'empty'
              ? t('memory.buildMemory')
              : t('memory.refreshMemory')}
          </button>
        </div>
      </div>

      {/* Completeness bar — only when memory is real */}
      {memory && memory.status !== 'empty' && (
        <div className="h-1 bg-background rounded-full overflow-hidden mb-3">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              completeness >= 75
                ? 'bg-primary'
                : completeness >= 40
                ? 'bg-amber-500'
                : 'bg-destructive'
            )}
            style={{ width: `${completeness}%` }}
          />
        </div>
      )}

      {/* Top open gaps */}
      {topGaps.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('memory.topGaps')}
          </div>
          <ul className="space-y-1">
            {topGaps.map(g => (
              <li
                key={g.id}
                className="flex items-start gap-2 text-[12px] text-muted-foreground"
              >
                <span
                  className={cn(
                    'mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0',
                    g.importance === 'high'
                      ? 'bg-destructive'
                      : g.importance === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-muted-foreground'
                  )}
                />
                <span className="leading-snug">{g.question}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Empty state */}
      {(!memory || memory.status === 'empty') && (
        <div className="text-[12px] text-muted-foreground">
          {t('memory.noMemoryYet')}
        </div>
      )}

      {/* Error */}
      {(error || memory?.error_message) && (
        <div className="mt-3 px-2.5 py-1.5 bg-destructive/[0.08] border border-destructive/20 rounded text-[11px] text-destructive">
          {error || memory?.error_message}
        </div>
      )}

      <div className="mt-3 text-right">
        <Link
          href={`/clients/${clientId}/knowledge`}
          className="text-[11px] font-mono text-primary hover:underline"
        >
          {t('memory.viewFullMemory')}
        </Link>
      </div>
    </div>
  )
}
