import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProspectsListWrapper from '@/components/clients/ProspectsListWrapper'
import type { ClientData } from '@/components/clients/ClientsListWrapper'

// Server-rendered: prospects + their analysis stats arrive in the first HTML
// response. Replaces a /api/clients?stage=prospect fetch + spinner with one
// DB query plus a single batched analyses lookup.
export default async function ProspectsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: rawProspects } = await supabase
    .from('clients')
    .select('id, name, domain, industry, status, lifecycle_stage, updated_at')
    .eq('lifecycle_stage', 'prospect')
    .order('updated_at', { ascending: false })

  const prospectList = rawProspects ?? []
  const prospectIds = prospectList.map(c => c.id)

  const statsByClient = new Map<
    string,
    { count: number; latest_score: number | null; latest_analysis_at: string | null }
  >()
  if (prospectIds.length > 0) {
    const { data: analyses } = await supabase
      .from('analyses')
      .select('client_id, overall_score, completed_at')
      .in('client_id', prospectIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
    for (const a of analyses ?? []) {
      const cur = statsByClient.get(a.client_id)
      if (!cur) {
        statsByClient.set(a.client_id, {
          count: 1,
          latest_score: a.overall_score ?? null,
          latest_analysis_at: a.completed_at ?? null,
        })
      } else {
        cur.count += 1
      }
    }
  }

  const enriched: ClientData[] = prospectList.map(c => {
    const stats = statsByClient.get(c.id)
    return {
      id: c.id,
      name: c.name,
      domain: c.domain ?? null,
      industry: c.industry ?? null,
      status: (c.status as 'active' | 'archived') ?? 'active',
      lifecycle_stage: c.lifecycle_stage,
      analyses_count: stats?.count ?? 0,
      latest_score: stats?.latest_score ?? null,
      latest_analysis_at: stats?.latest_analysis_at ?? null,
    }
  })

  return <ProspectsListWrapper initialProspects={enriched} />
}
