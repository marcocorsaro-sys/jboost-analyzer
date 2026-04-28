/**
 * /pre-sales/snapshot — landing page con form per inserire domain.
 *
 * Submit redirige a /pre-sales/snapshot/[domain] dove avviene
 * l'orchestrazione vera. È intenzionalmente minimale: un input + button.
 * In futuro qui possiamo:
 *   - elenco degli ultimi snapshot già fatti per quel cliente
 *   - selezione del cliente da DB invece del solo dominio raw
 *   - opzioni avanzate (DataForSEO on/off, keyword count, ecc.)
 */

import Link from 'next/link'

export default function SnapshotLandingPage() {
  async function startSnapshot(formData: FormData) {
    'use server'
    const raw = String(formData.get('domain') || '').trim()
    if (!raw) return
    const domain = raw
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .toLowerCase()
    const { redirect } = await import('next/navigation')
    redirect(`/pre-sales/snapshot/${encodeURIComponent(domain)}`)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold leading-tight">
          Pre-Sales <span className="text-lime-400 italic">Snapshot</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          External-only health check: indexability, structured data, real-user
          performance, MarTech stack, AI Overview presence, domain identity.
          ~10–30 seconds per domain. No client onboarding needed.
        </p>
      </div>

      <form action={startSnapshot} className="space-y-3">
        <label className="block text-sm font-medium">Domain to scan</label>
        <input
          name="domain"
          type="text"
          required
          placeholder="example.com"
          className="w-full px-3 py-2 rounded border border-border bg-card text-card-foreground"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded bg-lime-400 text-black font-medium hover:bg-lime-300"
        >
          Build snapshot
        </button>
      </form>

      <div className="mt-10 text-xs text-muted-foreground">
        <p>
          What this analyzes:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>Indexability (robots.txt, sitemap.xml, meta robots, canonical, hreflang)</li>
          <li>Structured Data coverage (Schema.org JSON-LD)</li>
          <li>Real-User Core Web Vitals (Chrome UX Report)</li>
          <li>MarTech stack (Wappalyzer-style fingerprints)</li>
          <li>AI Overview / Featured Snippet presence (DataForSEO, opt-in)</li>
          <li>Domain identity & age (RDAP/WHOIS)</li>
        </ul>
        <p className="mt-3">
          <Link href="/clients" className="underline">Or pick an existing client</Link> to enable the
          DataForSEO live SERP scan with the client&rsquo;s top organic keywords.
        </p>
      </div>
    </div>
  )
}
