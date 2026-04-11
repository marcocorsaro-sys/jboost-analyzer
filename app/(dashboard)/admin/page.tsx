'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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

// The 6 API keys we manage
const API_KEY_DEFS = [
  { key: 'SEMRUSH_API_KEY', label: 'SEMrush', description: 'SEMrush API key for keyword & backlink data' },
  { key: 'AHREFS_API_KEY', label: 'Ahrefs', description: 'Ahrefs API key for backlink & authority data' },
  { key: 'GOOGLE_PSI_API_KEY', label: 'Google PSI', description: 'Google PageSpeed Insights API key' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', description: 'OpenAI API key for GPT models' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', description: 'Anthropic API key for Claude models' },
  { key: 'PPLX_API_KEY', label: 'Perplexity', description: 'Perplexity API key for AI search' },
]

type Tab = 'users' | 'apikeys' | 'createuser'

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

// ─── Component ─────────────────────────────────────────
export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()

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

  // ─── Render ───────────────────────────────────────────
  if (!isAdmin) {
    return <div style={{ padding: '32px', color: '#6b7280' }}>Checking permissions...</div>
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: 'Users' },
    { id: 'apikeys', label: 'API Keys' },
    { id: 'createuser', label: 'Create User' },
  ]

  return (
    <div style={{ padding: '32px', maxWidth: '900px' }}>
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
                      <th key={h} style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {h}
                      </th>
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
    </div>
  )
}
