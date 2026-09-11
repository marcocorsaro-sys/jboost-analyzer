'use client'

/**
 * V4 — Note globali di progetto (review item 12, in spec).
 *
 * One free-form note that lives on analyses.v4_setup.global_notes (no
 * migration: v4_setup is already the wizard's jsonb). Saved via the minimal
 * notes-only PATCH on /api/v4/analyses/[id]; the LLM orchestrator appends the
 * note to EVERY insight call as the `global_notes` prompt field
 * (lib/v4/llm/prompts.ts globalNotesClause).
 */

import { useState } from 'react'
import { useLocale } from '@/lib/i18n'
import { card, sectionTitle, ghostButton, primaryButton } from './results-shared'
import { B } from '@/lib/brand'

export default function GlobalNotesDialog({
  analysisId,
  initialNotes,
  onClose,
  onSaved,
}: {
  analysisId: string
  initialNotes: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/v4/analyses/${analysisId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ global_notes: notes }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `errore ${res.status}`)
        return
      }
      setNote(t('v4res.notes_saved'))
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'errore di rete')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: B.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '24px',
      }}
      onClick={onClose}
    >
      <div
        style={{ ...card, width: 'min(680px, 100%)', maxHeight: '85vh', overflowY: 'auto', boxShadow: B.shadow.dialog }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={sectionTitle}>{t('v4res.notes_title')}</h3>
        <div style={{ fontSize: '15px', color: B.muted, lineHeight: 1.6, marginBottom: '14px' }}>
          {t('v4res.notes_hint')}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('v4res.notes_placeholder')}
          style={{
            width: '100%',
            minHeight: '220px',
            resize: 'vertical',
            padding: '12px 16px',
            background: B.bg,
            border: `1px solid ${B.border}`,
            borderRadius: B.radius.input,
            color: B.ink,
            fontSize: '16px',
            lineHeight: 1.5,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        {error && <div style={{ marginTop: '10px', fontSize: '14px', color: B.error }}>{t('v4res.notes_error')}: {error}</div>}
        {note && <div style={{ marginTop: '10px', fontSize: '14px', color: B.primary }}>{note}</div>}

        <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
          <button type="button" onClick={save} disabled={saving} style={primaryButton(!saving)}>
            {saving ? t('v4res.notes_saving') : t('v4res.notes_save')}
          </button>
          <button type="button" onClick={onClose} style={ghostButton}>
            {t('v4res.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
