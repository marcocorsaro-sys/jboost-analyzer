'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LocaleProvider, useLocale } from '@/lib/i18n'
import LocaleSwitcher from '@/components/ui/LocaleSwitcher'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { t } = useLocale()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Log login activity (fire-and-forget)
    fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login' }),
    }).catch(() => {})

    router.push('/analyzer')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      {/* Language switcher - top right */}
      <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
        <LocaleSwitcher />
      </div>

      <div className="w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--lime-dim)' }}>
            // JBoost
          </div>
          <h1 className="text-3xl font-black mt-2" style={{ color: 'var(--lime)' }}>
            Analyzer
          </h1>
          <p className="text-sm mt-2" style={{ color: 'var(--gray)' }}>
            SEO/GEO Analysis Platform
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
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
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm outline-none"
              style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'var(--white)' }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg text-sm"
              style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--red)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-lg text-sm font-bold uppercase tracking-widest"
            style={{
              background: loading ? 'var(--card2)' : 'var(--lime)',
              color: loading ? 'var(--gray)' : 'var(--bg)',
            }}
          >
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link href="/forgot-password" className="text-xs" style={{ color: 'var(--teal)' }}>
            {t('auth.forgotPassword')}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <LocaleProvider>
      <LoginForm />
    </LocaleProvider>
  )
}
