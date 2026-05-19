'use client'

// "Fotografia MarTech solida": 4 big cards — CMS, Web Analytics,
// Core Web Vitals Desktop, Core Web Vitals Mobile. Everything else
// (CDN, tag manager, marketing automation, etc.) is still available
// via the "Mostra dettaglio completo" toggle on the parent page.

interface MartechTool {
  id: string
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
}

interface CwvData {
  performance_score?: number
  accessibility_score?: number
  seo_score?: number
  best_practices_score?: number
}

interface MartechEssentialsProps {
  tools: MartechTool[]
  cwv: {
    mobile: CwvData | null
    desktop: CwvData | null
    analysis_date: string | null
  } | null
}

const ESSENTIAL_CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'cms', label: 'CMS', hint: 'Content Management / DXP' },
  { key: 'analytics', label: 'Web Analytics', hint: 'Web Analytics & BI' },
]

function scoreColor(score: number | undefined | null): string {
  if (score === null || score === undefined) return '#6b7280'
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#38bdf8'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

function scoreLabel(score: number | undefined | null): string {
  if (score === null || score === undefined) return '—'
  return String(Math.round(score))
}

function CategoryCard({
  label,
  hint,
  tools,
}: {
  label: string
  hint: string
  tools: MartechTool[]
}) {
  const sorted = [...tools].sort((a, b) => b.confidence - a.confidence)
  const primary = sorted[0] ?? null
  const others = sorted.slice(1, 4)

  return (
    <div style={{
      background: '#1a1c24',
      borderRadius: '14px',
      border: '1px solid #2a2d35',
      padding: '28px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      minHeight: '220px',
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '11px',
        fontWeight: 700,
        color: '#c8e64a',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
      }}>
        {label}
      </div>

      {primary ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '40px',
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-1px',
            lineHeight: '1.05',
            wordBreak: 'break-word',
          }}>
            {primary.tool_name}
          </div>
          {primary.tool_version && (
            <div style={{ fontSize: '12px', color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace" }}>
              v{primary.tool_version}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '40px',
          fontWeight: 700,
          color: '#4b5563',
          letterSpacing: '-1px',
          lineHeight: '1.05',
        }}>
          —
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ fontSize: '12px', color: '#6b7280' }}>
        {primary
          ? `${Math.round(primary.confidence * 100)}% confidence · ${hint}`
          : hint}
      </div>
      {others.length > 0 && (
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
          + {others.map(t => t.tool_name).join(', ')}
        </div>
      )}
    </div>
  )
}

function CwvCard({
  label,
  data,
}: {
  label: 'Mobile' | 'Desktop'
  data: CwvData | null
}) {
  const perf = data?.performance_score ?? null
  const seo = data?.seo_score ?? null
  const a11y = data?.accessibility_score ?? null
  const bp = data?.best_practices_score ?? null
  const overall = perf ?? null

  return (
    <div style={{
      background: '#1a1c24',
      borderRadius: '14px',
      border: `1px solid ${scoreColor(overall)}40`,
      padding: '28px',
      display: 'flex',
      flexDirection: 'column',
      gap: '18px',
      minHeight: '220px',
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '11px',
        fontWeight: 700,
        color: '#c8e64a',
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
      }}>
        Core Web Vitals · {label}
      </div>

      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '72px',
        fontWeight: 700,
        color: scoreColor(overall),
        lineHeight: '1',
        letterSpacing: '-2px',
      }}>
        {scoreLabel(overall)}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '8px',
        fontSize: '12px',
        paddingTop: '12px',
        borderTop: '1px solid #2a2d35',
      }}>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>SEO</div>
          <div style={{ color: scoreColor(seo), fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px' }}>{scoreLabel(seo)}</div>
        </div>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>A11Y</div>
          <div style={{ color: scoreColor(a11y), fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px' }}>{scoreLabel(a11y)}</div>
        </div>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '2px' }}>Best Pr.</div>
          <div style={{ color: scoreColor(bp), fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '16px' }}>{scoreLabel(bp)}</div>
        </div>
      </div>
    </div>
  )
}

export default function MartechEssentials({ tools, cwv }: MartechEssentialsProps) {
  const byCategory: Record<string, MartechTool[]> = {}
  for (const t of tools) {
    if (!t?.category) continue
    if (!byCategory[t.category]) byCategory[t.category] = []
    byCategory[t.category].push(t)
  }

  const desktopMissing = !cwv?.desktop && !!cwv?.mobile

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '14px',
      }}>
        {ESSENTIAL_CATEGORIES.map(cat => (
          <CategoryCard
            key={cat.key}
            label={cat.label}
            hint={cat.hint}
            tools={byCategory[cat.key] ?? []}
          />
        ))}

        <CwvCard label="Desktop" data={cwv?.desktop ?? null} />
        <CwvCard label="Mobile" data={cwv?.mobile ?? null} />
      </div>

      {desktopMissing && (
        <div style={{
          padding: '10px 14px',
          background: '#1a1c24',
          borderRadius: '8px',
          border: '1px solid #2a2d35',
          fontSize: '11px',
          color: '#6b7280',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          ℹ Il dato Desktop non è ancora presente — verrà popolato al prossimo run di analisi.
        </div>
      )}

      {cwv?.analysis_date && (
        <div style={{
          fontSize: '10px',
          color: '#4b5563',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: '0.5px',
        }}>
          CWV da analisi completata il {new Date(cwv.analysis_date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
      )}
    </div>
  )
}
