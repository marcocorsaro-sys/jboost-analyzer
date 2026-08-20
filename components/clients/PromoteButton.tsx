'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'

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
          background: loading ? B.border : B.success,
          color: loading ? B.muted : B.bg,
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 700,
          cursor: loading ? 'default' : 'pointer',
          fontFamily: B.fontMono,
        }}
      >
        {loading ? t('common.loading') : t('clients.promote_to_active')}
      </button>
      {success && (
        <div style={{ fontSize: '12px', color: B.success }}>
          {t('clients.promoted_success')}
        </div>
      )}
      {error && (
        <div style={{ fontSize: '12px', color: B.error }}>
          {error}
        </div>
      )}
    </div>
  )
}
