import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import PipelineSearch from './_search'
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
  status: string | null
  lifecycle_stage: string | null
  updated_at: string | null
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let allClients: ProspectRow[] = []
  const withLifecycle = await supabase
    .from('clients')
    .select('id, name, domain, industry, status, lifecycle_stage, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
  if (!withLifecycle.error) {
    allClients = (withLifecycle.data ?? []) as ProspectRow[]
  } else {
    const fallback = await supabase
      .from('clients')
      .select('id, name, domain, industry, status, updated_at')
      .eq('user_id', user.id)
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
  const filtered = q
    ? prospects.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.domain ?? '').toLowerCase().includes(q) ||
          (c.industry ?? '').toLowerCase().includes(q)
      )
    : prospects

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <PipelineSearch defaultValue={q} />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <T k="pre_sales.empty_title" />
            </CardTitle>
            <CardDescription>
              <T k="pre_sales.empty_description" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/clients/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <T k="pre_sales.new_prospect" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate font-mono text-base">{c.name}</CardTitle>
                    {c.domain && (
                      <CardDescription className="truncate">{c.domain}</CardDescription>
                    )}
                  </div>
                  <Badge variant="outline">prospect</Badge>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
                  {c.industry && <span className="truncate">{c.industry}</span>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
