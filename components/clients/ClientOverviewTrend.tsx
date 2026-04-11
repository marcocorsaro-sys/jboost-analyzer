'use client'

import TrendChart from '@/components/charts/TrendChart'

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
