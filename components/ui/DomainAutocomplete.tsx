'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface DomainSuggestions {
  clients: string[]
  suggestions: string[]
}

interface DomainAutocompleteProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  error?: boolean
  /** When true, allows full URLs (https://...) without stripping protocol */
  showWebsiteVariant?: boolean
  className?: string
  style?: React.CSSProperties
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
}

export default function DomainAutocomplete({
  value,
  onChange,
  placeholder = 'example.com',
  disabled = false,
  error = false,
  showWebsiteVariant = false,
  className,
  style,
  onFocus,
  onBlur,
}: DomainAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<DomainSuggestions>({ clients: [], suggestions: [] })
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flatten suggestions for keyboard navigation
  const allItems = [...suggestions.clients, ...suggestions.suggestions]

  // Debounced fetch
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions({ clients: [], suggestions: [] })
      setIsOpen(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/domains/suggest?q=${encodeURIComponent(query)}&limit=8`)
      if (res.ok) {
        const data = await res.json()
        setSuggestions(data)
        if (data.clients.length > 0 || data.suggestions.length > 0) {
          setIsOpen(true)
        }
      }
    } catch {
      // Silent fail
    }
    setLoading(false)
  }, [])

  // Debounce input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // For website variant, strip protocol for search
      const searchQuery = showWebsiteVariant
        ? value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
        : value
      fetchSuggestions(searchQuery)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, fetchSuggestions, showWebsiteVariant])

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

  const handleSelect = (domain: string) => {
    if (showWebsiteVariant) {
      onChange(`https://${domain}`)
    } else {
      onChange(domain)
    }
    setIsOpen(false)
    setHighlightIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || allItems.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex(prev => (prev + 1) % allItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex(prev => (prev - 1 + allItems.length) % allItems.length)
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      handleSelect(allItems[highlightIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setHighlightIndex(-1)
    }
  }

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (allItems.length > 0) setIsOpen(true)
    onFocus?.(e)
  }

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      onBlur?.(e)
    }, 150)
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        style={style}
        autoComplete="off"
      />

      {/* Dropdown */}
      {isOpen && allItems.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            background: '#1a1c24',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            maxHeight: '280px',
            overflowY: 'auto',
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Client domains section */}
          {suggestions.clients.length > 0 && (
            <>
              <div
                style={{
                  padding: '6px 12px',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Your domains
              </div>
              {suggestions.clients.map((domain, idx) => (
                <button
                  key={`client-${domain}`}
                  type="button"
                  onMouseDown={() => handleSelect(domain)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontSize: '13px',
                    color: highlightIndex === idx ? '#c8e64a' : '#e0e0e0',
                    background: highlightIndex === idx ? 'rgba(200, 230, 74, 0.08)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {domain}
                </button>
              ))}
            </>
          )}

          {/* TLD suggestions section */}
          {suggestions.suggestions.length > 0 && (
            <>
              {suggestions.clients.length > 0 && (
                <div style={{ borderTop: '1px solid #2a2d35', margin: '4px 0' }} />
              )}
              <div
                style={{
                  padding: '6px 12px',
                  fontSize: '10px',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Suggestions
              </div>
              {suggestions.suggestions.map((domain, idx) => {
                const absoluteIdx = suggestions.clients.length + idx
                return (
                  <button
                    key={`suggest-${domain}`}
                    type="button"
                    onMouseDown={() => handleSelect(domain)}
                    onMouseEnter={() => setHighlightIndex(absoluteIdx)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontSize: '13px',
                      color: highlightIndex === absoluteIdx ? '#c8e64a' : '#a0a0a0',
                      background: highlightIndex === absoluteIdx ? 'rgba(200, 230, 74, 0.08)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {domain}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '14px',
            height: '14px',
            border: '2px solid #2a2d35',
            borderTopColor: '#c8e64a',
            borderRadius: '50%',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      )}

      <style jsx>{`
        @keyframes spin {
          to { transform: translateY(-50%) rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
