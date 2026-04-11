'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

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
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-10">
          <div className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--lime-dim)' }}>
            // JBoost Analyzer
          </div>
          <h1 className="text-2xl font-bold mt-4" style={{ color: 'var(--white)' }}>
            Reset Password
          </h1>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="status-bar mb-4">Check your email for a reset link</div>
            <Link href="/login" className="text-sm" style={{ color: 'var(--teal)' }}>
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--lime)' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }}
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
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <div className="text-center">
              <Link href="/login" className="text-xs" style={{ color: 'var(--teal)' }}>Back to login</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
