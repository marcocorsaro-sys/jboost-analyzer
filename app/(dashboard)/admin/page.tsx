'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useLocale, formatLocalDate } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────
interface UserProfile {
  id: string
  full_name: string | null
  company: string | null
  role: string
  is_active: boolean
  created_at: string
  email: string | null
  owned_clients_count: number
  shared_clients_count: number
}

interface ConfigKey {
  key: string
  masked_value: string
  has_value: boolean
  description: string | null
  updated_at: string | null
}

interface CostData {
  period: string
  totals: { cost: number; calls: number; input_tokens: number; output_tokens: number }
  byUser: Array<{ user_id: string; user_name: string; cost: number; calls: number; input: number; output: number }>
  byClient: Array<{ client_id: string; client_name: string; cost: number; calls: number; input: number; output: number }>
  byOperation: Array<{ operation: string; cost: number; calls: number; input: number; output: number }>
  recent: Array<{
    id: string; user_id: string; user_name: string; client_id: string | null; client_name: string
    provider: string; model: string; operation: string
    input_tokens: number; output_tokens: number; estimated_cost_usd: number; created_at: string
  }>
}

interface ActivityLog {
  id: string
  user_id: string
  user_name: string
  action: string
  resource_type: string | null
  resource_id: string | null
  details: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

// The 6 API keys we manage
const API_KEY_DEFS = [
  { key: 'SEMRUSH_API_KEY', label: 'SEMrush', description: 'SEMrush API key for keyword & backlink data' },
  { key: 'AHREFS_API_KEY', label: 'Ahrefs', description: 'Ahrefs API key for backlink & authority data' },
  { key: 'GOOGLE_PSI_API_KEY', label: 'Google PSI', description: 'Google PageSpeed Insights API key' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', description: 'OpenAI API key for GPT models' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', description: 'Anthropic API key for Claude models' },
  { key: 'PPLX_API_KEY', label: 'Perplexity', description: 'Perplexity API key for AI search' },
]

const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  create_client: 'Nuovo Cliente',
  update_client: 'Modifica Cliente',
  archive_client: 'Archivia Cliente',
  run_analysis: 'Analisi',
  detect_martech: 'Rileva MarTech',
  generate_summary: 'Executive Summary',
  upload_file: 'Carica File',
  delete_file: 'Elimina File',
  create_user: 'Crea Utente',
  chat: 'Chat AI',
}

const OPERATION_LABELS: Record<string, string> = {
  chat: 'Chat (Ask J)',
  executive_summary: 'Executive Summary',
  martech_detect: 'MarTech Detection',
  llm_context: 'Contesto Aziendale',
  llm_solutions: 'Soluzioni Driver',
  llm_priority_matrix: 'Priority Matrix',
}

type Tab = 'users' | 'apikeys' | 'createuser' | 'costs' | 'activity'

