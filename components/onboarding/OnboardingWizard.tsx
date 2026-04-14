'use client'

// ============================================================
// JBoost — Phase 5D — OnboardingWizard
//
// Multi-step wizard shell for the structured onboarding flow.
// Owns the local draft state, debounced auto-save (PATCH /api/
// clients/[id]/onboarding), step navigation, and hand-off to
// the final discovery chat phase.
//
// Every field is optional. "Rispondi dopo" marks a field path
// as skipped → surfaces as MemoryGap on completion.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { ONBOARDING_SECTIONS } from '@/lib/onboarding/sections'
import type { MemoryProfile } from '@/lib/types/client'
import SectionForm from './SectionForm'
import OnboardingDiscoveryChat from './OnboardingDiscoveryChat'

interface OnboardingWizardProps {
  clientId: string
  clientName: string
  initialProfile: MemoryProfile
}

const DISCOVERY_STEP_ID = '__discovery__'

// ─── Styles ───────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '280px 1fr',
  gap: '24px',
  padding: '32px',
  maxWidth: '1200px',
  margin: '0 auto',
}

const sidebarStyle: React.CSSProperties = {
  background: '#0f1115',
  border: '1px solid #2a2d35',
  borderRadius: '12px',
  padding: '16px',
  position: 'sticky',
  top: '80px',
  height: 'fit-content',
}

const stepItemStyle = (active: boolean, completed: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 12px',
  borderRadius: '8px',
  cursor: 'pointer',
  background: active ? '#c8e64a15' : 'transparent',
  border: `1px solid ${active ? '#c8e64a80' : 'transparent'}`,
  color: active ? '#c8e64a' : completed ? '#e6e7eb' : '#8a8e97',
  fontSize: '13px',
  fontWeight: active || completed ? 600 : 500,
  fontFamily: "'JetBrains Mono', monospace",
  marginBottom: '4px',
})

const stepBadgeStyle = (active: boolean, completed: boolean): React.CSSProperties => ({
  width: '24px',
  height: '24px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '11px',
  fontWeight: 700,
  background: completed ? '#22c55e' : active ? '#c8e64a' : '#1a1d25',
  color: completed || active ? '#111318' : '#8a8e97',
})

const contentStyle: React.CSSProperties = {
  background: '#0f1115',
  border: '1px solid #2a2d35',
  borderRadius: '12px',
  padding: '32px',
}

const buttonPrimary: React.CSSProperties = {
  padding: '10px 24px',
  background: '#c8e64a',
  color: '#111318',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: "'JetBrains Mono', monospace",
}

const buttonSecondary: React.CSSProperties = {
  padding: '10px 24px',
  background: 'transparent',
  color: '#e6e7eb',
  border: '1px solid #2a2d35',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: "'JetBrains Mono', monospace",
}

// ─── Helpers ──────────────────────────────────────────────

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  let cursor: Record<string, unknown> = obj
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i]
    if (typeof cursor[k] !== 'object' || cursor[k] === null || Array.isArray(cursor[k])) {
      cursor[k] = {}
    }
    cursor = cursor[k] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]] = value
}

// Deep-clone via JSON — fine here since all onboarding values are
// JSON-serializable (no Dates, no Maps).
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

// ─── Component ────────────────────────────────────────────

