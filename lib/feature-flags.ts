/**
 * Feature flags — V4 shell realignment (UX-UI Bibbia 04, sheet
 * "Navigation & Screens" + Comparazione 07).
 *
 * The Bibbia sidebar has exactly five entries (Home · New audit · Audits ·
 * Clients · Settings). Everything V1 that is NOT in that list (Dashboard
 * metrics, Pre-sales/Prospects, Ask J, Analyzer V1, Results V1, notifications)
 * is PARKED, not deleted (decisione mappa riuso 09): the routes stay deployed
 * and reachable by direct URL, they just disappear from the navigation.
 *
 * Set NEXT_PUBLIC_JBA_LEGACY=1 to bring the parked entries back as a
 * collapsed "Legacy (V1)" section in the shell. Default: hidden.
 *
 * NEXT_PUBLIC_* env vars are inlined at build time, so this works identically
 * in server and client components.
 */
export function showLegacy(): boolean {
  return process.env.NEXT_PUBLIC_JBA_LEGACY === '1'
}
