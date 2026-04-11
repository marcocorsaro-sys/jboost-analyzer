'use client'

interface MarkdownRendererProps {
  content: string
  /**
   * Color theme for headers and accents.
   * 'lime' = #c8e64a (dark bg), 'dark' = #111318 (light bg)
   */
  accentColor?: string
  textColor?: string
}

/**
 * Renders markdown-like content with styled headers, lists, bold, code, and HR.
 * Used by ExecutiveSummary page and ChatMessage component.
 */
export default function MarkdownRenderer({
  content,
  accentColor = '#c8e64a',
  textColor = '#e0e0e0',
}: MarkdownRendererProps) {
  return (
    <div style={{ fontSize: '14px', lineHeight: '1.7', color: textColor }}>
      {content.split('\n').map((line, i) => {
        // Horizontal rule
        if (line.trim() === '---' || line.trim() === '***') {
          return (
            <hr key={i} style={{
              border: 'none',
              borderTop: '1px solid #2a2d35',
              margin: '16px 0',
            }} />
          )
        }

        // Headers
        if (line.startsWith('### ')) {
          return (
            <div key={i} style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '13px',
              fontWeight: 700,
              color: accentColor,
              marginTop: i > 0 ? '14px' : 0,
              marginBottom: '4px',
            }}>
              {renderInline(line.replace('### ', ''), accentColor, textColor)}
            </div>
          )
        }
        if (line.startsWith('## ')) {
          return (
            <div key={i} style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '15px',
              fontWeight: 700,
              color: accentColor,
              marginTop: i > 0 ? '20px' : 0,
              marginBottom: '8px',
              paddingBottom: '4px',
              borderBottom: '1px solid rgba(200, 230, 74, 0.15)',
            }}>
              {renderInline(line.replace('## ', ''), accentColor, textColor)}
            </div>
          )
        }
        if (line.startsWith('# ')) {
          return (
            <div key={i} style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '18px',
              fontWeight: 700,
              color: accentColor,
              marginTop: i > 0 ? '24px' : 0,
              marginBottom: '12px',
            }}>
              {renderInline(line.replace('# ', ''), accentColor, textColor)}
            </div>
          )
        }

        // Bullet points
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} style={{ paddingLeft: '16px', position: 'relative', marginBottom: '2px' }}>
              <span style={{ position: 'absolute', left: 0, color: accentColor }}>•</span>
              {renderInline(line.slice(2), accentColor, textColor)}
            </div>
          )
        }

        // Indented bullets (  - )
        if (line.startsWith('  - ') || line.startsWith('  * ')) {
          return (
            <div key={i} style={{ paddingLeft: '32px', position: 'relative', marginBottom: '2px' }}>
              <span style={{ position: 'absolute', left: 16, color: '#6b7280' }}>◦</span>
              {renderInline(line.slice(4), accentColor, textColor)}
            </div>
          )
        }

        // Numbered lists
        const numMatch = line.match(/^(\d+)\.\s/)
        if (numMatch) {
          return (
            <div key={i} style={{ paddingLeft: '24px', position: 'relative', marginBottom: '2px' }}>
              <span style={{
                position: 'absolute',
                left: 0,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                color: accentColor,
                fontWeight: 600,
              }}>
                {numMatch[1]}.
              </span>
              {renderInline(line.slice(numMatch[0].length), accentColor, textColor)}
            </div>
          )
        }

        // Empty line
        if (line.trim() === '') {
          return <div key={i} style={{ height: '8px' }} />
        }

        // Regular text
        return <div key={i}>{renderInline(line, accentColor, textColor)}</div>
      })}
    </div>
  )
}

function renderInline(text: string, accentColor: string, textColor: string) {
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} style={{ fontWeight: 700, color: '#ffffff' }}>
              {renderCode(part.slice(2, -2), accentColor)}
            </strong>
          )
        }
        return <span key={i}>{renderCode(part, accentColor)}</span>
      })}
    </span>
  )
}

function renderCode(text: string, accentColor: string) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((cp, j) => {
    if (cp.startsWith('`') && cp.endsWith('`')) {
      return (
        <code key={j} style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: `${accentColor}15`,
          color: accentColor,
        }}>
          {cp.slice(1, -1)}
        </code>
      )
    }
    return <span key={j}>{cp}</span>
  })
}
