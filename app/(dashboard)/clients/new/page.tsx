import NewProspectIntake from '@/components/clients/NewProspectIntake'
import T from '@/components/ui/T'
import { B } from '@/lib/brand'

// Route kept for backwards compatibility with deep links/bookmarks.
// Identical UX to /pre-sales/new — URL-first intake powered by Firecrawl
// + Sonnet to auto-fill name, country, language, industry and 4
// competitor suggestions. All new clients still start as prospect
// (the API enforces lifecycle_stage='prospect' on POST /api/clients).
export default function NewClientPage() {
  return (
    <div style={{ maxWidth: '800px' }}>
      <h1 style={{
        fontFamily: B.fontMono,
        fontSize: '24px',
        fontWeight: 700,
        color: B.ink,
        marginBottom: '8px',
      }}>
        <T k="clients.new_prospect_title" />
      </h1>
      <p style={{ fontSize: '14px', color: B.muted, marginBottom: '16px' }}>
        Incolla la URL del cliente. Estraiamo automaticamente nome, settore, paese, lingua e 4 competitor.
      </p>

      {/* Warning banner: all new clients are created as prospects */}
      <div style={{
        padding: '12px 16px',
        background: `${B.warning}15`,
        border: `1px solid ${B.warning}40`,
        borderRadius: '8px',
        color: B.warning,
        fontSize: '13px',
        marginBottom: '24px',
      }}>
        <T k="clients.new_prospect_notice" />
      </div>

      <div style={{
        background: B.surface,
        borderRadius: '12px',
        border: `1px solid ${B.border}`,
        padding: '24px',
      }}>
        <NewProspectIntake />
      </div>
    </div>
  )
}
