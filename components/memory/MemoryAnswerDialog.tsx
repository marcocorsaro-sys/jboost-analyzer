'use client'

import { useState } from 'react'
import type { MemoryGap } from '@/lib/types/client'
import { useLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface MemoryAnswerDialogProps {
  gap: MemoryGap
  clientId: string
  onClose: () => void
  onAnswered: () => void
}

export default function MemoryAnswerDialog({
  gap,
  clientId,
  onClose,
  onAnswered,
}: MemoryAnswerDialogProps) {
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useLocale()

  const handleSubmit = async () => {
    if (!answer.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/clients/${clientId}/memory/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gap_id: gap.id,
          question: gap.question,
          answer: answer.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('memory.saveError'))
      }

      onAnswered()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('memory.unknownError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card rounded-2xl border border-border p-6 max-w-[520px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-mono text-sm font-bold text-primary mb-1">
              {t('memory.completeMemory')}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t('memory.answerSaved')}
            </div>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-muted-foreground text-lg cursor-pointer p-1"
          >
            ×
          </button>
        </div>

        {/* Question */}
        <div className="p-3 px-4 bg-background rounded-lg border border-border mb-4">
          <div className="text-[11px] text-muted-foreground mb-1 font-mono uppercase tracking-wide">
            {t('memory.question')}
          </div>
          <div className="text-sm text-foreground/90 leading-normal">
            {gap.question}
          </div>
          {gap.context && (
            <div className="text-[11px] text-muted-foreground mt-1.5 italic">
              {gap.context}
            </div>
          )}
        </div>

        {/* Answer textarea */}
        <div className="mb-4">
          <label className="block text-[11px] text-muted-foreground mb-1.5 font-mono uppercase tracking-wide">
            {t('memory.yourAnswer')}
          </label>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t('memory.answerPlaceholder')}
            rows={4}
            className="w-full p-3 px-4 bg-background border border-border rounded-lg text-white text-sm resize-y outline-none leading-normal font-[inherit] focus:border-primary transition-colors"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 bg-destructive/[0.08] border border-destructive/20 rounded-lg text-xs text-destructive mb-4">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-secondary text-muted-foreground border-none rounded-lg text-xs font-semibold font-mono cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !answer.trim()}
            className={cn(
              'px-5 py-2.5 border-none rounded-lg text-xs font-bold font-mono transition-all duration-200',
              submitting || !answer.trim()
                ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-background cursor-pointer'
            )}
          >
            {submitting ? t('memory.savingAnswer') : t('memory.saveAnswer')}
          </button>
        </div>
      </div>
    </div>
  )
}
