'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n'

interface Status {
  linked: boolean
  bot: string
}
interface Code {
  code: string
  ttlMinutes: number
}

/** Settings > Telegram: link the signed-in account to the JBA bot with a one-time code. */
export default function TelegramLinkCard() {
  const { t } = useLocale()
  const [status, setStatus] = useState<Status | null>(null)
  const [code, setCode] = useState<Code | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/telegram/link-code', { cache: 'no-store' })
      if (res.ok) {
        const json = (await res.json()) as { linked: boolean; bot: string }
        setStatus({ linked: json.linked, bot: json.bot })
      }
    } catch {
      // card stays in its loading state
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function generate() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/telegram/link-code', { method: 'POST' })
      if (!res.ok) throw new Error('code')
      const json = (await res.json()) as { code: string; ttlMinutes: number; bot: string }
      setCode({ code: json.code, ttlMinutes: json.ttlMinutes })
      setStatus((s) => ({ linked: s?.linked ?? false, bot: json.bot }))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    try {
      await fetch('/api/telegram/link-code', { method: 'DELETE' })
      setCode(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-5 rounded-xl border bg-card p-6">
      <h2 className="mb-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">{t('tg.title')}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t('tg.hint')}</p>

      {status?.linked && <p className="mb-3 text-sm text-foreground">{t('tg.linked')}</p>}

      {code && (
        <div className="mb-3 rounded-lg bg-background px-3.5 py-3">
          <p className="mb-1 text-sm text-muted-foreground">{t('tg.send')}</p>
          <p className="font-mono text-lg font-semibold text-foreground">/collega {code.code}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('tg.expires').replace('{n}', String(code.ttlMinutes))}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="rounded-lg border border-border px-3.5 py-2 text-[14px] font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {status?.linked ? t('tg.regenerate') : t('tg.generate')}
        </button>
        {status && (
          <a
            href={`https://t.me/${status.bot}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border px-3.5 py-2 text-[14px] font-semibold text-foreground no-underline transition-colors hover:bg-accent"
          >
            {t('tg.open')}
          </a>
        )}
        {status?.linked && (
          <button
            type="button"
            disabled={busy}
            onClick={unlink}
            className="rounded-lg border border-border px-3.5 py-2 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {t('tg.unlink')}
          </button>
        )}
      </div>
      {failed && <p className="mt-2 text-sm text-muted-foreground">{t('tg.failed')}</p>}
    </div>
  )
}
