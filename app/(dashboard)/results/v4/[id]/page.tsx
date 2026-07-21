import RunProgress from '@/components/v4/RunProgress'

export const dynamic = 'force-dynamic'

export default async function V4RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '24px',
          fontWeight: 700,
          color: '#ffffff',
          marginBottom: '8px',
        }}
      >
        Analisi V4
      </h1>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '24px', fontFamily: "'JetBrains Mono', monospace" }}>
        {id}
      </p>

      <RunProgress analysisId={id} />
    </div>
  )
}
