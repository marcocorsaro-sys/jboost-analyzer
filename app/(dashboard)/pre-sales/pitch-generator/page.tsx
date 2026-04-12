import { Sparkles, Target, Gauge, Lightbulb } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import T from '@/components/ui/T'

export default function PitchGeneratorPage() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">
            <T k="pre_sales.pitch_generator_hero_title" />
          </CardTitle>
          <CardDescription>
            <T k="pre_sales.pitch_generator_hero_description" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            disabled
            className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md bg-primary/40 px-4 text-sm font-medium text-primary-foreground"
          >
            <T k="pre_sales.pitch_generator_coming_soon" />
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <T k="pre_sales.pitch_generator_features_title" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                <T k="pre_sales.feature_competitor_title" />
              </p>
              <p className="text-sm text-muted-foreground">
                <T k="pre_sales.feature_competitor_desc" />
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Gauge className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                <T k="pre_sales.feature_nine_drivers_title" />
              </p>
              <p className="text-sm text-muted-foreground">
                <T k="pre_sales.feature_nine_drivers_desc" />
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Lightbulb className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                <T k="pre_sales.feature_talking_points_title" />
              </p>
              <p className="text-sm text-muted-foreground">
                <T k="pre_sales.feature_talking_points_desc" />
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
