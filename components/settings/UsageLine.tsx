'use client'

import { useLocale, formatLocalDate } from '@/lib/i18n'

export default function UsageLine({ calls, people, lastCallAt }: { calls: number; people: number; lastCallAt: string }) {
  const { t, locale } = useLocale()
  const text = t('mcp.usage_line')
    .replace('{calls}', String(calls))
    .replace('{people}', String(people))
    .replace('{date}', formatLocalDate(lastCallAt, locale))
  return <p className="text-sm text-foreground">{text}</p>
}
