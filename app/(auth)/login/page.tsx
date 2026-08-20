'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n'
import LocaleSwitcher from '@/components/ui/LocaleSwitcher'
import BrandHero from '@/components/layout/BrandHero'
import { B } from '@/lib/brand'

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

    router.push('/home')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: B.bg }}>
      {/* Language switcher - top right */}
      <div style={{ position: 'absolute', top: '16px', right: '16px' }}>
        <LocaleSwitcher />
      </div>

      <div className="w-full max-w-md p-8">
        {/* JAKALA hero band as the login masthead */}
        <BrandHero
          className="mb-8"
          height={170}
          title="J·Boost Analyzer"
          subtitle="SEO/GEO Analysis Platform"
        />

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: B.primary }}>{t('auth.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-ring"
              style={{ background: B.bg, border: `1px solid ${B.border}`, color: B.ink }}
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: B.primary }}>{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-ring"
              style={{ background: B.bg, border: `1px solid ${B.border}`, color: B.ink }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg text-sm"
              style={{ background: `${B.error}10`, border: `1px solid ${B.error}30`, color: B.error }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-lg text-sm font-bold uppercase tracking-widest"
            style={{
              background: loading ? B.surface2 : B.primary,
              color: loading ? B.muted : B.onPrimary,
            }}
          >
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link href="/forgot-password" className="text-xs" style={{ color: B.primary }}>
            {t('auth.forgotPassword')}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <LoginForm />
}
