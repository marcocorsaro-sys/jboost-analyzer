import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChatInterface from '@/components/chat/ChatInterface'

export default async function ClientChatPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch client name. Access is enforced by RLS / client_members.
  const { data: client } = await supabase
    .from('clients')
    .select('name')
    .eq('id', params.id)
    .single()

  if (!client) redirect('/clients')

  return (
    <ChatInterface
      clientId={params.id}
      clientName={client.name}
      mode="contextual"
    />
  )
}
