import { createClient } from '@/lib/supabase/server'
import ConsentForm from './ConsentForm'

export const dynamic = 'force-dynamic'

/**
 * OAuth consent screen for the Claude (MCP) connector. Supabase's OAuth server
 * redirects here with ?authorization_id=…; the middleware has already made
 * sure the visitor is signed in (and sent them through /login?next=… if not).
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }> | { authorization_id?: string }
}) {
  const { authorization_id: authorizationId } = await searchParams
  if (!authorizationId) return <ConsentForm state="invalid" />

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  // supabase-js OAuth-server API (beta): typed loosely on purpose.
  const oauth = (supabase.auth as any).oauth
  if (!oauth?.getAuthorizationDetails) return <ConsentForm state="invalid" />

  const { data, error } = await oauth.getAuthorizationDetails(authorizationId)
  if (error || !data) return <ConsentForm state="invalid" />

  // Already consented earlier: the server answers with the redirect straight away.
  if (data.redirect_url && !data.client) {
    return <ConsentForm state="redirect" redirectUrl={data.redirect_url} />
  }

  return (
    <ConsentForm
      state="ask"
      authorizationId={authorizationId}
      clientName={data.client?.name ?? 'Claude'}
      email={userData.user?.email ?? ''}
    />
  )
}
