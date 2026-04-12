'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import type { ClientLifecycleStage } from '@/lib/types/client'

interface LifecycleActionsProps {
  clientId: string
  stage: ClientLifecycleStage
  subscriptionActive: boolean | null
  engagementStartedAt: string | null
  canEdit: boolean
  canManageOwners: boolean
}

/**
 * Lifecycle actions panel for the client detail page (Phase 4B).
 *
 * Replaces the legacy PromoteButton and adds: pause/resume monitoring,
 * mark-as-churned, reactivate, archive (soft delete), hard-delete (only
 * for prospects), and inline edit of engagement_started_at.
 *
 * The visible action set depends on the current lifecycle stage and the
 * caller's permissions:
 *   - canEdit       (owner | editor | admin) -> can use most actions
 *   - canManageOwners (owner | admin)        -> additionally can archive +
 *                                                hard-delete a prospect
 */
export default function LifecycleActions({
  clientId,
  stage,
  subscriptionActive,
  engagementStartedAt,
  canEdit,
  canManageOwners,
}: LifecycleActionsProps) {
  const router = useRouter()
  const { t } = useLocale()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState(false)
  const [dateValue, setDateValue] = useState(
    engagementStartedAt ? engagementStartedAt.slice(0, 10) : ''
  )

  // ─── Helper for action calls ─────────────────────────────────────────────
  async function call(
    action: string,
    method: 'POST' | 'DELETE',
    path: string,
    body?: object,
    confirmKey?: string
  ) {
    if (confirmKey && !window.confirm(t(confirmKey as 'clients.lifecycle_pause_confirm'))) {
      return
    }
    setError(null)
    setBusy(action)
    try {
      const init: RequestInit = { method }
      if (body) {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      const res = await fetch(path, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Action failed')
      // Hard delete redirects to the clients list since the row is gone.
      if (action === 'hard_delete') {
        router.push('/clients')
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setBusy(null)
    }
  }

  async function saveDate() {
    setError(null)
    setBusy('save_date')
    try {
      const iso = dateValue ? new Date(dateValue).toISOString() : null
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagement_started_at: iso }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save date')
      setEditingDate(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setBusy(null)
    }
  }

  // ─── Action availability per stage ───────────────────────────────────────
  const showActivate = stage === 'prospect' && canEdit
  const showHardDelete = stage === 'prospect' && canManageOwners
  const showPause = stage === 'active' && subscriptionActive === true && canEdit
  const showResume = stage === 'active' && subscriptionActive === false && canEdit
  const showChurn = stage === 'active' && canEdit
  const showReactivate = stage === 'churned' && canEdit
  const showArchive = stage !== 'archived' && canManageOwners
  const showDateEditor = stage === 'active' && canEdit
  const showPausedBadge = stage === 'active' && subscriptionActive === false

  // Don't render anything if there's literally nothing to show.
  if (
    !showActivate &&
    !showHardDelete &&
    !showPause &&
    !showResume &&
    !showChurn &&
    !showReactivate &&
    !showArchive &&
    !showDateEditor
  ) {
    return null
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {showPausedBadge && (
          <span
            style={{
              padding: '4px 10px',
              background: '#f59e0b15',
              color: '#f59e0b',
              border: '1px solid #f59e0b40',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {t('clients.lifecycle_paused_label')}
          </span>
        )}

        {showActivate && (
          <ActionButton
            label={t('clients.lifecycle_activate')}
            color="#22c55e"
            disabled={busy !== null}
            loading={busy === 'activate'}
            onClick={() => call('activate', 'POST', `/api/clients/${clientId}/promote`)}
          />
        )}
        {showResume && (
          <ActionButton
            label={t('clients.lifecycle_resume')}
            color="#22c55e"
            disabled={busy !== null}
            loading={busy === 'reactivate'}
            onClick={() =>
              call(
                'reactivate',
                'POST',
                `/api/clients/${clientId}/reactivate`,
                undefined,
                'clients.lifecycle_reactivate_confirm'
              )
            }
          />
        )}
        {showPause && (
          <ActionButton
            label={t('clients.lifecycle_pause')}
            color="#f59e0b"
            disabled={busy !== null}
            loading={busy === 'pause'}
            onClick={() =>
              call(
                'pause',
                'POST',
                `/api/clients/${clientId}/deactivate`,
                { mode: 'pause' },
                'clients.lifecycle_pause_confirm'
              )
            }
          />
        )}
        {showChurn && (
          <ActionButton
            label={t('clients.lifecycle_churn')}
            color="#ef4444"
            disabled={busy !== null}
            loading={busy === 'churn'}
            onClick={() =>
              call(
                'churn',
                'POST',
                `/api/clients/${clientId}/deactivate`,
                { mode: 'churn' },
                'clients.lifecycle_churn_confirm'
              )
            }
          />
        )}
        {showReactivate && (
          <ActionButton
            label={t('clients.lifecycle_reactivate')}
            color="#22c55e"
            disabled={busy !== null}
            loading={busy === 'reactivate'}
            onClick={() =>
              call(
                'reactivate',
                'POST',
                `/api/clients/${clientId}/reactivate`,
                undefined,
                'clients.lifecycle_reactivate_confirm'
              )
            }
          />
        )}
        {showArchive && (
          <ActionButton
            label={t('clients.lifecycle_archive')}
            color="#6b7280"
            disabled={busy !== null}
            loading={busy === 'archive'}
            onClick={() =>
              call(
                'archive',
                'DELETE',
                `/api/clients/${clientId}`,
                undefined,
                'clients.lifecycle_archive_confirm'
              )
            }
          />
        )}
        {showHardDelete && (
          <ActionButton
            label={t('clients.lifecycle_hard_delete')}
            color="#ef4444"
            disabled={busy !== null}
            loading={busy === 'hard_delete'}
            onClick={() =>
              call(
                'hard_delete',
                'DELETE',
                `/api/clients/${clientId}?mode=hard`,
                undefined,
                'clients.lifecycle_hard_delete_confirm'
              )
            }
          />
        )}
      </div>

      {showDateEditor && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            color: '#6b7280',
          }}
        >
          {editingDate ? (
            <>
              <input
                type="date"
                value={dateValue}
                onChange={e => setDateValue(e.target.value)}
                style={{
                  padding: '4px 8px',
                  background: '#1a1c24',
                  border: '1px solid #2a2d35',
                  borderRadius: '4px',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                onClick={saveDate}
                disabled={busy !== null}
                style={{
                  padding: '4px 10px',
                  background: '#22c55e',
                  color: '#111318',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: busy ? 'default' : 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {t('clients.lifecycle_save_date')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingDate(false)
                  setDateValue(engagementStartedAt ? engagementStartedAt.slice(0, 10) : '')
                }}
                disabled={busy !== null}
                style={{
                  padding: '4px 10px',
                  background: 'transparent',
                  color: '#6b7280',
                  border: '1px solid #2a2d35',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {t('clients.team_cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditingDate(true)}
              style={{
                padding: '2px 8px',
                background: 'transparent',
                color: '#6b7280',
                border: '1px solid #2a2d35',
                borderRadius: '4px',
                fontSize: '10px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {t('clients.lifecycle_edit_date')}
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '6px 10px',
            background: '#ef444415',
            border: '1px solid #ef444440',
            borderRadius: '4px',
            color: '#ef4444',
            fontSize: '11px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function ActionButton({
  label,
  color,
  loading,
  disabled,
  onClick,
}: {
  label: string
  color: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 14px',
        background: loading || disabled ? '#2a2d35' : color,
        color: loading || disabled ? '#6b7280' : '#111318',
        border: 'none',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
      }}
    >
      {loading ? '...' : label}
    </button>
  )
}
