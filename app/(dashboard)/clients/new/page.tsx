import ClientForm from '@/components/clients/ClientForm'
import T from '@/components/ui/T'

// Note: all new clients are created with lifecycle_stage='prospect' (API default).
// The user-facing "+ New Prospect" CTA now points to /pre-sales/new, but this
// route is kept for backwards compatibility with deep links / bookmarks.
export default function NewClientPage() {
  return (
    <div style={{ maxWidth: '800px' }}>
      <h1 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '24px',
        fontWeight: 700,
        color: '#ffffff',
        marginBottom: '8px',
      }}>
        <T k="clients.new_prospect_title" />
      </h1>
      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
        <T k="clients.new_prospect_subtitle" />
      </p>

      {/* Warning banner: all new clients are created as prospects */}
      <div style={{
        padding: '12px 16px',
        background: '#f59e0b15',
        border: '1px solid #f59e0b40',
        borderRadius: '8px',
        color: '#f59e0b',
        fontSize: '13px',
        marginBottom: '24px',
      }}>
        <T k="clients.new_prospect_notice" />
      </div>

      <div style={{
        background: '#1a1c24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        padding: '24px',
      }}>
        <ClientForm mode="create" />
      </div>
    </div>
  )
}
