/**
 * /pre-sales/snapshot/[domain] — Server Component che orchestra
 * `buildDomainSnapshot` e renderizza il `SnapshotReport`.
 *
 * Auth: l'utente deve essere loggato (gli altri /pre-sales/* lo richiedono
 * via middleware o lib/supabase/server). Qui usiamo il service-role
 * supabase client perché i provider scrivono su `integration_call_log` e
 * `api_data` che richiedono service-role.
 *
 * NB: nessun caching applicato a livello pagina. Ogni reload triggera un
 * nuovo snapshot. Il caching cross-call è fatto a livello provider via
 * `integration_cache` (Phase 7B-D2 — non ancora cablato; sarà Phase 7E).
 *
 * Performance: rendering bloccato sull'orchestrator (10–40s). Vercel Pro
 * `maxDuration` per pagine SSR è 60s → setto explicit `maxDuration = 90`
 * con margine. Il loading state è gestito da `loading.tsx` di Next.
 */

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { createClient as createUserClient } from '@/lib/supabase/server'
import { buildDomainSnapshot } from '@/lib/integrations/use-cases/pre-sales/domain-snapshot'
import { SnapshotReport } from '@/components/pre-sales/SnapshotReport'

export const dynamic = 'force-dynamic'
export const maxDuration = 90 // Vercel Pro: l'orchestrator può girare fino a ~60s

export default async function Page({ params }: { params: { domain: string } }) {
  // 1. Auth gate — gli altri /pre-sales/* sono dietro auth middleware
  const supabaseUser = await createUserClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) redirect('/login')

  const domainParam = decodeURIComponent(params.domain).trim().toLowerCase()
  if (!domainParam || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domainParam)) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold">Invalid domain</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The URL parameter &quot;{domainParam}&quot; does not look like a domain.
        </p>
      </div>
    )
  }

  // 2. Service-role client per orchestrator (provider scrivono call log)
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold">Server misconfigured</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Missing Supabase env vars on the server.
        </p>
      </div>
    )
  }
  const supabaseService = createServiceClient(SUPABASE_URL, SERVICE_KEY)

  // 3. Run orchestrator. DataForSEO viene skippato (no keyword passate).
  // Versione futura prenderà le top organic da SEMrush quando il dominio
  // appartiene a un client già in DB.
  const snapshot = await buildDomainSnapshot({
    supabase: supabaseService,
    domain: domainParam,
    country: 'Italy',
    language: 'it',
    userId: user.id,
    deadlineMs: 60_000,
  })

  return (
    <div className="max-w-5xl">
      <SnapshotReport snapshot={snapshot} />
    </div>
  )
}