export default function OnboardingWizard({
  clientId, clientName, initialProfile,
}: OnboardingWizardProps) {
  const router = useRouter()
  const { t } = useLocale()
  const tr = useCallback(
    (key: string) => t(key as TranslationKey),
    [t]
  )

  const initialOnboarding = initialProfile.onboarding

  // Local draft: we track the entire profile so SectionForm can
  // read any dotted path. Pending writes are auto-saved on a debounce.
  const [profile, setProfile] = useState<Record<string, unknown>>(
    () => clone(initialProfile as Record<string, unknown>)
  )
  const [skipped, setSkipped] = useState<Set<string>>(
    () => new Set(initialOnboarding?.skipped_fields ?? [])
  )
  const [completedSections, setCompletedSections] = useState<Set<string>>(
    () => new Set(initialOnboarding?.completed_sections ?? [])
  )

  const [activeStepIndex, setActiveStepIndex] = useState<number>(() => {
    const last = initialOnboarding?.last_section
    if (last) {
      const idx = ONBOARDING_SECTIONS.findIndex(s => s.id === last)
      if (idx >= 0) return idx
    }
    return 0
  })

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)

  // Debounced auto-save ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingValuesRef = useRef<Record<string, unknown>>({})
  const pendingSkippedRef = useRef<Set<string>>(new Set())

  const isDiscoveryStep = activeStepIndex === ONBOARDING_SECTIONS.length
  const activeSection = isDiscoveryStep ? null : ONBOARDING_SECTIONS[activeStepIndex]

  // ─── Auto-save ──────────────────────────────────────────
  const flushSave = useCallback(async (sectionId: string | null) => {
    const values = pendingValuesRef.current
    const skippedList = [...pendingSkippedRef.current]
    pendingValuesRef.current = {}
    pendingSkippedRef.current = new Set()

    if (Object.keys(values).length === 0 && skippedList.length === 0 && !sectionId) {
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/onboarding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id: sectionId,
          values,
          skipped_fields: skippedList,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [clientId])

  const scheduleSave = useCallback((sectionId: string | null) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void flushSave(sectionId)
    }, 1500)
  }, [flushSave])

  // Flush on unmount / tab close
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // ─── Field handlers ─────────────────────────────────────
  const handleFieldChange = useCallback((path: string, value: unknown) => {
    setProfile(prev => {
      const next = clone(prev)
      setAtPath(next, path, value)
      return next
    })
    // Remove from skipped if the user now filled it in.
    if (value !== undefined && value !== null && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      setSkipped(prev => {
        if (!prev.has(path)) return prev
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      pendingSkippedRef.current.delete(path)
    }
    pendingValuesRef.current[path] = value
    scheduleSave(activeSection?.id ?? null)
  }, [scheduleSave, activeSection])

  const handleFieldSkipToggle = useCallback((path: string) => {
    setSkipped(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    pendingSkippedRef.current.add(path)
    scheduleSave(activeSection?.id ?? null)
  }, [scheduleSave, activeSection])

  const markSectionCompleteAndSave = useCallback(async () => {
    if (!activeSection) return
    // Force-flush any pending fields first.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const values = pendingValuesRef.current
    const skippedList = [...pendingSkippedRef.current]
    pendingValuesRef.current = {}
    pendingSkippedRef.current = new Set()

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/onboarding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id: activeSection.id,
          values,
          skipped_fields: skippedList,
          mark_section_complete: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setCompletedSections(prev => new Set([...prev, activeSection.id]))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
      throw err
    } finally {
      setSaving(false)
    }
  }, [clientId, activeSection])

  const handleNext = useCallback(async () => {
    try {
      await markSectionCompleteAndSave()
      setActiveStepIndex(i => Math.min(i + 1, ONBOARDING_SECTIONS.length))
    } catch {
      // stay on current step, error already surfaced
    }
  }, [markSectionCompleteAndSave])

  const handleBack = useCallback(() => {
    setActiveStepIndex(i => Math.max(0, i - 1))
  }, [])

  const handleSkipSection = useCallback(() => {
    if (!activeSection) return
    // Mark every field in the section as skipped.
    const sectionPaths = activeSection.fields.map(f => f.path)
    setSkipped(prev => {
      const next = new Set(prev)
      for (const p of sectionPaths) next.add(p)
      return next
    })
    for (const p of sectionPaths) pendingSkippedRef.current.add(p)
    scheduleSave(activeSection.id)
    setActiveStepIndex(i => Math.min(i + 1, ONBOARDING_SECTIONS.length))
  }, [activeSection, scheduleSave])

  const handleSaveAndExit = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await flushSave(activeSection?.id ?? null)
    router.push(`/clients/${clientId}`)
  }, [flushSave, activeSection, router, clientId])

  const handleComplete = useCallback(async () => {
    setCompleting(true)
    setCompleteError(null)
    try {
      // Flush any pending changes first.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      await flushSave(activeSection?.id ?? null)

      const res = await fetch(`/api/clients/${clientId}/onboarding/complete`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Complete failed')
      router.push(`/clients/${clientId}`)
      router.refresh()
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Complete failed')
    } finally {
      setCompleting(false)
    }
  }, [clientId, flushSave, activeSection, router])

  // Progress metrics.
  const progress = useMemo(() => {
    const done = completedSections.size
    const total = ONBOARDING_SECTIONS.length
    return { done, total, pct: Math.round((done / total) * 100) }
  }, [completedSections])

  return (
    <div style={containerStyle}>
      {/* ── Sidebar ── */}
      <aside style={sidebarStyle}>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#8a8e97', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {tr('onboarding.wizard.client')}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', marginTop: '4px' }}>
            {clientName}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#8a8e97', marginBottom: '6px' }}>
            {tr('onboarding.wizard.progress')} {progress.done}/{progress.total}
          </div>
          <div style={{ height: '6px', background: '#1a1d25', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${progress.pct}%`,
              height: '100%',
              background: '#c8e64a',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        <nav>
          {ONBOARDING_SECTIONS.map((s, i) => {
            const active = i === activeStepIndex
            const completed = completedSections.has(s.id)
            return (
              <div
                key={s.id}
                onClick={() => setActiveStepIndex(i)}
                style={stepItemStyle(active, completed)}
              >
                <div style={stepBadgeStyle(active, completed)}>
                  {completed ? '✓' : i + 1}
                </div>
                <span>{tr(s.titleKey)}</span>
              </div>
            )
          })}
          <div
            onClick={() => setActiveStepIndex(ONBOARDING_SECTIONS.length)}
            style={stepItemStyle(isDiscoveryStep, false)}
          >
            <div style={stepBadgeStyle(isDiscoveryStep, false)}>
              {ONBOARDING_SECTIONS.length + 1}
            </div>
            <span>{tr('onboarding.wizard.discovery')}</span>
          </div>
        </nav>

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #2a2d35' }}>
          <button
            type="button"
            onClick={handleSaveAndExit}
            style={{ ...buttonSecondary, width: '100%', fontSize: '12px', padding: '8px' }}
          >
            {tr('onboarding.wizard.save_exit')}
          </button>
        </div>
      </aside>

      {/* ── Content ── */}
      <main style={contentStyle}>
        {saveError && (
          <div style={{
            padding: '10px 14px',
            background: '#ef444420',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            color: '#ef4444',
            fontSize: '13px',
            marginBottom: '16px',
          }}>
            {saveError}
          </div>
        )}

        {saving && (
          <div style={{ fontSize: '11px', color: '#8a8e97', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
            {tr('onboarding.wizard.saving')}
          </div>
        )}

        {activeSection && (
          <>
            <SectionForm
              section={activeSection}
              values={profile}
              skipped={skipped}
              onFieldChange={handleFieldChange}
              onFieldSkipToggle={handleFieldSkipToggle}
            />
            <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
              {activeStepIndex > 0 && (
                <button type="button" onClick={handleBack} style={buttonSecondary}>
                  {tr('onboarding.wizard.back')}
                </button>
              )}
              <button type="button" onClick={handleSkipSection} style={buttonSecondary}>
                {tr('onboarding.wizard.skip_section')}
              </button>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={handleNext} style={buttonPrimary} disabled={saving}>
                {saving ? tr('onboarding.wizard.saving') : tr('onboarding.wizard.next')}
              </button>
            </div>
          </>
        )}

        {isDiscoveryStep && (
          <>
            <h2 style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#ffffff',
              marginBottom: '8px',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {tr('onboarding.discovery.title')}
            </h2>
            <p style={{ fontSize: '14px', color: '#8a8e97', marginBottom: '20px', lineHeight: 1.6 }}>
              {tr('onboarding.discovery.description')}
            </p>
            <OnboardingDiscoveryChat clientId={clientId} />

            {completeError && (
              <div style={{
                padding: '10px 14px',
                background: '#ef444420',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                color: '#ef4444',
                fontSize: '13px',
                marginTop: '16px',
              }}>
                {completeError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button type="button" onClick={handleBack} style={buttonSecondary}>
                {tr('onboarding.wizard.back')}
              </button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                style={{ ...buttonPrimary, opacity: completing ? 0.6 : 1 }}
              >
                {completing
                  ? tr('onboarding.wizard.completing')
                  : tr('onboarding.wizard.complete')}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// Silence unused symbol warnings if build hoists local helpers differently.
void DISCOVERY_STEP_ID
