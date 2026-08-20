'use client'

import { MARTECH_CATEGORIES, CATEGORY_MAP, AREA_LABELS, type MartechCategoryDef } from '@/lib/martech/categories'
import { B } from '@/lib/brand'

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
  high: { bg: `${B.success}10`, text: B.success, border: `${B.success}30` },
  medium: { bg: `${B.warning}10`, text: B.warning, border: `${B.warning}30` },
  low: { bg: `${B.error}10`, text: B.error, border: `${B.error}30` },
}

// Area accents: navy declinations + AA-safe semantic hues on white.
const AREA_COLORS: Record<string, { accent: string; bg: string }> = {
  platform: { accent: B.chartCompetitors[0], bg: `${B.chartCompetitors[0]}10` },
  data: { accent: B.info, bg: `${B.info}10` },
  acquisition: { accent: B.primary, bg: B.primarySoft },
  experience: { accent: B.warning, bg: `${B.warning}10` },
  infrastructure: { accent: B.primaryHover, bg: `${B.primaryHover}10` },
  governance: { accent: B.teal, bg: `${B.teal}10` },
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
                fontFamily: B.fontMono,
              }}>
                {toolCount}
              </div>
              <div style={{
                fontSize: '10px',
                color: B.muted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontFamily: B.fontMono,
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
                fontFamily: B.fontMono,
                fontSize: '13px',
                fontWeight: 700,
                color: areaColor.accent,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                {AREA_LABELS[area] || area}
              </div>
              <div style={{
                fontFamily: B.fontMono,
                fontSize: '11px',
                color: B.muted,
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
                    borderBottom: catIdx < areaCats.length - 1 ? `1px solid ${B.surface2}` : 'none',
                  }}>
                    {/* Category sub-header */}
                    <div style={{
                      padding: '10px 20px',
                      background: B.surface2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderBottom: `1px solid ${B.surface2}`,
                    }}>
                      <span style={{ fontSize: '14px' }}>{catDef.icon}</span>
                      <span style={{
                        fontFamily: B.fontMono,
                        fontSize: '12px',
                        fontWeight: 600,
                        color: B.ink,
                      }}>
                        {catDef.label}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        color: B.muted,
                        marginLeft: '4px',
                      }}>
                        {catDef.description}
                      </span>
                      <span style={{
                        marginLeft: 'auto',
                        fontFamily: B.fontMono,
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
                      background: B.surface2,
                    }}>
                      {catTools.map(tool => {
                        const level = getConfidenceLevel(tool.confidence)
                        const colors = CONFIDENCE_COLORS[level]
                        const evidence = tool.details?.evidence as string | undefined
                        const subCategory = tool.details?.sub_category as string | undefined

                        return (
                          <div key={tool.id} style={{
                            background: B.bg,
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
                              fontFamily: B.fontMono,
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
                                  color: B.ink,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>
                                  {tool.tool_name}
                                </span>
                                {tool.tool_version && (
                                  <span style={{
                                    fontSize: '10px',
                                    color: B.muted,
                                    fontFamily: B.fontMono,
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
                                  fontFamily: B.fontMono,
                                }}>
                                  {subCategory}
                                </div>
                              )}
                              {evidence && (
                                <div style={{
                                  fontSize: '11px',
                                  color: B.muted,
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
          border: `1px solid ${B.border}20`,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 20px',
            background: `${B.surface}10`,
            borderBottom: `1px solid ${B.border}15`,
          }}>
            <span style={{
              fontFamily: B.fontMono,
              fontSize: '13px',
              fontWeight: 700,
              color: B.muted,
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
                  background: B.bg,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  borderBottom: `1px solid ${B.surface2}`,
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: '7px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: B.fontMono, fontSize: '10px', fontWeight: 700,
                    background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                    flexShrink: 0,
                  }}>
                    {Math.round(tool.confidence * 100)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: B.ink, marginBottom: '2px' }}>
                      {tool.tool_name}
                    </div>
                    {evidence && (
                      <div style={{ fontSize: '11px', color: B.muted }} title={evidence}>{evidence}</div>
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
