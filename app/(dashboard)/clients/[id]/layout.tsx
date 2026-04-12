import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ClientTabs from '@/components/clients/ClientTabs'

export default async function ClientDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS enforces access via client_members; do NOT filter by user_id here
  // otherwise editors/viewers shared on the client would be locked out.
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!client) redirect('/clients')

  return (
    <div>
      {/* Breadcrumb + Client header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
          <Link href="/clients" style={{ color: '#6b7280', textDecoration: 'none' }}>
            Clienti
          </Link>
          <span style={{ margin: '0 8px' }}>/</span>
          <span style={{ color: '#a0a0a0' }}>{client.name}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Logo placeholder */}
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '12px',
            background: '#c8e64a15',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: 700,
            color: '#c8e64a',
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
          }}>
            {client.name.charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1 }}>
            <h1 style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '22px',
              fontWeight: 700,
              color: '#ffffff',
            }}>
              {client.name}
            </h1>
            <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
              {client.domain && <span>{client.domain}</span>}
              {client.industry && (
                <>
                  <span>•</span>
                  <span>{client.industry}</span>
                </>
              )}
              {client.status === 'archived' && (
                <>
                  <span>•</span>
                  <span style={{ color: '#f59e0b' }}>Archiviato</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <ClientTabs clientId={params.id} />

      {/* Tab content */}
      {children}
    </div>
  )
}
