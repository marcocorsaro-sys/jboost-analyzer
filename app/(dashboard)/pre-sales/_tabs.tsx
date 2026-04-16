'use client'

import { ContextualTabs } from '@/components/layout/contextual-tabs'
import { useLocale } from '@/lib/i18n'

export default function PreSalesTabs() {
  const { t } = useLocale()
  return (
    <ContextualTabs
      tabs={[
        { label: t('pre_sales.pipeline_tab'), href: '/pre-sales/pipeline' },
        { label: t('pre_sales.pitch_generator_tab'), href: '/pre-sales/pitch-generator' },
        { label: t('pre_sales.benchmarks_tab'), href: '/pre-sales/benchmarks' },
      ]}
    />
  )
}
