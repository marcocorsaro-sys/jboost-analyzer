'use client'

import type { MemoryGap } from '@/lib/types/client'
import { useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface MemoryGapsListProps {
  gaps: MemoryGap[]
  onAnswerGap: (gap: MemoryGap) => void
}

export default function MemoryGapsList({ gaps, onAnswerGap }: MemoryGapsListProps) {
  const { t } = useLocale()

  if (gaps.length === 0) return null

  const importanceBadge = (importance: string) => {
    const config: Record<string, { bgClass: string; textClass: string; label: string }> = {
      high: { bgClass: 'bg-destructive/10', textClass: 'text-destructive', label: t('memory.importanceHigh') },
      medium: { bgClass: 'bg-amber/10', textClass: 'text-amber', label: t('memory.importanceMedium') },
      low: { bgClass: 'bg-muted-foreground/10', textClass: 'text-muted-foreground', label: t('memory.importanceLow') },
    }
    const c = config[importance] || config.low

    return (
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-[9px] font-bold font-mono tracking-wide',
          c.bgClass,
          c.textClass
        )}
      >
        {c.label}
      </span>
    )
  }

  // Sort: high first, then medium, then low
  const sorted = [...gaps].sort((a, b) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
    return (order[a.importance] ?? 2) - (order[b.importance] ?? 2)
  })

  return (
    <div className="bg-card rounded-xl border border-border px-5 py-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[13px] font-semibold text-amber font-mono">
          {t('memory.missingInfo')} ({gaps.length})
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {sorted.map(gap => (
          <div
            key={gap.id}
            className="flex items-start justify-between gap-3 p-2.5 px-3 bg-background rounded-lg border border-border"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {importanceBadge(gap.importance)}
                <span className="text-xs text-muted-foreground capitalize">
                  {gap.category.replace('_', ' ')}
                </span>
              </div>
              <div className="text-[13px] text-foreground/90 leading-relaxed">
                {gap.question}
              </div>
              {gap.context && (
                <div className="text-[11px] text-muted-foreground mt-1 italic">
                  {gap.context}
                </div>
              )}
            </div>

            <button
              onClick={() => onAnswerGap(gap)}
              className="px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-md text-[11px] font-semibold font-mono cursor-pointer whitespace-nowrap transition-all duration-200 hover:bg-primary/20"
            >
              {t('memory.answer')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
