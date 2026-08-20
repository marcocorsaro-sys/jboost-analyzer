'use client'

import { useEffect, useState, useCallback } from 'react'
import { useLocale } from '@/lib/i18n'
import type { ClientMemberRole, ClientMemberWithProfile } from '@/lib/types/client'
import { B } from '@/lib/brand'

interface TeamPanelProps {
  clientId: string
  currentUserId: string
  isAdmin: boolean
}

const ROLE_COLORS: Record<ClientMemberRole, { bg: string; fg: string }> = {
  owner: { bg: B.primarySoft, fg: B.primary },
  editor: { bg: `${B.info}15`, fg: B.info },
  viewer: { bg: `${B.muted}15`, fg: B.muted },
}

const VALID_ROLES: ClientMemberRole[] = ['owner', 'editor', 'viewer']

/**
 * Multi-tenant team & sharing panel for the client detail page (Phase 4A).
 *
 * - Lists everyone with access (owner / editor / viewer).
 * - Owners (and global admins) can invite by email, change roles, and remove
 *   members. Other members see a read-only view.
 * - Last-owner protection is enforced server-side; we just surface the error.
 */
export default function TeamPanel({ clientId, currentUserId, isAdmin }: TeamPanelProps) {
  const { t } = useLocale()

  const [members, setMembers] = useState<ClientMemberWithProfile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<ClientMemberRole>('editor')
  const [submitting, setSubmitting] = useState(false)

  // Whether the current user is allowed to mutate this team. Owners always
  // can. Global admins always can. Editors/viewers cannot.
  const myMembership = members?.find(m => m.user_id === currentUserId) ?? null
  const canManage = isAdmin || myMembership?.role === 'owner'

  // ─── Load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/members`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load members')
      setMembers(data.members ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  // ─── Mutations ───────────────────────────────────────────────────────────
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add member')
      setAddEmail('')
      setAddRole('editor')
      setAdding(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRoleChange(userId: string, newRole: ClientMemberRole) {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change role')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function handleRemove(userId: string) {
    if (!window.confirm(t('clients.team_remove_confirm'))) return
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/members/${userId}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to remove member')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: B.surface,
        borderRadius: '12px',
        border: `1px solid ${B.border}`,
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: B.fontMono,
              fontSize: '13px',
              fontWeight: 600,
              color: B.primary,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              margin: 0,
            }}
          >
            {t('clients.team_title')}
          </h3>
          <div style={{ fontSize: '12px', color: B.muted, marginTop: '4px' }}>
            {t('clients.team_subtitle')}
          </div>
        </div>
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              padding: '8px 14px',
              background: B.primary,
              color: B.bg,
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: B.fontMono,
            }}
          >
            {t('clients.team_add_member')}
          </button>
        )}
      </div>

      {/* Add member form */}
      {adding && (
        <form
          onSubmit={handleAdd}
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            padding: '12px',
            background: B.bg,
            border: `1px solid ${B.border}`,
            borderRadius: '8px',
            marginBottom: '12px',
          }}
        >
          <input
            type="email"
            required
            value={addEmail}
            onChange={e => setAddEmail(e.target.value)}
            placeholder={t('clients.team_email_placeholder')}
            disabled={submitting}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: B.surface,
              border: `1px solid ${B.border}`,
              borderRadius: '6px',
              color: B.ink,
              fontSize: '13px',
              fontFamily: 'inherit',
            }}
          />
          <select
            value={addRole}
            onChange={e => setAddRole(e.target.value as ClientMemberRole)}
            disabled={submitting}
            style={{
              padding: '8px 12px',
              background: B.surface,
              border: `1px solid ${B.border}`,
              borderRadius: '6px',
              color: B.ink,
              fontSize: '13px',
              fontFamily: 'inherit',
            }}
          >
            {VALID_ROLES.map(r => (
              <option key={r} value={r}>
                {t(`clients.team_role_${r}` as 'clients.team_role_owner')}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitting || !addEmail.trim()}
            style={{
              padding: '8px 14px',
              background: submitting ? B.border : B.success,
              color: submitting ? B.muted : B.bg,
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: submitting ? 'default' : 'pointer',
              fontFamily: B.fontMono,
            }}
          >
            {t('clients.team_invite_submit')}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false)
              setAddEmail('')
              setError(null)
            }}
            disabled={submitting}
            style={{
              padding: '8px 14px',
              background: B.border,
              color: B.muted,
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('clients.team_cancel')}
          </button>
        </form>
      )}

      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: `${B.error}15`,
            border: `1px solid ${B.error}40`,
            borderRadius: '6px',
            color: B.error,
            fontSize: '12px',
            marginBottom: '12px',
          }}
        >
          {error}
        </div>
      )}

      {/* Members list */}
      {loading ? (
        <div style={{ color: B.muted, fontSize: '13px' }}>{t('clients.team_loading')}</div>
      ) : members && members.length === 0 ? (
        <div style={{ color: B.muted, fontSize: '13px' }}>{t('clients.team_empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {members?.map(m => {
            const colors = ROLE_COLORS[m.role]
            const displayName = m.full_name || m.email || m.user_id.slice(0, 8)
            const isMe = m.user_id === currentUserId
            const initial = (displayName[0] || '?').toUpperCase()

            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  background: B.bg,
                  borderRadius: '8px',
                }}
              >
                {/* Avatar / initial */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: colors.bg,
                    color: colors.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 700,
                    fontFamily: B.fontMono,
                    flexShrink: 0,
                  }}
                >
                  {initial}
                </div>
                {/* Name + email */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: B.ink,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {displayName}
                    {isMe && (
                      <span style={{ marginLeft: '6px', color: B.muted, fontWeight: 400 }}>
                        {t('clients.team_you_label')}
                      </span>
                    )}
                  </div>
                  {m.email && m.email !== displayName && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: B.muted,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m.email}
                    </div>
                  )}
                </div>
                {/* Role */}
                {canManage ? (
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.user_id, e.target.value as ClientMemberRole)}
                    style={{
                      padding: '4px 8px',
                      background: colors.bg,
                      color: colors.fg,
                      border: `1px solid ${colors.fg}40`,
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      fontFamily: B.fontMono,
                      cursor: 'pointer',
                    }}
                  >
                    {VALID_ROLES.map(r => (
                      <option key={r} value={r}>
                        {t(`clients.team_role_${r}` as 'clients.team_role_owner')}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    style={{
                      padding: '4px 10px',
                      background: colors.bg,
                      color: colors.fg,
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      fontFamily: B.fontMono,
                    }}
                  >
                    {t(`clients.team_role_${m.role}` as 'clients.team_role_owner')}
                  </span>
                )}
                {/* Remove */}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleRemove(m.user_id)}
                    title={t('clients.team_remove')}
                    style={{
                      padding: '4px 8px',
                      background: 'transparent',
                      color: B.muted,
                      border: `1px solid ${B.border}`,
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!canManage && !loading && (
        <div style={{ marginTop: '12px', fontSize: '11px', color: B.muted, fontStyle: 'italic' }}>
          {t('clients.team_only_owner_can_manage')}
        </div>
      )}
    </div>
  )
}
