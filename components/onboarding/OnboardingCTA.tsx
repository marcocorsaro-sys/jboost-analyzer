'use client'

// ============================================================
// JBoost — Phase 5D — OnboardingCTA
//
// Card shown on the client detail page when
// `profile.onboarding.status !== 'completed'`. Invites the
// user to start/resume the structured onboarding wizard.
// ============================================================

import Link from 'next/link'
import { useCallback } from 'react'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

interface OnboardingCTAProps {
  clientId: string
  status: 'not_started' | 'in_progress' | 'completed'
  completedSections: number
  totalSections: number
}

export default function OnboardingCTA({
  clientId, status, completedSections, totalSections,
}: OnboardingCTAProps) {
  const { t } = useLocale()
  const tr = useCallback(
    (key: string) => t(key as TranslationKey),
    [t]
  )

  if (status === 'completed') return null

  const pct = Math.round((completedSections / Math.max(1, totalSections)) * 100)
  const isResume = status === 'in_progress' && completedSections > 0

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f1115 0%, #1a1d25 100%)',
      border: '1px solid #c8e64a60',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px',
      display: 'flex',
      alignItems: 'center',
      gap: '24px',
    }}>
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: '12px',
        background: '#c8e64a',
        color: '#111318',
        fontSize: '24px',
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'JetBrains Mono', monospace",
        flexShrink: 0,
      }}>
        1.
      </div>

      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: '11px',
          color: '#c8e64a',
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '4px',
        }}>
          {tr('onboarding.cta.label')}
        </div>
        <div style={{
          fontSize: '18px',
          fontWeight: 700,
          color: '#ffffff',
          marginBottom: '6px',
        }}>
          {isResume ? tr('onboarding.cta.resume_title') : tr('onboarding.cta.start_title')}
        </div>
        <div style={{ fontSize: '13px', color: '#8a8e97', lineHeight: 1.6 }}>
          {tr('onboarding.cta.description')}
        </div>

        {isResume && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, height: '4px', background: '#1a1d25', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`,
                height: '100%',
                background: '#c8e64a',
              }} />
            </div>
            <span style={{ fontSize: '11px', color: '#c8e64a', fontFamily: "'JetBrains Mono', monospace" }}>
              {completedSections}/{totalSections}
            </span>
          </div>
        )}
      </div>

      <Link
        href={`/clients/${clientId}/onboarding`}
        style={{
          padding: '12px 24px',
          background: '#c8e64a',
          color: '#111318',
          border: 'none',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 700,
          textDecoration: 'none',
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          flexShrink: 0,
        }}
      >
        {isResume ? tr('onboarding.cta.resume_button') : tr('onboarding.cta.start_button')}
      </Link>
    </div>
  )
}
