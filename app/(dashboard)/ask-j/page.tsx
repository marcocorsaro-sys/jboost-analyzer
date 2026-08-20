import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChatInterface from '@/components/chat/ChatInterface'
import { B } from '@/lib/brand'

export default async function AskJPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch clients for the picker — only lifecycle-active clients.
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, domain')
    .eq('user_id', user.id)
    .eq('lifecycle_stage', 'active')
    .neq('status', 'archived')
    .order('name')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <h2 style={{
          fontFamily: B.fontMono,
          fontSize: '20px',
          fontWeight: 700,
          color: B.ink,
        }}>
          Ask J
        </h2>
        <span style={{
          padding: '2px 8px',
          background: B.primarySoft,
          border: `1px solid ${B.primary}33`,
          borderRadius: '12px',
          fontSize: '10px',
          fontWeight: 600,
          color: B.primary,
          fontFamily: B.fontMono,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Powered by Claude
        </span>
      </div>
      <p style={{ fontSize: '14px', color: B.muted, marginBottom: '16px' }}>
        Il tuo assistente AI per SEO, digital marketing e strategie di crescita. Seleziona un cliente per risposte contestuali.
      </p>

      <ChatInterface mode="assistant" clients={clients || []} />
    </div>
  )
}
