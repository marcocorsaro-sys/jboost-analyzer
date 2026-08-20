'use client'

/**
 * /audits — per-row Controller badge (admin only).
 *
 * The Audits page is a server component and must stay one: the Controller
 * sweep (GET /api/v4/controller?scope=all) recomputes every audit's checks
 * and cannot be allowed to block the page render. So the badge is a lazy
 * client island: it fetches AFTER hydration, and all rows share ONE request
 * through a module-level promise — one sweep per page view, not one per row.
 *
 * The server page only renders this component for admins (getProfileRole),
 * and the route re-verifies the role anyway; on any error (403 included)
 * the badge silently renders a dash — the list must never break because
 * the reviewer is unavailable.
 */

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n'
import { B } from '@/lib/brand'

interface SweepEntry {
  analysis_id: string
  domain: string | null
  counts: { error: number; warning: number; info: number }
}

// One sweep shared by every badge on the page. Not persisted across
// navigations: each visit re-checks, same on-demand philosophy as the route.
let sweepPromise: Promise<Map<string, SweepEntry['counts']>> | null = null

function loadSweep(): Promise<Map<string, SweepEntry['counts']>> {
  if (!sweepPromise) {
    sweepPromise = (async () => {
      const res = await fetch('/api/v4/controller?scope=all', { cache: 'no-store' })
      if (!res.ok) throw new Error(`controller sweep failed: ${res.status}`)
      const body = (await res.json()) as SweepEntry[]
      return new Map(body.map((e) => [e.analysis_id, e.counts]))
    })()
    // A failed sweep must not poison later mounts with a rejected promise.
    sweepPromise.catch(() => {
      sweepPromise = null
    })
  }
  return sweepPromise
}

export default function ControllerBadge({ analysisId }: { analysisId: string }) {
  const { t } = useLocale()
  const [counts, setCounts] = useState<SweepEntry['counts'] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let mounted = true
    loadSweep()
      .then((map) => {
        if (mounted) setCounts(map.get(analysisId) ?? { error: 0, warning: 0, info: 0 })
      })
      .catch(() => {
        if (mounted) setFailed(true)
      })
    return () => {
      mounted = false
    }
  }, [analysisId])

  if (failed) return <span className="text-[11px] text-muted-foreground">—</span>
  if (!counts) return <span className="text-[11px] text-muted-foreground">…</span>

  const total = counts.error + counts.warning + counts.info
  const color = counts.error > 0 ? B.error : counts.warning > 0 ? B.warning : B.success
  const label = total === 0 ? t('audits.controller_clean') : String(total)

  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold"
      style={{ background: `${color}18`, color }}
      title={`errors ${counts.error} · warnings ${counts.warning} · info ${counts.info}`}
    >
      {label}
    </span>
  )
}
