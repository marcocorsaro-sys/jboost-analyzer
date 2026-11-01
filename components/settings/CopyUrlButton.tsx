'use client'

import { useState } from 'react'
import { useLocale } from '@/lib/i18n'

export default function CopyUrlButton({ value }: { value: string }) {
  const { t } = useLocale()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1800)
        } catch {
          // clipboard unavailable: the URL stays selectable in the field
        }
      }}
      className="rounded-lg border border-border px-3.5 py-2 text-[14px] font-semibold text-foreground transition-colors hover:bg-accent"
    >
      {done ? t('mcp.copied') : t('mcp.copy')}
    </button>
  )
}
