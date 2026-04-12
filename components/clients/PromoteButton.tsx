'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'

interface PromoteButtonProps {
  clientId: string
}

/**
 * Admin-only CTA shown on a prospect's detail page to promote it to 'active'.
 * Calls POST /api/clients/[id]/promote and on success refreshes the page so
 * the server component picks up the new lifecycle_stage.
 */
export default function PromoteButton({ clientId }: PromoteButtonProps) {
  const router = useRouter()
  const { t } = useLocale()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleClick = async () => {
    // Simple confirm using native dialog so we avoid pulling in a modal lib.
    if (!window.confirm(t('clients.promote_confirm'))) return

    setError(null)
    setSuccess(false)
    setLoading(true)

    try {
      const res = await fetch(`/api/clients/${clientId}/promote`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Promotion failed')
      }
      setSuccess(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        style={{
          padding: '10px 20px',
          background: loading ? '#2a2d35' : '#22c55e',
          color: loading ? '#6b7280' : '#111318',
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 700,
          cursor: loading ? 'default' : 'pointer',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {loading ? t('common.loading') : t('clients.promote_to_active')}
      </button>
      {success && (
        <div style={{ fontSize: '12px', color: '#22c55e' }}>
          {t('clients.promoted_success')}
        </div>
      )}
      {error && (
        <div style={{ fontSize: '12px', color: '#ef4444' }}>
          {error}
        </div>
      )}
    </div>
  )
}
