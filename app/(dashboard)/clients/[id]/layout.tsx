import { getUser, getClientById } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ClientTabs from '@/components/clients/ClientTabs'
import { B } from '@/lib/brand'

export default async function ClientDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  // RLS enforces access via client_members; do NOT filter by user_id here
  // otherwise editors/viewers shared on the client would be locked out.
  const [user, client] = await Promise.all([getUser(), getClientById(params.id)])
  if (!user) redirect('/login')
  if (!client) redirect('/clients')

  return (
    <div>
      {/* Breadcrumb + Client header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', color: B.muted, marginBottom: '8px' }}>
          <Link href="/clients" style={{ color: B.muted, textDecoration: 'none' }}>
            Clienti
          </Link>
          <span style={{ margin: '0 8px' }}>/</span>
          <span style={{ color: B.muted }}>{client.name}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Logo placeholder */}
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '12px',
            background: B.primarySoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: 700,
            color: B.primary,
            fontFamily: B.fontMono,
            flexShrink: 0,
          }}>
            {client.name.charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1 }}>
            <h1 style={{
              fontFamily: B.fontMono,
              fontSize: '22px',
              fontWeight: 700,
              color: B.ink,
            }}>
              {client.name}
            </h1>
            <div style={{ display: 'flex', gap: '12px', fontSize: '13px', color: B.muted, marginTop: '2px' }}>
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
                  <span style={{ color: B.warning }}>Archiviato</span>
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
