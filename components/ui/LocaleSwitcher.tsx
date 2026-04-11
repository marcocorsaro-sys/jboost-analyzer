'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale, LOCALE_LABELS, type Locale } from '@/lib/i18n'

const LOCALES: Locale[] = ['en', 'it', 'es', 'fr']

export default function LocaleSwitcher() {
  const { locale, setLocale } = useLocale()
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '4px 10px',
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: 'var(--gray)',
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace",
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--white)'
          e.currentTarget.style.borderColor = 'var(--gray)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--gray)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        {locale.toUpperCase()}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '6px',
            background: '#1a1c24',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            overflow: 'hidden',
            zIndex: 50,
            minWidth: '130px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          }}
        >
          {LOCALES.map(l => (
            <button
              key={l}
              onClick={() => {
                setLocale(l)
                setIsOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: '12px',
                color: l === locale ? '#c8e64a' : '#a0a0a0',
                background: l === locale ? 'rgba(200, 230, 74, 0.08)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (l !== locale) e.currentTarget.style.background = '#2a2d35'
              }}
              onMouseLeave={e => {
                if (l !== locale) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{ fontWeight: 700, textTransform: 'uppercase', width: '20px' }}>
                {l}
              </span>
              <span style={{ fontWeight: 400, fontSize: '11px' }}>
                {LOCALE_LABELS[l]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
