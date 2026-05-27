'use client'

import dynamic from 'next/dynamic'

// recharts only powers this trend line — defer it into its own chunk so the
// client overview page doesn't ship it in the initial bundle.
const TrendChart = dynamic(() => import('@/components/charts/TrendChart'), {
  ssr: false,
  loading: () => <div style={{ height: 320 }} aria-hidden />,
})

interface TrendDataPoint {
  date: string
  overall_score: number | null
  [driverName: string]: string | number | null
}

interface ClientOverviewTrendProps {
  data: TrendDataPoint[]
}

const ALL_DRIVERS = [
  'compliance', 'experience', 'discoverability', 'content',
  'accessibility', 'authority', 'aso_visibility', 'ai_relevance', 'awareness',
]

export default function ClientOverviewTrend({ data }: ClientOverviewTrendProps) {
  return (
    <TrendChart
      data={data}
      drivers={ALL_DRIVERS}
      height={320}
      showOverall={true}
    />
  )
}
