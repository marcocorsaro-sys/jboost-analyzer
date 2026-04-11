import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch quick stats
  let analysesCount = 0
  let averageScore: number | null = null
  let isAdmin = false

  if (user) {
    const { count } = await supabase
      .from('analyses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'completed')

    analysesCount = count ?? 0

    const { data: avgData } = await supabase
      .from('analyses')
      .select('overall_score')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .not('overall_score', 'is', null)

    if (avgData && avgData.length > 0) {
      const sum = avgData.reduce((acc, a) => acc + (a.overall_score ?? 0), 0)
      averageScore = sum / avgData.length
    }

    // Check if admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    isAdmin = profile?.role === 'admin'
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        analysesCount={analysesCount}
        averageScore={averageScore}
        isAdmin={isAdmin}
      />
      <div className="flex-1 ml-64 flex flex-col">
        <TopBar userEmail={user?.email} />
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
