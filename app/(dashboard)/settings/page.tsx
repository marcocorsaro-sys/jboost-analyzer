'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale, type Locale } from '@/lib/i18n'

export default function SettingsPage() {
  const supabase = createClient()
  const { locale, setLocale } = useLocale()
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [language, setLanguage] = useState<Locale>('en')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Password change
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) {
        setProfile(data)
        setFullName(data.full_name || '')
        setCompany(data.company || '')
        const rawLang = (data.language || locale || 'en') as string
        const validLang: Locale = (['en', 'it', 'es', 'fr'] as const).includes(rawLang as Locale)
          ? (rawLang as Locale)
          : 'en'
        setLanguage(validLang)
      } else {
        setLanguage(locale)
      }
    }
    load()
    // locale intentionally not a dep: we only seed on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveProfile() {
    if (!profile) return
    setSaving(true)
    setSaved(false)
    await supabase.from('profiles').update({
      full_name: fullName,
      company,
      language,
      updated_at: new Date().toISOString(),
    }).eq('id', profile.id)
    // Apply the selected locale immediately so the UI reflects the choice.
    setLocale(language)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  async function handleChangePassword() {
    setPasswordError('')
    setPasswordSaved(false)
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    setChangingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (error) {
      setPasswordError(error.message)
    } else {
      setPasswordSaved(true)
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSaved(false), 3000)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    background: '#111318',
    border: '1px solid #2a2d35',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
  }

  const labelStyle = {
    fontSize: '12px',
    color: '#a0a0a0',
    display: 'block' as const,
    marginBottom: '6px',
    fontWeight: 500 as const,
  }

  return (
    <div style={{ padding: '32px', maxWidth: '640px' }}>
      <h1 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '24px',
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: '32px',
      }}>
        Settings
      </h1>

      {/* Profile */}
      <div style={{
        background: '#1a1d24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        padding: '24px',
        marginBottom: '20px',
      }}>
        <h2 style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '14px',
          fontWeight: 600,
          color: '#ffffff',
          marginBottom: '20px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Profile
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Full Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Company</label>
            <input type="text" value={company} onChange={e => setCompany(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Preferred Language</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as Locale)}
              style={inputStyle}
            >
              <option value="en">English</option>
              <option value="it">Italiano</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              style={{
                padding: '10px 20px',
                background: saving ? '#2a2d35' : '#c8e64a',
                color: saving ? '#6b7280' : '#111318',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
            {saved && <span style={{ fontSize: '13px', color: '#22c55e' }}>Saved!</span>}
          </div>
        </div>
      </div>

      {/* Password */}
      <div style={{
        background: '#1a1d24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        padding: '24px',
      }}>
        <h2 style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '14px',
          fontWeight: 600,
          color: '#ffffff',
          marginBottom: '20px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Change Password
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={labelStyle}>New Password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} placeholder="Min 8 characters" />
          </div>
          <div>
            <label style={labelStyle}>Confirm Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} />
          </div>
          {passwordError && <p style={{ color: '#ef4444', fontSize: '13px', margin: 0 }}>{passwordError}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleChangePassword}
              disabled={changingPassword}
              style={{
                padding: '10px 20px',
                background: changingPassword ? '#2a2d35' : '#c8e64a',
                color: changingPassword ? '#6b7280' : '#111318',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: changingPassword ? 'default' : 'pointer',
              }}
            >
              {changingPassword ? 'Updating...' : 'Update Password'}
            </button>
            {passwordSaved && <span style={{ fontSize: '13px', color: '#22c55e' }}>Password updated!</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
