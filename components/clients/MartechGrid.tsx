'use client'

import { MARTECH_CATEGORIES, CATEGORY_MAP, AREA_LABELS, type MartechCategoryDef } from '@/lib/martech/categories'

interface MartechTool {
  id: string
  category: string
  tool_name: string
  tool_version: string | null
  confidence: number
  details: Record<string, unknown> | null
  detected_at: string
}

interface MartechGridProps {
  tools: MartechTool[]
}

const CONFIDENCE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: '#22c55e10', text: '#22c55e', border: '#22c55e30' },
  medium: { bg: '#f59e0b10', text: '#f59e0b', border: '#f59e0b30' },
  low: { bg: '#ef444410', text: '#ef4444', border: '#ef444430' },
}

const AREA_COLORS: Record<string, { accent: string; bg: string }> = {
  platform: { accent: '#818cf8', bg: '#818cf810' },
  data: { accent: '#38bdf8', bg: '#38bdf810' },
  acquisition: { accent: '#c8e64a', bg: '#c8e64a10' },
  experience: { accent: '#fb923c', bg: '#fb923c10' },
  infrastructure: { accent: '#a78bfa', bg: '#a78bfa10' },
  governance: { accent: '#f472b6', bg: '#f472b610' },
}

function getConfidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'medium'
  return 'low'
}

// Get ordered areas that have tools
function getAreasWithTools(tools: MartechTool[]): string[] {
  const toolCategories = new Set(tools.map(t => t.category))
  const areasWithTools = new Set<string>()

  for (const cat of MARTECH_CATEGORIES) {
    if (toolCategories.has(cat.key)) {
      areasWithTools.add(cat.area)
    }
  }

  // Maintain area order
  const areaOrder = ['platform', 'data', 'acquisition', 'experience', 'infrastructure', 'governance']
  return areaOrder.filter(a => areasWithTools.has(a))
}

