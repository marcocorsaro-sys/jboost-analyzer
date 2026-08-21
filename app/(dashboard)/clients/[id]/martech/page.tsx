import { redirect } from 'next/navigation'

/**
 * Route PARKED per Bibbia V4 (Comparazione 07): non prevista nel pannello
 * cliente one-off. L'implementazione V1 resta nel repo (page.parked.tsx e
 * componenti sottostanti) per la futura versione ongoing.
 */
export default function ParkedClientRoute({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/clients/${params.id}`)
}
