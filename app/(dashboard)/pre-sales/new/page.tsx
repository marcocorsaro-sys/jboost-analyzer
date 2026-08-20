import NewProspectIntake from '@/components/clients/NewProspectIntake'
import T from '@/components/ui/T'
import { B } from '@/lib/brand'

export default function NewProspectPage() {
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
        Incolla la URL del dominio. Estraiamo automaticamente nome, settore, paese, lingua e 4 competitor.
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
