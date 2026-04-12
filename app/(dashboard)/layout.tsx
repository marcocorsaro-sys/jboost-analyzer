import { createClient } from '@/lib/supabase/server'
import { LocaleProvider } from '@/lib/i18n'
import { Shell } from '@/components/layout/shell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isAdmin = false

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    isAdmin = profile?.role === 'admin'
  }

  return (
    <LocaleProvider>
      <Shell userEmail={user?.email} isAdmin={isAdmin}>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </Shell>
    </LocaleProvider>
  )
}
