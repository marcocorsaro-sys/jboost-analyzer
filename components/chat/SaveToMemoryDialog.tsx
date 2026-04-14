'use client'

import { useState } from 'react'
import { useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { MemoryFactCategory } from '@/lib/types/client'

interface SaveToMemoryDialogProps {
  clientId: string
  messageId: string
  initialText: string
  onClose: () => void
  onSaved?: () => void
}

const CATEGORIES: MemoryFactCategory[] = [
  'business',
  'seo_performance',
  'technical',
  'content',
  'competitor',
  'martech',
  'contact',
  'timeline',
  'budget',
  'preference',
  'conversation_insight',
]

const MAX_LEN = 500

export default function SaveToMemoryDialog({
  clientId,
  messageId,
  initialText,
  onClose,
  onSaved,
}: SaveToMemoryDialogProps) {
  const { t } = useLocale()
  const [fact, setFact] = useState(() => initialText.slice(0, MAX_LEN))
  const [category, setCategory] = useState<MemoryFactCategory>('conversation_insight')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)

  const trimmed = fact.trim()
  const tooLong = trimmed.length > MAX_LEN
  const canSubmit = trimmed.length > 0 && !tooLong && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/clients/${clientId}/memory/save-fact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fact: trimmed,
          category,
          source_id: messageId,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t('chat.saveToMemoryError'))
        setSaving(false)
        return
      }

      setSavedOk(true)
      setSaving(false)
      onSaved?.()
      // Auto-close after brief success flash
      setTimeout(onClose, 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.saveToMemoryError'))
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-mono text-sm font-bold text-primary">
              {t('chat.saveToMemoryTitle')}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('chat.saveToMemorySubtitle')}
            </p>
          </div>

          <div className="px-5 py-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                {t('chat.selectCategory')}
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MemoryFactCategory)}
                disabled={saving}
                className="px-3 py-2 bg-background border border-border rounded-md text-foreground text-[13px] font-mono outline-none focus:border-primary"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`memory.category.${c}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-mono flex justify-between">
                <span>{t('chat.factLabel')}</span>
                <span className={cn(tooLong ? 'text-destructive' : 'text-muted-foreground')}>
                  {trimmed.length}/{MAX_LEN}
                </span>
              </span>
              <textarea
                value={fact}
                onChange={(e) => setFact(e.target.value)}
                disabled={saving}
                rows={5}
                maxLength={MAX_LEN + 50}
                className="px-3 py-2 bg-background border border-border rounded-md text-foreground text-[13px] outline-none focus:border-primary resize-y"
                placeholder={t('chat.factPlaceholder')}
              />
            </label>

            {tooLong && (
              <div className="text-[12px] text-destructive">{t('chat.factTooLong')}</div>
            )}
            {error && (
              <div className="px-3 py-2 bg-destructive/[0.08] border border-destructive/20 rounded-md text-destructive text-[12px]">
                {error}
              </div>
            )}
            {savedOk && (
              <div className="px-3 py-2 bg-primary/[0.08] border border-primary/20 rounded-md text-primary text-[12px]">
                {t('chat.saveToMemorySuccess')}
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-border flex justify-end gap-2 bg-background/50">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md border border-border bg-transparent text-muted-foreground text-[12px] font-bold font-mono cursor-pointer hover:bg-secondary/50 transition-colors"
            >
              {t('chat.cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'px-4 py-2 rounded-md border-none text-[12px] font-bold font-mono transition-colors',
                canSubmit
                  ? 'bg-primary text-background cursor-pointer hover:bg-primary/90'
                  : 'bg-secondary text-muted-foreground cursor-not-allowed'
              )}
            >
              {saving ? t('chat.saving') : t('chat.saveToMemory')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
