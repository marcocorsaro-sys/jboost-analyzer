/**
 * V4 driver — Traffic. NOT IMPLEMENTED, and deliberately so.
 *
 * The spec names exactly one source: SimilarWeb (traffic-and-engagement,
 * average visits over 3 months, log10 normalization), with an explicit
 * instruction that a null on any domain blocks the driver and raises an
 * alert rather than being treated as zero traffic.
 *
 * This repository has no SimilarWeb integration and no credentials for one:
 * `grep -ri similarweb lib app supabase` matches only the driver registry.
 * Every other traffic-ish number available here (Semrush organic traffic
 * estimate, Ahrefs traffic) measures something different — organic-only
 * estimates rather than total visits — so substituting one would silently
 * change what the driver means while still producing a confident number.
 *
 * That substitution is exactly the failure mode the V4 rewrite exists to
 * remove, so the driver fails loudly until the source is procured.
 */

import type { DriverWorker } from '@/lib/v4/runner/types'

export const trafficWorker: DriverWorker = async () => ({
  status: 'error',
  error:
    'Traffic non è implementato: la fonte prevista dalla spec (SimilarWeb traffic-and-engagement) ' +
    'non è integrata in questo progetto e non ci sono credenziali. Le fonti alternative presenti ' +
    '(Semrush/Ahrefs) misurano il traffico organico stimato, non le visite totali: userebbero un ' +
    'numero diverso spacciandolo per lo stesso driver. Serve una decisione di prodotto, non un ripiego.',
  rawPayload: { source: 'similarweb:traffic-and-engagement', status: 'source_not_available' },
})
