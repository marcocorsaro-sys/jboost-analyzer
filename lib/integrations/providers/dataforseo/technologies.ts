/**
 * DataForSEO Domain Technologies provider.
 *
 * Used by the MarTech detector as a fallback path when the HTML-side
 * fetcher gets a bot challenge (typically Cloudflare). DataForSEO maintains
 * its own index of tech-stack signals keyed on the domain — bypassing the
 * need to execute JS or evade CF.
 *
 * Endpoint: POST https://api.dataforseo.com/v3/domain_analytics/technologies/domain_technologies/live
 * Pricing : ~$0.0015 per lookup (verified via cost field on response).
 * Auth    : DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (env), Basic auth.
 *
 * The DataForSEO response groups technologies by group_name (e.g.
 * "Analytics and Tracking", "Marketing", "CDN"). We translate those to
 * JBoost's MARTECH_CATEGORIES taxonomy via DFSEO_GROUP_TO_CATEGORY below.
 * Anything we can't map lands in 'other' so it's still visible in the UI.
 */
import { readDataForSEOCredentialsFromEnv } from './client'

const ENDPOINT = 'https://api.dataforseo.com/v3/domain_analytics/technologies/domain_technologies/live'
const REQUEST_TIMEOUT_MS = 25_000

export interface DataForSEOTech {
  /** Mapped JBoost category key (cms, analytics, ...). */
  category: string
  tool_name: string
  /** DataForSEO group name verbatim — preserved for debugging. */
  dfseo_group: string
  /** DataForSEO sub-category — preserved for debugging. */
  dfseo_subgroup?: string
}

export interface DataForSEOTechResult {
  /** Mapped tools ready to merge into DetectedTool[]. */
  tools: DataForSEOTech[]
  /** Cost reported by DataForSEO (USD). */
  cost_usd: number
  /** Wall-clock latency. */
  elapsed_ms: number
  /** Raw counts for diagnostics. */
  raw_count: number
}

/**
 * DataForSEO's group_name → our category key.
 *
 * DataForSEO's own taxonomy isn't published as a stable list, so this is
 * pragmatic: I map the most common groups we've seen on Italian commercial
 * sites. Anything else falls through to 'other'. The match is case-sensitive
 * on lowercased input, exact match preferred.
 */
const DFSEO_GROUP_TO_CATEGORY: Record<string, string> = {
  // Analytics & data
  'analytics and tracking': 'analytics',
  'web analytics': 'analytics',
  'tag managers': 'tag_manager',
  'tag management': 'tag_manager',
  'audience measurement': 'analytics',
  'heatmaps and session recording': 'session_recording',
  'a/b testing': 'ab_testing',
  // Marketing
  'marketing automation': 'marketing_automation',
  'marketing': 'marketing_automation',
  'email marketing': 'email_platform',
  'email': 'email_platform',
  'crm': 'crm',
  'customer relationship management': 'crm',
  // Advertising
  'advertising': 'ad_platforms',
  'advertising networks': 'ad_platforms',
  'retargeting / remarketing': 'ad_platforms',
  'affiliate programs': 'affiliate',
  // SEO / content
  'seo': 'seo',
  'structured data': 'seo',
  // Experience
  'personalization': 'personalization',
  'recommendation engines': 'personalization',
  'live chat': 'chat_support',
  'chat': 'chat_support',
  'support': 'chat_support',
  'cookie compliance': 'consent_management',
  'consent management': 'consent_management',
  'accessibility': 'accessibility',
  'fonts': 'fonts_media',
  'media': 'fonts_media',
  'widgets': 'ux_widgets',
  // Platform
  'cms': 'cms',
  'content management': 'cms',
  'dxp': 'cms',
  'ecommerce': 'ecommerce',
  'e-commerce': 'ecommerce',
  'shopping cart': 'ecommerce',
  'javascript frameworks': 'frontend_framework',
  'javascript libraries': 'frontend_framework',
  'web frameworks': 'frontend_framework',
  'hosting': 'hosting',
  'paas': 'hosting',
  // Infrastructure
  'cdn': 'cdn',
  'content delivery network': 'cdn',
  'performance': 'performance',
  'security': 'security',
  'web server security': 'security',
  'dns': 'dns',
  'ssl certificates': 'dns',
  'image cdn': 'image_optimization',
  'image optimization': 'image_optimization',
  // Governance
  'error tracking': 'error_monitoring',
  'monitoring': 'error_monitoring',
  'payment processors': 'payment',
  'payment': 'payment',
  // Social
  'social': 'social',
  'social sharing': 'social',
}

