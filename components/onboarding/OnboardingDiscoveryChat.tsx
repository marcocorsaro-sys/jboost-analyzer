'use client'

// ============================================================
// JBoost — Phase 5D — OnboardingDiscoveryChat
//
// Minimal chat surface wired to the discovery endpoint. Claude
// asks open-ended questions and pins atomic facts via the
// save_fact tool (executed server-side; we just render the
// text messages here).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat } from 'ai/react'
import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'
import { B } from '@/lib/brand'

interface OnboardingDiscoveryChatProps {
  clientId: string
}

const bubbleBase: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '12px',
  fontSize: '14px',
  lineHeight: 1.6,
  maxWidth: '80%',
  whiteSpace: 'pre-wrap',
}

const userBubble: React.CSSProperties = {
  ...bubbleBase,
  alignSelf: 'flex-end',
  background: B.primary,
  color: B.bg,
}

const assistantBubble: React.CSSProperties = {
  ...bubbleBase,
  alignSelf: 'flex-start',
  background: B.surface,
  color: B.ink,
  border: `1px solid ${B.border}`,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  background: B.bg,
  border: `1px solid ${B.border}`,
  borderRadius: '8px',
  color: B.ink,
  fontSize: '14px',
  outline: 'none',
}

const sendButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: B.primary,
  color: B.bg,
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: B.fontMono,
}

export default function OnboardingDiscoveryChat({ clientId }: OnboardingDiscoveryChatProps) {
  const { t } = useLocale()
  const tr = useCallback(
    (key: string) => t(key as TranslationKey),
    [t]
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ending, setEnding] = useState(false)

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: `/api/clients/${clientId}/onboarding/discovery`,
    initialMessages: [
      {
        id: 'welcome',
        role: 'assistant',
        content:
          'Ciao, prima di chiudere l\'onboarding facciamo una chiacchierata di discovery qualitativa. Cominciamo dal brand: al di la\' del posizionamento ufficiale, cosa rende davvero unico questo cliente rispetto ai suoi competitor diretti?',
      },
    ],
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleEndDiscovery = useCallback(async () => {
    setEnding(true)
    try {
      await fetch(`/api/clients/${clientId}/onboarding/discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end: true, messages: [] }),
      })
    } finally {
      setEnding(false)
    }
  }, [clientId])

  return (
    <div>
      <div
        ref={scrollRef}
        style={{
          height: '400px',
          overflowY: 'auto',
          padding: '16px',
          background: B.surface2,
          border: `1px solid ${B.border}`,
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.map(m => (
          <div
            key={m.id}
            style={m.role === 'user' ? userBubble : assistantBubble}
          >
            {m.content}
          </div>
        ))}
        {isLoading && (
          <div style={{ ...assistantBubble, opacity: 0.6 }}>…</div>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: '12px',
          padding: '10px 14px',
          background: `${B.error}20`,
          border: `1px solid ${B.error}`,
          borderRadius: '8px',
          color: B.error,
          fontSize: '13px',
        }}>
          {error.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
        <input
          style={inputStyle}
          value={input}
          onChange={handleInputChange}
          placeholder={tr('onboarding.discovery.placeholder')}
          disabled={isLoading}
        />
        <button type="submit" style={sendButtonStyle} disabled={isLoading || !input.trim()}>
          {tr('onboarding.discovery.send')}
        </button>
      </form>

      <div style={{ marginTop: '10px', fontSize: '12px', color: B.muted }}>
        <button
          type="button"
          onClick={handleEndDiscovery}
          disabled={ending}
          style={{
            background: 'transparent',
            border: 'none',
            color: B.muted,
            cursor: 'pointer',
            fontSize: '12px',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          {ending ? '…' : tr('onboarding.discovery.end')}
        </button>
      </div>
    </div>
  )
}
