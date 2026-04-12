import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import { LocaleProvider } from '@/lib/i18n'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let prospectsCount = 0
  let activeClientsCount = 0
  let isAdmin = false

  if (user) {
    // Count prospects
    const { count: pc } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('lifecycle_stage', 'prospect')
    prospectsCount = pc ?? 0

    // Count active (lifecycle_stage='active' AND status='active')
    const { count: ac } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('lifecycle_stage', 'active')
      .eq('status', 'active')
    activeClientsCount = ac ?? 0

    // Check if admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    isAdmin = profile?.role === 'admin'
  }

  return (
    <LocaleProvider>
      <div className="flex min-h-screen">
        <Sidebar
          prospectsCount={prospectsCount}
          activeClientsCount={activeClientsCount}
          isAdmin={isAdmin}
        />
        <div className="flex-1 ml-64 flex flex-col">
          <TopBar userEmail={user?.email} />
          <main className="flex-1 p-8">
            {children}
          </main>
        </div>
      </div>
    </LocaleProvider>
  )
}
