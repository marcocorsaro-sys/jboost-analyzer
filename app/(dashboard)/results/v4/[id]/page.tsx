import ResultsView from '@/components/v4/ResultsView'
import BackLink from '@/components/layout/back-link'
import T from '@/components/ui/T'

export const dynamic = 'force-dynamic'

/**
 * V4 Audit Results (UX-UI Bibbia sheets 3/6).
 *
 * Server component shell + one client island (ResultsView): the island polls
 * /api/v4/analyses/[id]/{status,insights,publish} and renders the horizontal
 * tabs (Overview · driver tabs in Business-first order · Executive Summary),
 * the Absolute/Relative toggle and the Save & Publish batch re-run.
 */
export default async function V4ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Back-affordance: a results page is a detail of the Audits list. */}
      <BackLink href="/audits">
        <T k="nav.audits" />
      </BackLink>
      <ResultsView analysisId={id} />
    </div>
  )
}
