'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/analyzer')
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-10">
          <div className="font-mono text-xs tracking-widest uppercase" style={{ color: 'var(--lime-dim)' }}>
            // JBoost Analyzer
          </div>
          <h1 className="text-2xl font-bold mt-4" style={{ color: 'var(--white)' }}>
            Set New Password
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>New Password</label>
            <input type="password" value={password}
              onChange={e => setPassword(e.target.value)} required minLength={8}
              className="w-full px-4 py-3 rounded-lg text-sm outline-none"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--lime)' }}>Confirm Password</label>
            <input type="password" value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg text-sm outline-none"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--white)' }} />
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
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