function mapGroupToCategory(group: string): string {
  return DFSEO_GROUP_TO_CATEGORY[group.toLowerCase()] || 'other'
}

/**
 * Calls DataForSEO Domain Technologies. Returns an empty result on any
 * non-fatal error (credentials missing, network timeout, unexpected shape)
 * so the caller can gracefully degrade. Fatal errors (programmer bugs) do
 * throw.
 */
export async function fetchDomainTechnologies(domain: string): Promise<DataForSEOTechResult | null> {
  const creds = readDataForSEOCredentialsFromEnv()
  if (!creds) {
    console.warn('[dataforseo-tech] DATAFORSEO_LOGIN/PASSWORD not set, skipping')
    return null
  }

  const startedAt = Date.now()
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
  const token = Buffer.from(`${creds.login}:${creds.password}`).toString('base64')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ target: cleanDomain }]),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[dataforseo-tech] HTTP ${res.status} for ${cleanDomain}: ${body.slice(0, 200)}`)
      return null
    }

    const data = await res.json() as {
      cost?: number
      status_code?: number
      status_message?: string
      tasks?: Array<{
        status_code?: number
        status_message?: string
        result?: Array<{
          domain?: string
          technologies?: unknown
        }> | null
      }>
    }

    if (typeof data.status_code === 'number' && data.status_code >= 40000) {
      console.warn(`[dataforseo-tech] DFSEO error ${data.status_code}: ${data.status_message}`)
      return null
    }

    const task = data.tasks?.[0]
    if (!task || (typeof task.status_code === 'number' && task.status_code >= 40000)) {
      console.warn(`[dataforseo-tech] task error ${task?.status_code}: ${task?.status_message}`)
      return null
    }

    const result = task.result?.[0]
    const technologies = result?.technologies

    const tools: DataForSEOTech[] = []
    // DataForSEO's `technologies` field is documented as an object keyed by
    // group name, each value an object keyed by sub-group, each value an
    // array of tool names. Be defensive — the shape has changed in the
    // past. Walk it as Record<string, Record<string, string[]>> first,
    // then fall back to other plausible shapes.
    if (technologies && typeof technologies === 'object' && !Array.isArray(technologies)) {
      for (const [groupName, sub] of Object.entries(technologies as Record<string, unknown>)) {
        if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
          for (const [subgroup, names] of Object.entries(sub as Record<string, unknown>)) {
            if (Array.isArray(names)) {
              for (const name of names) {
                if (typeof name === 'string' && name.trim()) {
                  tools.push({
                    category: mapGroupToCategory(groupName),
                    tool_name: name.trim(),
                    dfseo_group: groupName,
                    dfseo_subgroup: subgroup,
                  })
                }
              }
            }
          }
        } else if (Array.isArray(sub)) {
          // Flat shape: { groupName: [tool, tool, ...] }
          for (const name of sub) {
            if (typeof name === 'string' && name.trim()) {
              tools.push({
                category: mapGroupToCategory(groupName),
                tool_name: name.trim(),
                dfseo_group: groupName,
              })
            }
          }
        }
      }
    }

    const out: DataForSEOTechResult = {
      tools,
      cost_usd: typeof data.cost === 'number' ? data.cost : 0,
      elapsed_ms: Date.now() - startedAt,
      raw_count: tools.length,
    }
    console.log(`[dataforseo-tech] ${cleanDomain}: ${tools.length} tools, $${out.cost_usd}, ${out.elapsed_ms}ms`)
    return out
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[dataforseo-tech] failed for ${cleanDomain}:`, message)
    return null
  } finally {
    clearTimeout(timer)
  }
}
