import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'
import type { MemoryProfile } from '@/lib/types/client'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', params.id)
    .single()

  if (!client) redirect('/clients')

  const { data: memory } = await supabase
    .from('client_memory')
    .select('profile')
    .eq('client_id', params.id)
    .maybeSingle()

  const profile: MemoryProfile = (memory?.profile as MemoryProfile) || {}

  return (
    <OnboardingWizard
      clientId={client.id}
      clientName={client.name}
      initialProfile={profile}
    />
  )
}
