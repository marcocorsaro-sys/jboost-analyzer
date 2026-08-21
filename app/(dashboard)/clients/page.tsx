import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientsListWrapper, { type ClientData } from '@/components/clients/ClientsListWrapper'

// Server-rendered: previously this page fired three `/api/clients?stage=...`
// requests in parallel (active + churned + archived) and then waited for them
// all before showing anything. Now we do the same work as ONE DB query plus
// one batched enrichment, server-side, so the list arrives in the first HTML
// response instead of after a client-side spinner.
export default async function ClientsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  // RLS filters via client_members; we exclude prospects (they live on /pre-sales).
  const { data: rawClients } = await supabase
    .from('clients')
    .select('id, name, domain, industry, status, lifecycle_stage, updated_at')
    .in('lifecycle_stage', ['active', 'churned', 'archived'])
    .order('updated_at', { ascending: false })

  const clientList = rawClients ?? []
  const clientIds = clientList.map(c => c.id)

  const statsByClient = new Map<
    string,
    {
      count: number
      latest_score: number | null
      previous_score: number | null
      latest_analysis_at: string | null
    }
  >()
  if (clientIds.length > 0) {
    const { data: analyses } = await supabase
      .from('analyses')
      .select('client_id, overall_score, completed_at')
      .in('client_id', clientIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
    for (const a of analyses ?? []) {
      const cur = statsByClient.get(a.client_id)
      if (!cur) {
        statsByClient.set(a.client_id, {
          count: 1,
          latest_score: a.overall_score ?? null,
          previous_score: null,
          latest_analysis_at: a.completed_at ?? null,
        })
      } else {
        // Second most-recent run: kept for the "vs previous" delta the
        // Bibbia asks for on the Clients list.
        if (cur.count === 1) cur.previous_score = a.overall_score ?? null
        cur.count += 1
      }
    }
  }

  const enriched: ClientData[] = clientList.map(c => {
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
      previous_score: stats?.previous_score ?? null,
      latest_analysis_at: stats?.latest_analysis_at ?? null,
    }
  })

  return <ClientsListWrapper initialClients={enriched} />
}
