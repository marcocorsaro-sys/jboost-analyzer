import { BarChart3 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import T from '@/components/ui/T'

export default function BenchmarksPage() {
  return (
    <Card>
      <CardHeader>
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <BarChart3 className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl">
          <T k="pre_sales.benchmarks_tab" />
        </CardTitle>
        <CardDescription>
          <T k="pre_sales.benchmarks_coming_soon" />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          <T k="common.coming_soon" />
        </p>
      </CardContent>
    </Card>
  )
}
