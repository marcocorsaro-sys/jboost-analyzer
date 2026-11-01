'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import BrandHero from '@/components/layout/BrandHero'
import { B } from '@/lib/brand'

type Props =
  | { state: 'invalid' }
  | { state: 'redirect'; redirectUrl: string }
  | { state: 'ask'; authorizationId: string; clientName: string; email: string }

export default function ConsentForm(props: Props) {
  const { t } = useLocale()
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.state === 'redirect') window.location.href = props.redirectUrl
  }, [props])

  async function decide(decision: 'approve' | 'deny') {
    if (props.state !== 'ask') return
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch('/api/oauth/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorization_id: props.authorizationId, decision }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.redirect_url) throw new Error(json.error || t('oauth.error'))
      window.location.href = json.redirect_url
    } catch (e) {
      setError(e instanceof Error ? e.message : t('oauth.error'))
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: B.bg }}>
      <div className="w-full max-w-lg p-8">
        <BrandHero className="mb-10" height={160} title="J·Boost Analyzer" subtitle={t('oauth.title')} />

        {props.state === 'invalid' && (
          <div className="p-4 rounded-xl text-[15px]" style={{ background: `${B.error}10`, border: `1px solid ${B.error}30`, color: B.error }}>
            {t('oauth.invalid')}
          </div>
        )}

        {props.state === 'redirect' && <p className="text-[15px]" style={{ color: B.muted }}>{t('oauth.working')}</p>}

        {props.state === 'ask' && (
          <div className="space-y-6">
            <p className="text-[16px]" style={{ color: B.ink }}>
              <strong>{props.clientName}</strong> {t('oauth.wants')} <strong>{props.email}</strong>.
            </p>
            <p className="text-[14px]" style={{ color: B.muted }}>{t('oauth.can')}</p>

            {error && (
              <div className="p-4 rounded-xl text-[15px]" style={{ background: `${B.error}10`, border: `1px solid ${B.error}30`, color: B.error }}>
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => decide('approve')}
                disabled={busy !== null}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-bold transition-opacity hover:opacity-90"
                style={{ background: busy ? B.surface2 : B.primary, color: busy ? B.muted : B.onPrimary }}
              >
                {busy === 'approve' ? t('oauth.working') : t('oauth.approve')}
              </button>
              <button
                onClick={() => decide('deny')}
                disabled={busy !== null}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-bold transition-opacity hover:opacity-90"
                style={{ background: 'transparent', border: `1px solid ${B.border}`, color: B.ink }}
              >
                {busy === 'deny' ? t('oauth.working') : t('oauth.deny')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
