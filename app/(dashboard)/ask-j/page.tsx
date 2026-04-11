import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ChatInterface from '@/components/chat/ChatInterface'

export default async function AskJPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch clients for the picker
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, domain')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('name')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <h2 style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '20px',
          fontWeight: 700,
          color: '#ffffff',
        }}>
          Ask J
        </h2>
        <span style={{
          padding: '2px 8px',
          background: 'rgba(200, 230, 74, 0.1)',
          border: '1px solid rgba(200, 230, 74, 0.2)',
          borderRadius: '12px',
          fontSize: '10px',
          fontWeight: 600,
          color: '#c8e64a',
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Powered by Claude
        </span>
      </div>
      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
        Il tuo assistente AI per SEO, digital marketing e strategie di crescita. Seleziona un cliente per risposte contestuali.
      </p>

      <ChatInterface mode="assistant" clients={clients || []} />
    </div>
  )
}