export default function MartechGrid({ tools }: MartechGridProps) {
  // Group tools by category
  const grouped: Record<string, MartechTool[]> = {}
  for (const tool of tools) {
    if (!grouped[tool.category]) grouped[tool.category] = []
    grouped[tool.category].push(tool)
  }

  // Get areas that have tools
  const areas = getAreasWithTools(tools)

  // Group categories by area
  const categoriesByArea: Record<string, MartechCategoryDef[]> = {}
  for (const area of areas) {
    categoriesByArea[area] = MARTECH_CATEGORIES.filter(
      c => c.area === area && grouped[c.key]
    )
  }

  // Collect any unknown categories
  const knownKeys = new Set(MARTECH_CATEGORIES.map(c => c.key))
  const unknownCategories = Object.keys(grouped).filter(k => !knownKeys.has(k))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Summary bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${areas.length}, 1fr)`,
        gap: '8px',
      }}>
        {areas.map(area => {
          const areaColor = AREA_COLORS[area] || AREA_COLORS.governance
          const areaCats = categoriesByArea[area] || []
          const toolCount = areaCats.reduce((sum, cat) => sum + (grouped[cat.key]?.length || 0), 0)

          return (
            <div key={area} style={{
              background: areaColor.bg,
              borderRadius: '8px',
              border: `1px solid ${areaColor.accent}20`,
              padding: '10px 14px',
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: 700,
                color: areaColor.accent,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {toolCount}
              </div>
              <div style={{
                fontSize: '10px',
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {AREA_LABELS[area]?.split(' & ')[0] || area}
              </div>
            </div>
          )
        })}
      </div>

      {/* Areas */}
      {areas.map(area => {
        const areaColor = AREA_COLORS[area] || AREA_COLORS.governance
        const areaCats = categoriesByArea[area] || []
        const totalTools = areaCats.reduce((sum, cat) => sum + (grouped[cat.key]?.length || 0), 0)

        return (
          <div key={area} style={{
            borderRadius: '14px',
            border: `1px solid ${areaColor.accent}20`,
            overflow: 'hidden',
          }}>
            {/* Area header */}
            <div style={{
              padding: '14px 20px',
              background: areaColor.bg,
              borderBottom: `1px solid ${areaColor.accent}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '13px',
                fontWeight: 700,
                color: areaColor.accent,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                {AREA_LABELS[area] || area}
              </div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                color: '#6b7280',
              }}>
                {totalTools} tool · {areaCats.length} {areaCats.length === 1 ? 'categoria' : 'categorie'}
              </div>
            </div>

            {/* Categories within this area */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {areaCats.map((catDef, catIdx) => {
                const catTools = grouped[catDef.key] || []

                return (
                  <div key={catDef.key} style={{
                    borderBottom: catIdx < areaCats.length - 1 ? '1px solid #1e2028' : 'none',
                  }}>
                    {/* Category sub-header */}
                    <div style={{
                      padding: '10px 20px',
                      background: '#13151a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderBottom: '1px solid #1a1c22',
                    }}>
                      <span style={{ fontSize: '14px' }}>{catDef.icon}</span>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#e5e7eb',
                      }}>
                        {catDef.label}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        color: '#4b5563',
                        marginLeft: '4px',
                      }}>
                        {catDef.description}
                      </span>
                      <span style={{
                        marginLeft: 'auto',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '11px',
                        color: areaColor.accent,
                        opacity: 0.7,
                      }}>
                        {catTools.length}
                      </span>
                    </div>

                    {/* Tools grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                      gap: '1px',
                      background: '#1a1c22',
                    }}>
                      {catTools.map(tool => {
                        const level = getConfidenceLevel(tool.confidence)
                        const colors = CONFIDENCE_COLORS[level]
                        const evidence = tool.details?.evidence as string | undefined
                        const subCategory = tool.details?.sub_category as string | undefined

                        return (
                          <div key={tool.id} style={{
                            background: '#111318',
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px',
                          }}>
                            {/* Confidence indicator */}
                            <div style={{
                              width: 34,
                              height: 34,
                              borderRadius: '7px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: '10px',
                              fontWeight: 700,
                              background: colors.bg,
                              color: colors.text,
                              border: `1px solid ${colors.border}`,
                              flexShrink: 0,
                            }}>
                              {Math.round(tool.confidence * 100)}
                            </div>

                            {/* Tool info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                gap: '6px',
                                marginBottom: '2px',
                              }}>
                                <span style={{
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: '#ffffff',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {tool.tool_name}
                                </span>
                                {tool.tool_version && (
                                  <span style={{
                                    fontSize: '10px',
                                    color: '#6b7280',
                                    fontFamily: "'JetBrains Mono', monospace",
                                    flexShrink: 0,
                                  }}>
                                    v{tool.tool_version}
                                  </span>
                                )}
                              </div>
                              {subCategory && (
                                <div style={{
                                  fontSize: '10px',
                                  color: areaColor.accent,
                                  opacity: 0.7,
                                  marginBottom: '1px',
                                  fontFamily: "'JetBrains Mono', monospace",
                                }}>
                                  {subCategory}
                                </div>
                              )}
                              {evidence && (
                                <div style={{
                                  fontSize: '11px',
                                  color: '#6b7280',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  lineHeight: '1.3',
                                }}
                                  title={evidence}
                                >
                                  {evidence}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Unknown categories */}
      {unknownCategories.length > 0 && (
        <div style={{
          borderRadius: '14px',
          border: '1px solid #2a2d3520',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px',
            background: '#1a1c2410',
            borderBottom: '1px solid #2a2d3515',
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '13px',
              fontWeight: 700,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              Altre Tecnologie
            </span>
          </div>
          {unknownCategories.map(catKey => {
            const catTools = grouped[catKey] || []
            return catTools.map(tool => {
              const level = getConfidenceLevel(tool.confidence)
              const colors = CONFIDENCE_COLORS[level]
              const evidence = tool.details?.evidence as string | undefined

              return (
                <div key={tool.id} style={{
                  background: '#111318',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  borderBottom: '1px solid #1a1c22',
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: '7px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: "'JetBrains Mono', monospace", fontSize: '10px', fontWeight: 700,
                    background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                    flexShrink: 0,
                  }}>
                    {Math.round(tool.confidence * 100)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff', marginBottom: '2px' }}>
                      {tool.tool_name}
                    </div>
                    {evidence && (
                      <div style={{ fontSize: '11px', color: '#6b7280' }} title={evidence}>{evidence}</div>
                    )}
                  </div>
                </div>
              )
            })
          })}
        </div>
      )}
    </div>
  )
}
