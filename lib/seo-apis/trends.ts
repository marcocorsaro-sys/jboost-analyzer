import type { GoogleTrendsResult, ApiResponse } from './types'

function mockResponse<T>(data: T, source: string): ApiResponse<T> {
  return {
    data,
    _meta: { is_mock: true, source, fetched_at: new Date().toISOString() },
  }
}

function realResponse<T>(data: T, source: string): ApiResponse<T> {
  return {
    data,
    _meta: { is_mock: false, source, fetched_at: new Date().toISOString() },
  }
}

/**
 * Fetch Google Trends interest-over-time for a brand keyword.
 * Uses the unofficial google-trends-api approach via SerpApi or similar proxy.
 * Falls back to mock data if not available.
 */
export async function fetchBrandAwareness(
  brand: string,
  _geo: string = 'US'
): Promise<ApiResponse<GoogleTrendsResult>> {
  const source = 'google_trends_brand_awareness'
  try {
    // Google Trends doesn't have an official API.
    // In the original app, the `google-trends-api` npm package was used.
    // For the Edge Function environment (Deno), we use SerpApi or a proxy.
    // If SERPAPI_KEY is available, use SerpApi Google Trends endpoint.
    const serpApiKey = process.env.SERPAPI_KEY
    if (serpApiKey) {
      const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(brand)}&geo=${_geo}&data_type=TIMESERIES&api_key=${serpApiKey}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const timelineData = data.interest_over_time?.timeline_data || []
        const timeline = timelineData.map((t: Record<string, unknown>) => ({
          date: String(t.date || ''),
          value: Number((t.values as Array<{ value: string }>)?.[0]?.value || 0),
        }))
        const values = timeline.map((t: { value: number }) => t.value)
        const latest = values.length > 0 ? values[values.length - 1] : 0
        const average = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0

        return realResponse<GoogleTrendsResult>(
          { latestRank: 0, average, latest, timeline },
          source
        )
      }
    }

    // Fallback: return mock data
    console.warn(`[${source}] No Google Trends API available, returning mock`)
    return mockResponse<GoogleTrendsResult>(
      { latestRank: 0, average: 0, latest: 0, timeline: [] },
      source
    )
  } catch (err) {
    console.error(`[${source}]`, err)
    return mockResponse<GoogleTrendsResult>(
      { latestRank: 0, average: 0, latest: 0, timeline: [] },
      source
    )
  }
}
