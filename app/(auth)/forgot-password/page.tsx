'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { LocaleProvider, useLocale } from '@/lib/i18n'
import LocaleSwitcher from '@/components/ui/LocaleSwitcher'

function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { t } = useLocale()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      {/* Language switcher - top right */}
      <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
        <LocaleSwitcher />
      </div>

      <div className="w-full max-w-md p-8">
        <div className="text-center mb-10">
          <div className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--lime-dim)' }}>
            // JBoost Analyzer
          </div>
          <h1 className="text-2xl font-bold mt-4" style={{ color: 'var(--white)' }}>
            {t('auth.resetPassword')}
          </h1>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="status-bar mb-4">Check your email for a reset link</div>
            <Link href="/login" className="text-sm" style={{ color: 'var(--teal)' }}>
              {t('auth.backToLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--lime)' }}>{t('auth.email')}</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg text-sm"
                style={{ background: 'rgba(239, 68, 68, 0.08)', color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-lg text-sm font-bold uppercase tracking-widest"
              style={{ background: 'var(--lime)', color: 'var(--bg)' }}>
              {loading ? t('auth.sending') : t('auth.sendResetLink')}
            </button>

            <div className="text-center">
              <Link href="/login" className="text-xs" style={{ color: 'var(--teal)' }}>{t('auth.backToLogin')}</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <LocaleProvider>
      <ForgotPasswordForm />
    </LocaleProvider>
  )
}
