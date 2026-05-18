import { FileText, BookOpen, Database } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import T from '@/components/ui/T'

const items = [
  { icon: FileText, titleKey: 'library.report_templates', descKey: 'library.report_templates_desc' },
  { icon: BookOpen, titleKey: 'library.playbooks', descKey: 'library.playbooks_desc' },
  { icon: Database, titleKey: 'library.knowledge_hub', descKey: 'library.knowledge_hub_desc' },
] as const

export default function LibraryPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          <T k="library.title" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <T k="library.subtitle" />
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(({ icon: Icon, titleKey, descKey }) => (
          <Card key={titleKey}>
            <CardHeader>
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">
                <T k={titleKey} />
              </CardTitle>
              <CardDescription>
                <T k={descKey} />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <button
                type="button"
                disabled
                className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md border border-border bg-background px-4 text-xs font-medium text-muted-foreground"
              >
                <T k="common.coming_soon" />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
