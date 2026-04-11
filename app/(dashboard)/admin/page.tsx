'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'

// ─── Types ─────────────────────────────────────────────
interface UserProfile {
  id: string
  full_name: string | null
  company: string | null
  role: string
  is_active: boolean
  created_at: string
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

// ─── Styles ────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: '#111318',
  border: '1px solid #2a2d35',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '14px',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#a0a0a0',
  display: 'block',
  marginBottom: '6px',
  fontWeight: 500,
}

const cardStyle: React.CSSProperties = {
  background: '#1a1d24',
  borderRadius: '12px',
  border: '1px solid #2a2d35',
  overflow: 'hidden',
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px',
  background: '#c8e64a',
  color: '#111318',
  border: 'none',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
}

const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  background: '#2a2d35',
  color: '#6b7280',
  cursor: 'default',
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '11px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 16px',
  fontSize: '13px',
  color: '#e0e0e0',
}

// ─── Component ─────────────────────────────────────────
export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()
  const { t } = useLocale()

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

      // Load users
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
      setUsers(data ?? [])
      setLoadingUsers(false)
    }
    load()
  }, [])

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
  async function toggleActive(userId: string, currentActive: boolean) {
    await supabase.from('profiles').update({ is_active: !currentActive }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: !currentActive } : u))
  }

  async function toggleRole(userId: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin'
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
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
        setKeyMessage({ text: `${key} saved successfully`, type: 'success' })
        setEditingKey(null)
        setEditValue('')
        await loadConfigKeys()
      } else {
        setKeyMessage({ text: json.error || 'Failed to save', type: 'error' })
      }
    } catch {
      setKeyMessage({ text: 'Network error', type: 'error' })
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
        setKeyMessage({ text: `${key} removed`, type: 'success' })
        await loadConfigKeys()
      } else {
        setKeyMessage({ text: json.error || 'Failed to remove', type: 'error' })
      }
    } catch {
      setKeyMessage({ text: 'Network error', type: 'error' })
    }
    setTimeout(() => setKeyMessage(null), 4000)
  }

  // ─── Create User Action ──────────────────────────────
  async function handleCreateUser() {
    setCreateMessage(null)
    if (!newEmail || !newPassword) {
      setCreateMessage({ text: 'Email and password are required', type: 'error' })
      return
    }
    if (newPassword.length < 8) {
      setCreateMessage({ text: 'Password must be at least 8 characters', type: 'error' })
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
        setCreateMessage({ text: `User ${newEmail} created successfully!`, type: 'success' })
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
      setCreateMessage({ text: 'Network error', type: 'error' })
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
    return <div style={{ padding: '32px', color: '#6b7280' }}>{t('admin.checkingPermissions')}</div>
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: t('admin.users') },
    { id: 'apikeys', label: t('admin.apiKeys') },
    { id: 'createuser', label: t('admin.createUser') },
    { id: 'costs', label: t('admin.aiCosts') },
    { id: 'activity', label: t('admin.activity') },
  ]

  return (
    <div style={{ padding: '32px', maxWidth: '1100px' }}>
      <h1 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '24px',
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: '24px',
      }}>
        Admin Panel
      </h1>

      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '24px',
        background: '#111318',
        borderRadius: '10px',
        padding: '4px',
        border: '1px solid #2a2d35',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: activeTab === tab.id ? '#1a1d24' : 'transparent',
              color: activeTab === tab.id ? '#c8e64a' : '#6b7280',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {activeTab === 'users' && (
        <>
          {loadingUsers ? (
            <div style={{ color: '#6b7280' }}>Loading users...</div>
          ) : (
            <div style={cardStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2d35' }}>
                    {['Name', 'Company', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id} style={{ borderBottom: '1px solid #2a2d3520' }}>
                      <td style={{ padding: '12px 16px', color: '#ffffff', fontSize: '13px' }}>
                        {user.full_name || '\u2014'}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#a0a0a0', fontSize: '13px' }}>
                        {user.company || '\u2014'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                          borderRadius: '4px', textTransform: 'uppercase',
                          background: user.role === 'admin' ? '#c8e64a15' : '#6b728015',
                          color: user.role === 'admin' ? '#c8e64a' : '#6b7280',
                        }}>
                          {user.role}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                          borderRadius: '4px',
                          background: user.is_active ? '#22c55e15' : '#ef444415',
                          color: user.is_active ? '#22c55e' : '#ef4444',
                        }}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: '12px' }}>
                        {new Date(user.created_at).toLocaleDateString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => toggleActive(user.id, user.is_active)}
                          style={{
                            padding: '4px 10px', background: '#1e2028',
                            border: '1px solid #2a2d35', borderRadius: '4px',
                            color: '#a0a0a0', fontSize: '11px', cursor: 'pointer',
                          }}
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => toggleRole(user.id, user.role)}
                          style={{
                            padding: '4px 10px', background: '#1e2028',
                            border: '1px solid #2a2d35', borderRadius: '4px',
                            color: '#a0a0a0', fontSize: '11px', cursor: 'pointer',
                          }}
                        >
                          {user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                        </button>
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
            <div style={{
              padding: '10px 16px', borderRadius: '8px', marginBottom: '16px',
              fontSize: '13px',
              background: keyMessage.type === 'success' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${keyMessage.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              color: keyMessage.type === 'success' ? '#22c55e' : '#ef4444',
            }}>
              {keyMessage.text}
            </div>
          )}

          {loadingKeys ? (
            <div style={{ color: '#6b7280' }}>Loading API keys...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {API_KEY_DEFS.map(def => {
                const stored = configKeys.find(c => c.key === def.key)
                const isEditing = editingKey === def.key

                return (
                  <div key={def.key} style={{
                    ...cardStyle,
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                  }}>
                    {/* Status dot */}
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                      background: stored ? '#22c55e' : '#ef4444',
                      boxShadow: stored ? '0 0 8px rgba(34, 197, 94, 0.4)' : '0 0 8px rgba(239, 68, 68, 0.4)',
                    }} />

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '14px', fontWeight: 600, color: '#ffffff',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {def.label}
                      </div>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                        {stored
                          ? `Configured: ${stored.masked_value}`
                          : 'Not configured'}
                      </div>
                    </div>

                    {/* Actions */}
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="password"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          placeholder="Paste API key..."
                          style={{
                            ...inputStyle,
                            width: '280px',
                          }}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveApiKey(def.key)
                            if (e.key === 'Escape') { setEditingKey(null); setEditValue('') }
                          }}
                        />
                        <button
                          onClick={() => saveApiKey(def.key)}
                          disabled={savingKey || !editValue.trim()}
                          style={savingKey || !editValue.trim() ? btnDisabled : btnPrimary}
                        >
                          {savingKey ? '...' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingKey(null); setEditValue('') }}
                          style={{
                            padding: '10px 14px', background: 'transparent',
                            border: '1px solid #2a2d35', borderRadius: '8px',
                            color: '#6b7280', fontSize: '13px', cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => { setEditingKey(def.key); setEditValue('') }}
                          style={{
                            padding: '6px 14px', background: '#1e2028',
                            border: '1px solid #2a2d35', borderRadius: '6px',
                            color: '#c8e64a', fontSize: '12px', fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          {stored ? 'Update' : 'Set Key'}
                        </button>
                        {stored && (
                          <button
                            onClick={() => removeApiKey(def.key)}
                            style={{
                              padding: '6px 14px', background: '#1e2028',
                              border: '1px solid #2a2d35', borderRadius: '6px',
                              color: '#ef4444', fontSize: '12px', fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            Remove
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
        <div style={{ ...cardStyle, padding: '24px', maxWidth: '500px' }}>
          <h2 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '14px', fontWeight: 600, color: '#ffffff',
            marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            Create New User
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                style={inputStyle}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label style={labelStyle}>Password * (min 8 chars)</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                style={inputStyle}
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                value={newFullName}
                onChange={e => setNewFullName(e.target.value)}
                style={inputStyle}
                placeholder="John Doe"
              />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as 'user' | 'admin')}
                style={inputStyle}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {createMessage && (
              <div style={{
                padding: '10px 16px', borderRadius: '8px', fontSize: '13px',
                background: createMessage.type === 'success' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${createMessage.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                color: createMessage.type === 'success' ? '#22c55e' : '#ef4444',
              }}>
                {createMessage.text}
              </div>
            )}

            <button
              onClick={handleCreateUser}
              disabled={creatingUser}
              style={creatingUser ? btnDisabled : btnPrimary}
            >
              {creatingUser ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </div>
      )}

      {/* ═══ COSTI AI TAB ═══ */}
      {activeTab === 'costs' && (
        <div>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            {([['today', t('admin.today')], ['7d', t('admin.7days')], ['30d', t('admin.30days')]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setCostPeriod(val)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace",
                  background: costPeriod === val ? '#c8e64a' : '#1a1d24',
                  color: costPeriod === val ? '#111318' : '#6b7280',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {loadingCosts ? (
            <div style={{ color: '#6b7280', padding: '40px', textAlign: 'center' }}>{t('admin.loadingCosts')}</div>
          ) : costData ? (
            <>
              {/* KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
                {[
                  { label: t('admin.totalCost'), value: formatCost(costData.totals.cost), color: '#c8e64a' },
                  { label: t('admin.apiCalls'), value: String(costData.totals.calls), color: '#ffffff' },
                  { label: t('admin.inputTokens'), value: formatTokens(costData.totals.input_tokens), color: '#ffffff' },
                  { label: t('admin.outputTokens'), value: formatTokens(costData.totals.output_tokens), color: '#ffffff' },
                ].map((kpi) => (
                  <div key={kpi.label} style={{
                    ...cardStyle,
                    padding: '16px 20px',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontFamily: "'JetBrains Mono', monospace" }}>
                      {kpi.label}
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: kpi.color, fontFamily: "'JetBrains Mono', monospace" }}>
                      {kpi.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Breakdown tables - 3 columns */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
                {/* By User */}
                <div style={cardStyle}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2d35' }}>
                    <h3 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', fontWeight: 600, color: '#c8e64a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('admin.byUser')}</h3>
                  </div>
                  {costData.byUser.length === 0 ? (
                    <div style={{ padding: '20px', color: '#6b7280', fontSize: '12px', textAlign: 'center' }}>Nessun dato</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {costData.byUser.map((u) => (
                          <tr key={u.user_id} style={{ borderBottom: '1px solid #2a2d3520' }}>
                            <td style={{ ...tdStyle, fontSize: '12px' }}>{u.user_name}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', textAlign: 'right', color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace" }}>{formatCost(u.cost)}</td>
                            <td style={{ ...tdStyle, fontSize: '11px', textAlign: 'right', color: '#6b7280' }}>{u.calls} ch.</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* By Client */}
                <div style={cardStyle}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2d35' }}>
                    <h3 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', fontWeight: 600, color: '#c8e64a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('admin.byClient')}</h3>
                  </div>
                  {costData.byClient.length === 0 ? (
                    <div style={{ padding: '20px', color: '#6b7280', fontSize: '12px', textAlign: 'center' }}>Nessun dato</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {costData.byClient.map((c) => (
                          <tr key={c.client_id} style={{ borderBottom: '1px solid #2a2d3520' }}>
                            <td style={{ ...tdStyle, fontSize: '12px' }}>{c.client_name}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', textAlign: 'right', color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace" }}>{formatCost(c.cost)}</td>
                            <td style={{ ...tdStyle, fontSize: '11px', textAlign: 'right', color: '#6b7280' }}>{c.calls} ch.</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* By Operation */}
                <div style={cardStyle}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2d35' }}>
                    <h3 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', fontWeight: 600, color: '#c8e64a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('admin.byOperation')}</h3>
                  </div>
                  {costData.byOperation.length === 0 ? (
                    <div style={{ padding: '20px', color: '#6b7280', fontSize: '12px', textAlign: 'center' }}>Nessun dato</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {costData.byOperation.map((o) => (
                          <tr key={o.operation} style={{ borderBottom: '1px solid #2a2d3520' }}>
                            <td style={{ ...tdStyle, fontSize: '12px' }}>{OPERATION_LABELS[o.operation] || o.operation}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', textAlign: 'right', color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace" }}>{formatCost(o.cost)}</td>
                            <td style={{ ...tdStyle, fontSize: '11px', textAlign: 'right', color: '#6b7280' }}>{o.calls} ch.</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Recent Operations */}
              <div style={cardStyle}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2d35' }}>
                  <h3 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', fontWeight: 600, color: '#c8e64a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('admin.recentOperations')}</h3>
                </div>
                {costData.recent.length === 0 ? (
                  <div style={{ padding: '20px', color: '#6b7280', fontSize: '12px', textAlign: 'center' }}>Nessuna operazione nel periodo</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2a2d35' }}>
                          {['Data', 'Utente', 'Operazione', 'Modello', 'Token In', 'Token Out', 'Costo'].map(h => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {costData.recent.map((r) => (
                          <tr key={r.id} style={{ borderBottom: '1px solid #2a2d3520' }}>
                            <td style={{ ...tdStyle, fontSize: '11px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                              {new Date(r.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ ...tdStyle, fontSize: '12px' }}>{r.user_name}</td>
                            <td style={tdStyle}>
                              <span style={{
                                fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                                borderRadius: '4px', background: '#c8e64a15', color: '#c8e64a',
                              }}>
                                {OPERATION_LABELS[r.operation] || r.operation}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, fontSize: '11px', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>{r.model}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" }}>{formatTokens(r.input_tokens)}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" }}>{formatTokens(r.output_tokens)}</td>
                            <td style={{ ...tdStyle, fontSize: '12px', color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace" }}>{formatCost(Number(r.estimated_cost_usd))}</td>
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
          <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', color: '#6b7280' }}>Filtra per utente:</label>
            <select
              value={activityFilterUser}
              onChange={e => setActivityFilterUser(e.target.value)}
              style={{ ...inputStyle, width: '250px' }}
            >
              <option value="">Tutti gli utenti</option>
              {activityUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {loadingActivity ? (
            <div style={{ color: '#6b7280', padding: '40px', textAlign: 'center' }}>Caricamento attivita...</div>
          ) : (
            <div style={cardStyle}>
              {activityLogs.length === 0 ? (
                <div style={{ padding: '40px', color: '#6b7280', fontSize: '13px', textAlign: 'center' }}>Nessuna attivita registrata</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '750px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2d35' }}>
                        {['Data/Ora', 'Utente', 'Azione', 'Risorsa', 'Dettagli', 'IP'].map(h => (
                          <th key={h} style={thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activityLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: '1px solid #2a2d3520' }}>
                          <td style={{ ...tdStyle, fontSize: '11px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                            {new Date(log.created_at).toLocaleString('it-IT', {
                              day: '2-digit', month: '2-digit', year: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                          <td style={{ ...tdStyle, fontSize: '12px' }}>{log.user_name}</td>
                          <td style={tdStyle}>
                            <span style={{
                              fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                              borderRadius: '4px',
                              background: log.action === 'login' ? '#14b8a615' : '#c8e64a15',
                              color: log.action === 'login' ? '#14b8a6' : '#c8e64a',
                            }}>
                              {ACTION_LABELS[log.action] || log.action}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, fontSize: '12px', color: '#6b7280' }}>
                            {log.resource_type || '—'}
                          </td>
                          <td style={{ ...tdStyle, fontSize: '11px', color: '#6b7280', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.details ? JSON.stringify(log.details).slice(0, 60) : '—'}
                          </td>
                          <td style={{ ...tdStyle, fontSize: '11px', color: '#4b5563', fontFamily: "'JetBrains Mono', monospace" }}>
                            {log.ip_address || '—'}
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
