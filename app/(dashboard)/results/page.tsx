import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ResultsList, { type AnalysisRow, type ClientInfo } from '@/components/results/ResultsList'

// Server-rendered: the list arrives in the HTML on first paint instead of
// after a client-side fetch + spinner. The filter UI is a client island.
export default async function ResultsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  // Pull every analysis the user can see (RLS does the scoping) in one query;
  // then resolve client names with a single batched `.in()` rather than the
  // legacy N+1 the client component had.
  const { data: analyses } = await supabase
    .from('analyses')
    .select('id, domain, country, language, status, overall_score, created_at, completed_at, competitors, client_id')
    .order('created_at', { ascending: false })

  const rows = (analyses ?? []) as AnalysisRow[]
  const clientIds = Array.from(new Set(rows.filter(r => r.client_id).map(r => r.client_id!)))

  let clients: ClientInfo[] = []
  if (clientIds.length > 0) {
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds)
    clients = ((data ?? []) as ClientInfo[]).sort((a, b) => a.name.localeCompare(b.name))
  }

  return <ResultsList analyses={rows} clients={clients} />
}
