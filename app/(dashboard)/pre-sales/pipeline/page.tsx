import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import PipelineSearch from './_search'
import ClientCard from '@/components/clients/ClientCard'
import T from '@/components/ui/T'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { search?: string }
}

type ProspectRow = {
  id: string
  name: string
  domain: string | null
  industry: string | null
  status: 'active' | 'archived'
  lifecycle_stage: 'prospect' | 'active' | 'churned' | 'archived' | null
  updated_at: string | null
}

/**
 * Pre-Sales workspace → Pipeline tab.
 *
 * This page is the Horizon 1 Stage 2 replacement for the old
 * /pre-sales page (which was itself renamed from /prospects). It is
 * a server component that fetches prospect-stage clients, enriches
 * each row with its latest completed-analysis score, and renders
 * them through the existing rich <ClientCard /> used elsewhere in
 * the app so we don't lose score/delta/industry info that the
 * legacy /pre-sales page had.
 *
 * The search input is a client component mounted inside the server
 * page (see ./_search.tsx); it round-trips via the `search` query
 * param so results stay shareable.
 */
export default async function PipelinePage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Pull every client the user can see and filter to prospects in-JS.
  // Access is enforced by RLS via client_members, same as /clients.
  let allClients: ProspectRow[] = []
  const withLifecycle = await supabase
    .from('clients')
    .select('id, name, domain, industry, status, lifecycle_stage, updated_at')
    .order('updated_at', { ascending: false })
  if (!withLifecycle.error) {
    allClients = (withLifecycle.data ?? []) as ProspectRow[]
  } else {
    // Very old rows may predate the lifecycle_stage column. Keep a
    // fallback so the page renders instead of 500'ing.
    const fallback = await supabase
      .from('clients')
      .select('id, name, domain, industry, status, updated_at')
      .order('updated_at', { ascending: false })
    allClients = ((fallback.data ?? []) as Array<Omit<ProspectRow, 'lifecycle_stage'>>).map((c) => ({
      ...c,
      lifecycle_stage: null,
    }))
  }

  const prospects = allClients.filter(
    (c) => (c.lifecycle_stage ?? c.status) === 'prospect'
  )

  const q = (searchParams.search ?? '').trim().toLowerCase()
  const filteredBase = q
    ? prospects.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.domain ?? '').toLowerCase().includes(q) ||
          (c.industry ?? '').toLowerCase().includes(q)
      )
    : prospects

  // Enrich each prospect with its analyses count + latest score so
  // ClientCard can show the same stats it does in /clients.
  const enriched = await Promise.all(
    filteredBase.map(async (c) => {
      const { count } = await supabase
        .from('analyses')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', c.id)
      const { data: latest } = await supabase
        .from('analyses')
        .select('overall_score, completed_at')
        .eq('client_id', c.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return {
        id: c.id,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        status: c.status,
        lifecycle_stage: (c.lifecycle_stage ?? 'prospect') as 'prospect',
        analyses_count: count ?? 0,
        latest_score: (latest as { overall_score: number | null } | null)?.overall_score ?? null,
        latest_analysis_at:
          (latest as { completed_at: string | null } | null)?.completed_at ?? null,
      }
    })
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <PipelineSearch defaultValue={q} />
        <Link
          href="/clients/new"
          className="ml-auto inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 font-mono text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          <T k="clients.new_prospect_button" />
        </Link>
      </div>

      {enriched.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {q ? <T k="clients.empty_search" /> : <T k="clients.empty_prospects" />}
            </CardTitle>
            <CardDescription>
              <T k="clients.prospects_page_subtitle" />
            </CardDescription>
          </CardHeader>
          {!q && (
            <CardContent>
              <Link
                href="/clients/new"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 font-mono text-sm font-bold text-primary-foreground hover:bg-primary/90"
              >
                <T k="clients.create_first_prospect" />
              </Link>
            </CardContent>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {enriched.map((c) => (
            <ClientCard key={c.id} {...c} />
          ))}
        </div>
      )}
    </div>
  )
}
