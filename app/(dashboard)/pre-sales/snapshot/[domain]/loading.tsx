/**
 * Loading UI per /pre-sales/snapshot/[domain].
 *
 * Mostrato mentre l'orchestratore sta girando (10–40s). Streaming friendly:
 * Next 14 lo serve subito al browser e poi sostituisce con il vero render
 * quando il Server Component risolve.
 */

export default function Loading() {
  return (
    <div className="max-w-5xl space-y-8">
      <div className="rounded-lg border bg-card text-card-foreground p-6 animate-pulse">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-3">
            <div className="h-3 w-24 bg-muted rounded" />
            <div className="h-8 w-64 bg-muted rounded" />
            <div className="h-3 w-40 bg-muted rounded" />
          </div>
          <div className="text-right space-y-2">
            <div className="h-12 w-20 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded ml-auto" />
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Building snapshot — running 6 providers in parallel (indexability,
        structured data, CrUX, AI visibility, MarTech, WHOIS). Typical wait:
        10–40 seconds.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-5 animate-pulse">
            <div className="h-3 w-24 bg-muted rounded mb-4" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-muted rounded" />
              <div className="h-3 w-3/4 bg-muted rounded" />
              <div className="h-3 w-2/3 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
