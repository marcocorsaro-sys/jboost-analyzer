export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/v4/analyses/sitemap-urls?domain=<bare-domain>
 *
 * Sitemap URLs for the setup wizard's template-URL autocomplete. Called in
 * the pre-creation phase, so it is keyed on the domain (no analysis id yet)
 * and only requires an authenticated user.
 *
 * Reuses the Schema Radiography discovery (lib/schema/discover): same
 * sitemap fetch, same role classification, same role-balanced sampling —
 * capped at MAX_URLS so a 50k-URL sitemap still answers with a small,
 * template-diverse payload.
 *
 * Failure is never blocking: an unreachable/empty sitemap answers 200 with
 * urls: [] and a warning, and the wizard field simply stays manual. The
 * response is cacheable for 10 minutes (private): N template fields in one
 * wizard session must not mean N sitemap crawls.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchSitemapUrls, sampleByRole } from '@/lib/schema/discover'
import { isBareDomain } from '@/lib/v4/url-autocomplete'

/** Enough to autocomplete against, small enough to ship to the browser. */
const MAX_URLS = 400

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=600' }

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const raw = new URL(request.url).searchParams.get('domain') ?? ''
  // Light normalization for robustness; the client already sends bare domains.
  const domain = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  if (!isBareDomain(domain)) {
    return NextResponse.json(
      { error: `"${raw}" non sembra un dominio valido` },
      { status: 400 },
    )
  }

  const homepage = `https://${domain}`
  try {
    const sitemapUrls = await fetchSitemapUrls(homepage)
    if (sitemapUrls.length === 0) {
      return NextResponse.json(
        { domain, urls: [], warning: 'sitemap non trovata o vuota' },
        { headers: CACHE_HEADERS },
      )
    }
    // Role-balanced sampling (same logic the radiography uses): every page
    // role is represented before any role gets a second slot, so even a
    // product-heavy sitemap still offers FAQ/about/article suggestions.
    const urls = sampleByRole(sitemapUrls, homepage, MAX_URLS)
    return NextResponse.json({ domain, urls }, { headers: CACHE_HEADERS })
  } catch (err) {
    return NextResponse.json(
      {
        domain,
        urls: [],
        warning: `discovery sitemap fallita: ${err instanceof Error ? err.message : String(err)}`,
      },
      { headers: CACHE_HEADERS },
    )
  }
}
