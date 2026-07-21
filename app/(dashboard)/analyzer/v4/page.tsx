import SetupWizard from '@/components/v4/SetupWizard'

export const dynamic = 'force-dynamic'

/**
 * V4 setup — the entry point of the Driver Intelligence Platform pipeline.
 *
 * Coexists with the V1 /analyzer page: nothing here touches the 9-driver
 * flow, and an analysis created from this wizard is executed by the V4 runner
 * (per-driver jobs) rather than the V1 phase sequence.
 */
export default async function V4SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client } = await searchParams

  return (
    <div style={{ maxWidth: '900px' }}>
      <h1
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '24px',
          fontWeight: 700,
          color: '#ffffff',
          marginBottom: '8px',
        }}
      >
        Nuova analisi V4
      </h1>
      <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '20px' }}>
        Cliente + fino a 4 competitor, 10 driver, un job per driver. Ogni punteggio è un indice
        relativo al set: il leader vale 100.
      </p>

      <div
        style={{
          padding: '12px 16px',
          background: '#f59e0b15',
          border: '1px solid #f59e0b40',
          borderRadius: '8px',
          color: '#f59e0b',
          fontSize: '13px',
          marginBottom: '24px',
          lineHeight: 1.6,
        }}
      >
        <strong>Stato della pipeline V4.</strong> Sono implementati 4 driver su 10 — Authority,
        Speed, Accessibility e Compliance. Gli altri sei sono selezionabili ma falliranno con un
        errore esplicito («no V4 worker yet»): è voluto, un driver che non sa misurare non deve
        produrre un numero. Compliance richiede un progetto Site Audit configurato su SEMrush per
        ogni dominio, cosa che i competitor tipicamente non hanno.
      </div>

      <SetupWizard clientId={client ?? null} />
    </div>
  )
}