// ─── Component ─────────────────────────────────────────
export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()
  const { t, locale } = useLocale()

  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('users')

  // Users tab
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)

  // API Keys tab
  const [configKeys, setConfigKeys] = useState<ConfigKey[]>([])
  const [loadingKeys, setLoadingKeys] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [keyMessage, setKeyMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Create User tab
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [creatingUser, setCreatingUser] = useState(false)
  const [createMessage, setCreateMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Costs tab
  const [costData, setCostData] = useState<CostData | null>(null)
  const [costPeriod, setCostPeriod] = useState<'today' | '7d' | '30d'>('7d')
  const [loadingCosts, setLoadingCosts] = useState(false)

  // Activity tab
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [activityUsers, setActivityUsers] = useState<{ id: string; name: string }[]>([])
  const [activityFilterUser, setActivityFilterUser] = useState<string>('')
  const [loadingActivity, setLoadingActivity] = useState(false)

  // ─── Init ──────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') {
        router.push('/analyzer')
        return
      }
      setIsAdmin(true)

      // Load users via the admin API so we get email + counts (Phase 4D).
      await refreshUsers()
      setLoadingUsers(false)
    }
    load()
  }, [])

  // Re-loads the users table from /api/admin/users.
  async function refreshUsers() {
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      if (Array.isArray(data.users)) {
        setUsers(data.users)
      }
    } catch (err) {
      console.error('Failed to load users:', err)
    }
  }

  // Load config keys when switching to apikeys tab
  useEffect(() => {
    if (activeTab === 'apikeys' && isAdmin) {
      loadConfigKeys()
    }
  }, [activeTab, isAdmin])

  // Load costs when switching to costs tab or changing period
  useEffect(() => {
    if (activeTab === 'costs' && isAdmin) {
      loadCosts()
    }
  }, [activeTab, isAdmin, costPeriod])

  // Load activity when switching to activity tab or changing filter
  useEffect(() => {
    if (activeTab === 'activity' && isAdmin) {
      loadActivity()
    }
  }, [activeTab, isAdmin, activityFilterUser])

  async function loadConfigKeys() {
    setLoadingKeys(true)
    try {
      const res = await fetch('/api/admin/config')
      const json = await res.json()
      if (json.keys) {
        setConfigKeys(json.keys)
      }
    } catch (err) {
      console.error('Failed to load config keys:', err)
    }
    setLoadingKeys(false)
  }

  async function loadCosts() {
    setLoadingCosts(true)
    try {
      const res = await fetch(`/api/admin/costs?period=${costPeriod}`)
      const json = await res.json()
      setCostData(json)
    } catch (err) {
      console.error('Failed to load costs:', err)
    }
    setLoadingCosts(false)
  }

  async function loadActivity() {
    setLoadingActivity(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (activityFilterUser) params.set('user_id', activityFilterUser)
      const res = await fetch(`/api/admin/activity?${params}`)
      const json = await res.json()
      setActivityLogs(json.logs || [])
      setActivityUsers(json.users || [])
    } catch (err) {
      console.error('Failed to load activity:', err)
    }
    setLoadingActivity(false)
  }

  // ─── Users Actions ────────────────────────────────────
  // All mutations now go through /api/admin/users/[id] so the server-side
  // last-admin guard runs (it will reject demoting/deactivating the only
  // remaining active admin).
  async function patchUser(userId: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data.error || 'Update failed')
      return false
    }
    await refreshUsers()
    return true
  }

  async function toggleActive(userId: string, currentActive: boolean) {
    await patchUser(userId, { is_active: !currentActive })
  }

  async function toggleRole(userId: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin'
    await patchUser(userId, { role: newRole })
  }

  async function resetPassword(userId: string, email: string | null) {
    if (!confirm(`Send a password recovery email to ${email || userId}?`)) return
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data.error || 'Reset failed')
      return
    }
    alert('Recovery email sent.')
  }

  async function softDeleteUser(userId: string, email: string | null) {
    if (!confirm(`Soft-delete ${email || userId}? They will be deactivated and signed out, but their data and audit trail are kept.`)) return
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data.error || 'Delete failed')
      return
    }
    await refreshUsers()
  }

  async function purgeUser(userId: string, email: string | null) {
    if (!email) {
      alert('Cannot purge a user with no email on record.')
      return
    }
    const typed = window.prompt(
      `PERMANENT delete. Type the email to confirm:\n\n${email}`
    )
    if (!typed || typed.trim().toLowerCase() !== email.toLowerCase()) {
      alert('Confirmation mismatch — purge aborted.')
      return
    }
    const res = await fetch(`/api/admin/users/${userId}/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: email }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data.error || 'Purge failed')
      return
    }
    await refreshUsers()
  }

  // ─── API Keys Actions ────────────────────────────────
  async function saveApiKey(key: string) {
    if (!editValue.trim()) return
    setSavingKey(true)
    setKeyMessage(null)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: editValue.trim() }),
      })
      const json = await res.json()
      if (json.success) {
        setKeyMessage({ text: `${key} ${t('admin.savedSuccess')}`, type: 'success' })
        setEditingKey(null)
        setEditValue('')
        await loadConfigKeys()
      } else {
        setKeyMessage({ text: json.error || t('admin.failedToSave'), type: 'error' })
      }
    } catch {
      setKeyMessage({ text: t('admin.networkError'), type: 'error' })
    }
    setSavingKey(false)
    setTimeout(() => setKeyMessage(null), 4000)
  }

  async function removeApiKey(key: string) {
    setKeyMessage(null)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const json = await res.json()
      if (json.success) {
        setKeyMessage({ text: `${key} ${t('admin.removed')}`, type: 'success' })
        await loadConfigKeys()
      } else {
        setKeyMessage({ text: json.error || t('admin.failedToRemove'), type: 'error' })
      }
    } catch {
      setKeyMessage({ text: t('admin.networkError'), type: 'error' })
    }
    setTimeout(() => setKeyMessage(null), 4000)
  }

  // ─── Create User Action ──────────────────────────────
  async function handleCreateUser() {
    setCreateMessage(null)
    if (!newEmail || !newPassword) {
      setCreateMessage({ text: t('admin.emailRequired'), type: 'error' })
      return
    }
    if (newPassword.length < 8) {
      setCreateMessage({ text: t('admin.passwordMin'), type: 'error' })
      return
    }

    setCreatingUser(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          full_name: newFullName,
          role: newRole,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setCreateMessage({ text: t('admin.userCreated'), type: 'success' })
        setNewEmail('')
        setNewPassword('')
        setNewFullName('')
        setNewRole('user')
        // Reload users list
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false })
        setUsers(data ?? [])
      } else {
        setCreateMessage({ text: json.error || 'Failed to create user', type: 'error' })
      }
    } catch {
      setCreateMessage({ text: t('admin.networkError'), type: 'error' })
    }
    setCreatingUser(false)
  }

  // ─── Helpers ──────────────────────────────────────────
  function formatCost(usd: number): string {
    return `$${usd.toFixed(4)}`
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  // ─── Render ───────────────────────────────────────────
  if (!isAdmin) {
    return <div className="p-8 text-gray-500">{t('admin.checkingPermissions')}</div>
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: t('admin.users') },
    { id: 'apikeys', label: t('admin.apiKeys') },
    { id: 'createuser', label: t('admin.createUser') },
    { id: 'costs', label: t('admin.aiCosts') },
    { id: 'activity', label: t('admin.activity') },
  ]

  return (
    <div className="max-w-[1100px] p-8">
      <h1 className="mb-6 font-mono text-2xl font-bold text-foreground">
        {t('admin.adminPanel')}
      </h1>

      {/* Tab Bar */}
      <div className="mb-6 flex gap-1 rounded-[10px] border border-border bg-background p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 rounded-lg border-none px-4 py-2.5 text-[13px] font-semibold font-mono uppercase tracking-wider cursor-pointer transition-all',
              activeTab === tab.id
                ? 'bg-card text-primary'
                : 'bg-transparent text-gray-500'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {activeTab === 'users' && (
        <>
          {loadingUsers ? (
            <div className="text-gray-500">{t('admin.loadingUsers')}</div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      t('admin.headerName'),
                      'Email',
                      t('admin.headerCompany'),
                      t('admin.headerRole'),
                      'Clients',
                      t('admin.headerStatus'),
                      t('admin.headerJoined'),
                      t('admin.headerActions'),
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-mono text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id} className="border-b border-border/10">
                      <td className="px-4 py-3 text-[13px] text-foreground">
                        {user.full_name || '\u2014'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[#a0a0a0]">
                        {user.email || '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#a0a0a0]">
                        {user.company || '\u2014'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-[11px] font-semibold px-2 py-0.5 rounded uppercase',
                          user.role === 'admin'
                            ? 'bg-primary/[0.08] text-primary'
                            : 'bg-gray-500/[0.08] text-gray-500'
                        )}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#a0a0a0]">
                        <span title="Owned / Shared">
                          {user.owned_clients_count}
                          {user.shared_clients_count > 0 && (
                            <span className="text-gray-500"> + {user.shared_clients_count}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-[11px] font-semibold px-2 py-0.5 rounded',
                          user.is_active
                            ? 'bg-green-500/[0.08] text-green-500'
                            : 'bg-red-500/[0.08] text-red-500'
                        )}>
                          {user.is_active ? t('admin.active') : t('admin.inactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {formatLocalDate(new Date(user.created_at), locale)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => toggleActive(user.id, user.is_active)}
                            className="cursor-pointer rounded border border-border bg-[#1e2028] px-2.5 py-1 text-[11px] text-[#a0a0a0]"
                          >
                            {user.is_active ? t('admin.deactivate') : t('admin.activate')}
                          </button>
                          <button
                            onClick={() => toggleRole(user.id, user.role)}
                            className="cursor-pointer rounded border border-border bg-[#1e2028] px-2.5 py-1 text-[11px] text-[#a0a0a0]"
                          >
                            {user.role === 'admin' ? t('admin.removeAdmin') : t('admin.makeAdmin')}
                          </button>
                          <button
                            onClick={() => resetPassword(user.id, user.email)}
                            className="cursor-pointer rounded border border-blue-500/40 bg-[#1e2028] px-2.5 py-1 text-[11px] text-blue-500"
                          >
                            Reset PW
                          </button>
                          <button
                            onClick={() => softDeleteUser(user.id, user.email)}
                            className="cursor-pointer rounded border border-amber-500/40 bg-[#1e2028] px-2.5 py-1 text-[11px] text-amber-500"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => purgeUser(user.id, user.email)}
                            className="cursor-pointer rounded border border-red-500/40 bg-[#1e2028] px-2.5 py-1 text-[11px] text-red-500"
                          >
                            Purge
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══ API KEYS TAB ═══ */}
      {activeTab === 'apikeys' && (
        <div>
          {keyMessage && (
            <div className={cn(
              'mb-4 rounded-lg border px-4 py-2.5 text-[13px]',
              keyMessage.type === 'success'
                ? 'border-green-500/20 bg-green-500/[0.08] text-green-500'
                : 'border-red-500/20 bg-red-500/[0.08] text-red-500'
            )}>
              {keyMessage.text}
            </div>
          )}

          {loadingKeys ? (
            <div className="text-gray-500">{t('admin.loadingApiKeys')}</div>
          ) : (
            <div className="flex flex-col gap-3">
              {API_KEY_DEFS.map(def => {
                const stored = configKeys.find(c => c.key === def.key)
                const isEditing = editingKey === def.key

                return (
                  <div key={def.key} className="flex items-center gap-4 rounded-xl border bg-card overflow-hidden px-5 py-4">
                    {/* Status dot */}
                    <div className={cn(
                      'h-2.5 w-2.5 shrink-0 rounded-full',
                      stored
                        ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                        : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                    )} />

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold font-mono text-foreground">
                        {def.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {stored
                          ? `${t('admin.configured')}: ${stored.masked_value}`
                          : t('admin.notConfigured')}
                      </div>
                    </div>

                    {/* Actions */}
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          placeholder={t('admin.pasteApiKey')}
                          className="w-[280px] rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveApiKey(def.key)
                            if (e.key === 'Escape') { setEditingKey(null); setEditValue('') }
                          }}
                        />
                        <button
                          onClick={() => saveApiKey(def.key)}
                          disabled={savingKey || !editValue.trim()}
                          className={cn(
                            'rounded-lg px-5 py-2.5 text-[13px] font-semibold border-none',
                            savingKey || !editValue.trim()
                              ? 'bg-secondary text-muted-foreground cursor-default'
                              : 'bg-primary text-primary-foreground cursor-pointer'
                          )}
                        >
                          {savingKey ? '...' : t('admin.save')}
                        </button>
                        <button
                          onClick={() => { setEditingKey(null); setEditValue('') }}
                          className="cursor-pointer rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-[13px] text-gray-500"
                        >
                          {t('admin.cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingKey(def.key); setEditValue('') }}
                          className="cursor-pointer rounded-md border border-border bg-[#1e2028] px-3.5 py-1.5 text-xs font-medium text-primary"
                        >
                          {stored ? t('admin.update') : t('admin.setKey')}
                        </button>
                        {stored && (
                          <button
                            onClick={() => removeApiKey(def.key)}
                            className="cursor-pointer rounded-md border border-border bg-[#1e2028] px-3.5 py-1.5 text-xs font-medium text-red-500"
                          >
                            {t('admin.remove')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ CREATE USER TAB ═══ */}
      {activeTab === 'createuser' && (
        <div className="max-w-[500px] rounded-xl border bg-card overflow-hidden p-6">
          <h2 className="mb-5 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            {t('admin.createNewUser')}
          </h2>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5">{t('admin.emailLabel')}</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5">{t('admin.passwordLabel')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5">{t('admin.fullNameLabel')}</label>
              <input
                type="text"
                value={newFullName}
                onChange={e => setNewFullName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#a0a0a0] mb-1.5">{t('admin.roleLabel')}</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as 'user' | 'admin')}
                className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="user">{t('admin.userRole')}</option>
                <option value="admin">{t('admin.adminRole')}</option>
              </select>
            </div>

            {createMessage && (
              <div className={cn(
                'rounded-lg border px-4 py-2.5 text-[13px]',
                createMessage.type === 'success'
                  ? 'border-green-500/20 bg-green-500/[0.08] text-green-500'
                  : 'border-red-500/20 bg-red-500/[0.08] text-red-500'
              )}>
                {createMessage.text}
              </div>
            )}

            <button
              onClick={handleCreateUser}
              disabled={creatingUser}
              className={cn(
                'rounded-lg px-5 py-2.5 text-[13px] font-semibold border-none',
                creatingUser
                  ? 'bg-secondary text-muted-foreground cursor-default'
                  : 'bg-primary text-primary-foreground cursor-pointer'
              )}
            >
              {creatingUser ? t('admin.creating') : t('admin.createUserBtn')}
            </button>
          </div>
        </div>
      )}

      {/* ═══ COSTI AI TAB ═══ */}
      {activeTab === 'costs' && (
        <div>
          {/* Period selector */}
          <div className="mb-5 flex gap-2">
            {([['today', t('admin.today')], ['7d', t('admin.7days')], ['30d', t('admin.30days')]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setCostPeriod(val)}
                className={cn(
                  'rounded-lg border-none px-4 py-2 text-[13px] font-semibold font-mono cursor-pointer',
                  costPeriod === val
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-gray-500'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {loadingCosts ? (
            <div className="p-10 text-center text-gray-500">{t('admin.loadingCosts')}</div>
          ) : costData ? (
            <>
              {/* KPI Cards */}
              <div className="mb-6 grid grid-cols-4 gap-3">
                {[
                  { label: t('admin.totalCost'), value: formatCost(costData.totals.cost), highlight: true },
                  { label: t('admin.apiCalls'), value: String(costData.totals.calls), highlight: false },
                  { label: t('admin.inputTokens'), value: formatTokens(costData.totals.input_tokens), highlight: false },
                  { label: t('admin.outputTokens'), value: formatTokens(costData.totals.output_tokens), highlight: false },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border bg-card overflow-hidden px-5 py-4 text-center">
                    <div className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      {kpi.label}
                    </div>
                    <div className={cn(
                      'font-mono text-2xl font-bold',
                      kpi.highlight ? 'text-primary' : 'text-foreground'
                    )}>
                      {kpi.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Breakdown tables - 3 columns */}
              <div className="mb-6 grid grid-cols-3 gap-4">
                {/* By User */}
                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">{t('admin.byUser')}</h3>
                  </div>
                  {costData.byUser.length === 0 ? (
                    <div className="p-5 text-center text-xs text-gray-500">{t('admin.noData')}</div>
                  ) : (
                    <table className="w-full border-collapse">
                      <tbody>
                        {costData.byUser.map((u) => (
                          <tr key={u.user_id} className="border-b border-border/10">
                            <td className="px-4 py-2.5 text-xs text-foreground/90">{u.user_name}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-primary">{formatCost(u.cost)}</td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-gray-500">{u.calls} {t('admin.calls')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* By Client */}
                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">{t('admin.byClient')}</h3>
                  </div>
                  {costData.byClient.length === 0 ? (
                    <div className="p-5 text-center text-xs text-gray-500">{t('admin.noData')}</div>
                  ) : (
                    <table className="w-full border-collapse">
                      <tbody>
                        {costData.byClient.map((c) => (
                          <tr key={c.client_id} className="border-b border-border/10">
                            <td className="px-4 py-2.5 text-xs text-foreground/90">{c.client_name}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-primary">{formatCost(c.cost)}</td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-gray-500">{c.calls} {t('admin.calls')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* By Operation */}
                <div className="rounded-xl border bg-card overflow-hidden">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">{t('admin.byOperation')}</h3>
                  </div>
                  {costData.byOperation.length === 0 ? (
                    <div className="p-5 text-center text-xs text-gray-500">{t('admin.noData')}</div>
                  ) : (
                    <table className="w-full border-collapse">
                      <tbody>
                        {costData.byOperation.map((o) => (
                          <tr key={o.operation} className="border-b border-border/10">
                            <td className="px-4 py-2.5 text-xs text-foreground/90">{OPERATION_LABELS[o.operation] || o.operation}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-primary">{formatCost(o.cost)}</td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-gray-500">{o.calls} {t('admin.calls')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Recent Operations */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">{t('admin.recentOperations')}</h3>
                </div>
                {costData.recent.length === 0 ? (
                  <div className="p-5 text-center text-xs text-gray-500">{t('admin.noOperations')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[800px] w-full border-collapse">
                      <thead>
                        <tr className="border-b border-border">
                          {[t('admin.headerDate'), t('admin.headerUser'), t('admin.headerOperation'), t('admin.headerModel'), t('admin.headerTokenIn'), t('admin.headerTokenOut'), t('admin.headerCost')].map(h => (
                            <th key={h} className="px-4 py-3 text-left font-mono text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {costData.recent.map((r) => (
                          <tr key={r.id} className="border-b border-border/10">
                            <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-gray-500">
                              {new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale === 'it' ? 'it-IT' : locale === 'es' ? 'es-ES' : 'fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(r.created_at))}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-foreground/90">{r.user_name}</td>
                            <td className="px-4 py-2.5">
                              <span className="rounded bg-primary/[0.08] px-2 py-0.5 text-[11px] font-semibold text-primary">
                                {OPERATION_LABELS[r.operation] || r.operation}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-gray-500">{r.model}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-foreground/90">{formatTokens(r.input_tokens)}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-foreground/90">{formatTokens(r.output_tokens)}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-primary">{formatCost(Number(r.estimated_cost_usd))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ═══ ATTIVITA TAB ═══ */}
      {activeTab === 'activity' && (
        <div>
          {/* Filter */}
          <div className="mb-4 flex items-center gap-3">
            <label className="text-xs text-gray-500">{t('admin.filterByUser')}</label>
            <select
              value={activityFilterUser}
              onChange={e => setActivityFilterUser(e.target.value)}
              className="w-[250px] rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t('admin.allUsers')}</option>
              {activityUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {loadingActivity ? (
            <div className="p-10 text-center text-gray-500">{t('admin.loadingActivity')}</div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              {activityLogs.length === 0 ? (
                <div className="p-10 text-center text-[13px] text-gray-500">{t('admin.noActivity')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[750px] w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        {[t('admin.headerDateTime'), t('admin.headerUser'), t('admin.headerAction'), t('admin.headerResource'), t('admin.headerDetails'), t('admin.headerIP')].map(h => (
                          <th key={h} className="px-4 py-3 text-left font-mono text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activityLogs.map((log) => (
                        <tr key={log.id} className="border-b border-border/10">
                          <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-gray-500">
                            {new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale === 'it' ? 'it-IT' : locale === 'es' ? 'es-ES' : 'fr-FR', {
                              day: '2-digit', month: '2-digit', year: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            }).format(new Date(log.created_at))}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-foreground/90">{log.user_name}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn(
                              'rounded px-2 py-0.5 text-[11px] font-semibold',
                              log.action === 'login'
                                ? 'bg-teal-500/[0.08] text-teal-500'
                                : 'bg-primary/[0.08] text-primary'
                            )}>
                              {ACTION_LABELS[log.action] || log.action}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">
                            {log.resource_type || '\u2014'}
                          </td>
                          <td className="max-w-[200px] truncate px-4 py-2.5 text-[11px] text-gray-500">
                            {log.details ? JSON.stringify(log.details).slice(0, 60) : '\u2014'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-gray-600">
                            {log.ip_address || '\u2014'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
