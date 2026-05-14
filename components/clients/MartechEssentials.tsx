'use client'

// PR6: stripped-down martech view — only the 6 categories useful for
// organic SEO reasoning, plus Core Web Vitals mobile + desktop pulled
// from the client's latest completed analysis. Replaces the dense
// MartechGrid in the main martech tab; the full grid is still
// available behind a "Mostra tutto" toggle below for power users.

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

/** Categories the user explicitly wants surfaced.
 *  Order matters: this is also the display order. */
const ESSENTIAL_CATEGORIES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'cms', label: 'CMS', hint: 'Content Management / DXP' },
  { key: 'cdn', label: 'CDN', hint: 'Content Delivery Network' },
  { key: 'analytics', label: 'Analytics', hint: 'Web Analytics & BI' },
  { key: 'tag_manager', label: 'Tag Manager', hint: 'Tag Management & Data Layer' },
  { key: 'marketing_automation', label: 'Marketing Automation', hint: 'Lead Nurturing & Campaigns' },
  { key: 'seo', label: 'Schema / SEO', hint: 'Structured Data & SEO Tooling' },
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

function PrimaryTool({ tool, fallback }: { tool: MartechTool | null; fallback: string }) {
  if (!tool) {
    return (
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '28px',
        fontWeight: 700,
        color: '#4b5563',
        letterSpacing: '-0.5px',
        lineHeight: '1.1',
      }}>
        {fallback}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '28px',
        fontWeight: 700,
        color: '#ffffff',
        letterSpacing: '-0.5px',
        lineHeight: '1.1',
        wordBreak: 'break-word',
      }}>
        {tool.tool_name}
      </div>
      {tool.tool_version && (
        <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace" }}>
          v{tool.tool_version}
        </div>
      )}
    </div>
  )
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
  // Pick the highest-confidence tool as the "primary" for the big label,
  // and surface the others as secondaries below.
  const sorted = [...tools].sort((a, b) => b.confidence - a.confidence)
  const primary = sorted[0] ?? null
  const others = sorted.slice(1)

  return (
    <div style={{
      background: '#1a1c24',
      borderRadius: '12px',
      border: '1px solid #2a2d35',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      minHeight: '140px',
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        fontWeight: 700,
        color: '#c8e64a',
        textTransform: 'uppercase',
        letterSpacing: '1px',
      }}>
        {label}
      </div>
      <PrimaryTool tool={primary} fallback="—" />
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: '11px', color: '#6b7280' }}>
        {primary
          ? `${Math.round(primary.confidence * 100)}% confidence · ${hint}`
          : hint}
      </div>
      {others.length > 0 && (
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>
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
      borderRadius: '12px',
      border: `1px solid ${scoreColor(overall)}40`,
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      minHeight: '140px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          fontWeight: 700,
          color: '#c8e64a',
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}>
          Core Web Vitals · {label}
        </div>
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '44px',
        fontWeight: 700,
        color: scoreColor(overall),
        lineHeight: '1',
        letterSpacing: '-1px',
      }}>
        {scoreLabel(overall)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', fontSize: '11px' }}>
        <div>
          <div style={{ color: '#6b7280' }}>SEO</div>
          <div style={{ color: scoreColor(seo), fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scoreLabel(seo)}</div>
        </div>
        <div>
          <div style={{ color: '#6b7280' }}>A11Y</div>
          <div style={{ color: scoreColor(a11y), fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scoreLabel(a11y)}</div>
        </div>
        <div>
          <div style={{ color: '#6b7280' }}>Best Practices</div>
          <div style={{ color: scoreColor(bp), fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{scoreLabel(bp)}</div>
        </div>
      </div>
    </div>
  )
}

export default function MartechEssentials({ tools, cwv }: MartechEssentialsProps) {
  // Bucket tools by their category. Defensive against malformed input.
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
      }}>
        {ESSENTIAL_CATEGORIES.map(cat => (
          <CategoryCard
            key={cat.key}
            label={cat.label}
            hint={cat.hint}
            tools={byCategory[cat.key] ?? []}
          />
        ))}

        <CwvCard label="Mobile" data={cwv?.mobile ?? null} />
        <CwvCard label="Desktop" data={cwv?.desktop ?? null} />
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
          ℹ Il dato Desktop non è ancora presente — verrà popolato al prossimo run di analisi (PSI desktop aggiunto in PR6).
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
