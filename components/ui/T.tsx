'use client'

import { useLocale } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

/**
 * Inline translation component for use in server-rendered pages.
 * Wraps a single translation key in a client component boundary.
 *
 * Usage: <T k="dashboard.activeClients" />
 */
export default function T({ k }: { k: TranslationKey }) {
  const { t } = useLocale()
  return <>{t(k)}</>
}
