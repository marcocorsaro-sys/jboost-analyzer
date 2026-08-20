'use client'

import { useState } from 'react'
import Link from 'next/link'

import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'

/**
 * 'Switch to client' — the real promotion (UX-UI Bibbia 04: "open the
 * analysis or promote ('switch to client')"; README 01 §9). Formerly a
 * disabled stub; now it is THE single mechanic that turns a prospect audit
 * into a client, calling POST /api/v4/analyses/[id]/promote.
 *
 * States:
 *   - linked (clientId set, from a past promotion or a wizard-picked
 *     client) → a discreet "Cliente" chip linking to the client panel.
 *   - idle → the button; click opens an inline confirm naming the client
 *     the promotion will create — no modal dependency, V1 pattern.
 *   - done → "Cliente creato" + link to the new client.
 *   - a 409 from the API (concurrent promotion) folds into the linked state.
 */
export default function SwitchToClientButton({
  analysisId,
  auditName,
  clientId,
}: {
  analysisId: string
  /** What the created client will be called (brand name, else domain). */
  auditName: string
  /** Already-linked client, when the audit is a client's audit already. */
  clientId?: string | null
}) {
  const { t } = useLocale()
  const [linkedId, setLinkedId] = useState<string | null>(clientId ?? null)
  const [justCreated, setJustCreated] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const promote = async () => {
    setPromoting(true)
    setError(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}/promote`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as {
        clientId?: string | null
        error?: string
      }
      if (res.status === 201 && body.clientId) {
        setLinkedId(body.clientId)
        setJustCreated(true)
        setConfirming(false)
      } else if (res.status === 409 && body.clientId) {
        // Someone (or another tab) promoted first: same end state.
        setLinkedId(body.clientId)
        setConfirming(false)
      } else {
        setError(body.error ?? `${t('audits.switch_error')} (${res.status})`)
      }
    } catch {
      setError(t('audits.switch_error'))
    } finally {
      setPromoting(false)
    }
  }

  if (linkedId) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {justCreated && (
          <span className="text-[13px]" style={{ color: B.success }}>
            {t('audits.switch_done')}
          </span>
        )}
        <Link
          href={`/clients/${linkedId}`}
          title={t('audits.client_badge_tooltip')}
          className="inline-block rounded-full px-2.5 py-1 text-[13px] font-semibold no-underline"
          style={{ background: B.primarySoft, color: B.primary }}
        >
          {t('audits.client_badge')}
        </Link>
      </span>
    )
  }

  if (confirming) {
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <span className="text-[13px] text-muted-foreground">
          {t('audits.switch_confirm').replace('{name}', auditName)}
        </span>
        <button
          type="button"
          onClick={promote}
          disabled={promoting}
          className="rounded-lg px-4 py-2 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: B.primary }}
        >
          {promoting ? t('audits.switch_working') : t('audits.switch_confirm_yes')}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          disabled={promoting}
          className="rounded-lg border border-border px-4 py-2 text-[14px] font-semibold text-muted-foreground disabled:opacity-60"
        >
          {t('audits.switch_cancel')}
        </button>
        {error && (
          <span className="text-[13px]" style={{ color: B.error }}>
            {error}
          </span>
        )}
      </span>
    )
  }

  return (
    <span title={t('audits.switch_tooltip')} className="inline-block">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-block rounded-lg border border-border px-4 py-2 text-[14px] font-semibold text-foreground transition-colors hover:bg-accent"
      >
        {t('audits.switch_to_client')}
      </button>
    </span>
  )
}
