import { createClient, getClientById } from '@/lib/supabase/server'
import ClientAnalysesList from '@/components/clients/ClientAnalysesList'

// Server-rendered: list + client (request-cached from the parent layout)
// arrive in the HTML without a client-side fetch + spinner.
export default async function ClientAnalysesPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const [client, { data: analyses }] = await Promise.all([
    getClientById(params.id),
    supabase
      .from('analyses')
      .select('id, domain, country, language, status, overall_score, created_at, completed_at, competitors, target_topic')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  return (
    <ClientAnalysesList
      analyses={(analyses ?? []) as React.ComponentProps<typeof ClientAnalysesList>['analyses']}
      clientId={params.id}
      clientDomain={client?.domain ?? null}
    />
  )
}
