import { redirect } from 'next/navigation'

/**
 * PARCHEGGIATA (direttiva onboarding unico + Comparazione 07): l'analisi V1
 * "digital presence" e' sostituita dal wizard V4. La pagina originale vive in
 * page.parked.tsx per la futura eventuale versione ongoing.
 */
export default function LegacyAnalyzerRedirect() {
  redirect('/analyzer/v4')
}
