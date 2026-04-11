import ClientForm from '@/components/clients/ClientForm'

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
        Nuovo Cliente
      </h1>
      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '32px' }}>
        Aggiungi un nuovo cliente al tuo portfolio
      </p>

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
