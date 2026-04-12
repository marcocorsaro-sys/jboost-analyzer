'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale, LOCALE_LABELS, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const LOCALES: Locale[] = ['en', 'it', 'es', 'fr']

export default function SettingsPage() {
  const supabase = createClient()
  const { locale, setLocale, t } = useLocale()
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
      setPasswordError(t('settings.passwordMinLength'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.passwordMismatch'))
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

  return (
    <div className="max-w-[640px] p-8">
      <h1 className="mb-8 font-mono text-2xl font-bold text-foreground">
        {t('settings.title')}
      </h1>

      {/* Profile */}
      <div className="mb-5 rounded-xl border bg-card p-6">
        <h2 className="mb-5 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
          {t('settings.profile')}
        </h2>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('settings.fullName')}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('settings.company')}
            </label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('settings.preferredLanguage')}
            </label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as Locale)}
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              {LOCALES.map(l => (
                <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className={cn(
                'rounded-lg px-5 py-2.5 text-[13px] font-semibold transition-colors',
                saving
                  ? 'cursor-default bg-secondary text-muted-foreground'
                  : 'cursor-pointer bg-primary text-primary-foreground hover:opacity-90'
              )}
            >
              {saving ? t('settings.saving') : t('settings.saveProfile')}
            </button>
            {saved && <span className="text-[13px] text-green-500">{t('settings.saved')}</span>}
          </div>
        </div>
      </div>

      {/* Password */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="mb-5 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
          {t('settings.changePassword')}
        </h2>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('settings.newPassword')}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
              placeholder={t('settings.minChars')}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('settings.confirmPassword')}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          {passwordError && <p className="m-0 text-[13px] text-destructive">{passwordError}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={handleChangePassword}
              disabled={changingPassword}
              className={cn(
                'rounded-lg px-5 py-2.5 text-[13px] font-semibold transition-colors',
                changingPassword
                  ? 'cursor-default bg-secondary text-muted-foreground'
                  : 'cursor-pointer bg-primary text-primary-foreground hover:opacity-90'
              )}
            >
              {changingPassword ? t('settings.updating') : t('settings.updatePassword')}
            </button>
            {passwordSaved && <span className="text-[13px] text-green-500">{t('settings.passwordUpdated')}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
