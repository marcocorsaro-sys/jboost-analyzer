import Link from 'next/link'
import { Plus } from 'lucide-react'
import PreSalesTabs from './_tabs'
import T from '@/components/ui/T'

export default function PreSalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            <T k="pre_sales.title" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <T k="pre_sales.subtitle" />
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          <T k="pre_sales.new_prospect" />
        </Link>
      </header>

      <PreSalesTabs />

      <div>{children}</div>
    </div>
  )
}
