'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useLocale } from '@/lib/i18n'

export default function PipelineSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)
  const [, startTransition] = useTransition()
  const { t } = useLocale()

  const commit = (next: string) => {
    const url = next ? `/pre-sales/pipeline?search=${encodeURIComponent(next)}` : '/pre-sales/pipeline'
    startTransition(() => router.replace(url))
  }

  return (
    <div className="relative flex-1 max-w-lg">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder={t('pre_sales.search_placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(value)
        }}
        onBlur={() => commit(value)}
        className="pl-9"
      />
    </div>
  )
}
