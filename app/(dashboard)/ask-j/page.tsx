import { redirect } from 'next/navigation'

/**
 * Route PARKED per Bibbia V4 (Comparazione 07: Ask J "da valutare per V4
 * ongoing, non prioritaria per one-off"). L'implementazione V1 resta nel
 * repo (page.parked.tsx e components/chat) per la futura versione ongoing.
 */
export default function ParkedAskJRoute() {
  redirect('/home')
}
