/**
 * Clamp a score to 0-100 range, round to integer.
 * Returns null if value is not a valid number.
 */
export function clampScore(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined) return fallback
  const num = typeof value === 'number' ? value : parseFloat(String(value))
  if (isNaN(num)) return fallback
  return Math.round(Math.max(0, Math.min(100, num)))
}

/**
 * Normalize a SEMrush CSV row into a structured object.
 * SEMrush returns data as semicolon-delimited CSV.
 */
export interface SemrushNorm {
  rank: number
  organicKeywords: number
  organicTraffic: number
  organicCost: number
  adwordsKeywords: number
  adwordsTraffic: number
  adwordsCost: number
}

export function normalizeSemrushRow(data: Record<string, unknown> | null): SemrushNorm | null {
  if (!data) return null

  return {
    rank: Number(data.Rk || data.rank || 0),
    organicKeywords: Number(data.Or || data.organicKeywords || 0),
    organicTraffic: Number(data.Ot || data.organicTraffic || 0),
    organicCost: Number(data.Oc || data.organicCost || 0),
    adwordsKeywords: Number(data.Ad || data.adwordsKeywords || 0),
    adwordsTraffic: Number(data.At || data.adwordsTraffic || 0),
    adwordsCost: Number(data.Ac || data.adwordsCost || 0),
  }
}

export interface DriverResult {
  score: number | null
  status: 'ok' | 'no_results' | 'failed'
  details?: Record<string, unknown>
}
