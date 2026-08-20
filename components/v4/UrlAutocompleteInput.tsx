'use client'

/**
 * Template-URL input with sitemap autocomplete (V4 setup wizard).
 *
 * The analyst types and picks a REAL URL of the site instead of pasting one:
 * on focus the field loads the domain's sitemap URLs once (through the
 * wizard-provided `fetchSitemapFor`, which memoizes per domain so N fields
 * cost 1 fetch) and, while typing, shows up to 8 suggestions ranked by
 * rankSitemapUrls (template-role match first, then shortest).
 *
 * Keyboard: ↓/↑ move, Enter selects, Esc closes. Blur closes with a small
 * delay (so a click on an option still lands) and commits through onCommit,
 * where the wizard applies its existing URL normalization. Everything
 * degrades to a plain manual input: no sitemap → a discreet hint, never an
 * error.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import {
  isBareDomain,
  rankSitemapUrls,
  type SitemapUrlEntry,
} from '@/lib/v4/url-autocomplete'

// Same palette as SetupWizard (dark, #2a2d35 borders, lime highlight).
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: '#111318',
  border: '1px solid #2a2d35',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '14px',
  outline: 'none',
  fontFamily: 'inherit',
}

const invalidInputStyle: React.CSSProperties = { ...inputStyle, border: '1px solid #ef4444' }

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  zIndex: 30,
  background: '#111318',
  border: '1px solid #2a2d35',
  borderRadius: '8px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
  maxHeight: '260px',
  overflowY: 'auto',
}

const optionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  color: '#e5e7eb',
  fontSize: '13px',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const statusStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '12px',
  color: '#6b7280',
}

/** Bold-lime the typed substring inside a suggestion. */
function highlightMatch(url: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase()
  if (!q) return url
  const i = url.toLowerCase().indexOf(q)
  if (i < 0) return url
  return (
    <>
      {url.slice(0, i)}
      <span style={{ color: '#c8e64a', fontWeight: 700 }}>{url.slice(i, i + q.length)}</span>
      {url.slice(i + q.length)}
    </>
  )
}

export default function UrlAutocompleteInput({
  value,
  onChange,
  onCommit,
  domain,
  templateKey,
  fetchSitemapFor,
  placeholder,
  invalid = false,
}: {
  value: string
  /** Every keystroke (controlled input). */
  onChange: (value: string) => void
  /** Blur/selection: the wizard applies its URL normalization here. */
  onCommit: (value: string) => void
  /** Bare domain of the site this field belongs to ('' disables the fetch). */
  domain: string
  /** TemplateKey of lib/v4/setup — drives the role-priority ranking. */
  templateKey: string
  /** Wizard-memoized loader: same domain twice = one network fetch. */
  fetchSitemapFor: (domain: string) => Promise<SitemapUrlEntry[]>
  placeholder?: string
  invalid?: boolean
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [urls, setUrls] = useState<SitemapUrlEntry[] | null>(null)
  const [active, setActive] = useState(-1)

  // Refs so the delayed blur commit reads the latest value, not a stale one.
  const valueRef = useRef(value)
  valueRef.current = value
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedDomain = useRef<string | null>(null)

  // Domain changed (analyst edited the site field): the loaded list is stale.
  useEffect(() => {
    if (loadedDomain.current !== null && loadedDomain.current !== domain) {
      loadedDomain.current = null
      setUrls(null)
    }
  }, [domain])

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    },
    [],
  )

  const ensureLoaded = () => {
    if (!isBareDomain(domain) || loadedDomain.current === domain) return
    loadedDomain.current = domain
    setLoading(true)
    const requested = domain
    void fetchSitemapFor(domain)
      .then((entries) => {
        // Ignore a late answer for a domain the field no longer points at.
        if (loadedDomain.current !== requested) return
        setUrls(entries)
      })
      .catch(() => {
        if (loadedDomain.current !== requested) return
        setUrls([])
      })
      .finally(() => {
        if (loadedDomain.current === requested) setLoading(false)
      })
  }

  const suggestions =
    open && urls !== null ? rankSitemapUrls(urls, { query: value, templateKey }) : []

  const select = (url: string) => {
    onChange(url)
    onCommit(url)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0 && active < suggestions.length) {
      e.preventDefault()
      select(suggestions[active].url)
    }
  }

  const showDropdown = open && isBareDomain(domain) && (loading || urls !== null)

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={invalid ? invalidInputStyle : inputStyle}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => {
          ensureLoaded()
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so a mousedown/click on an option wins over the blur.
          if (blurTimer.current) clearTimeout(blurTimer.current)
          blurTimer.current = setTimeout(() => {
            setOpen(false)
            setActive(-1)
            onCommit(valueRef.current)
          }, 150)
        }}
      />
      {showDropdown && (
        <div
          style={dropdownStyle}
          role="listbox"
          // Keep focus on the input: the blur (and its commit) must not fire
          // before the option's onClick.
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && <div style={statusStyle}>{t('v4setup.autocomplete_loading')}</div>}
          {!loading && urls !== null && urls.length === 0 && (
            <div style={statusStyle}>{t('v4setup.autocomplete_empty')}</div>
          )}
          {!loading && urls !== null && urls.length > 0 && suggestions.length === 0 && (
            <div style={statusStyle}>{t('v4setup.autocomplete_no_match')}</div>
          )}
          {!loading &&
            suggestions.map((s, i) => (
              <button
                key={s.url}
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => select(s.url)}
                onMouseEnter={() => setActive(i)}
                style={{
                  ...optionStyle,
                  background: i === active ? '#c8e64a15' : 'transparent',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl', // long URLs: keep the distinctive tail visible
                    textAlign: 'left',
                  }}
                >
                  <bdi>{highlightMatch(s.url, value)}</bdi>
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#6b7280',
                    fontFamily: "'JetBrains Mono', monospace",
                    flexShrink: 0,
                  }}
                >
                  {s.role}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
