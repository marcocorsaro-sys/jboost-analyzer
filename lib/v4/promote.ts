/**
 * V4 — audit → client promotion ("Switch to client", UX-UI Bibbia 04:
 * "open the analysis or promote ('switch to client')"; README 01 §9).
 *
 * One onboarding mechanic: the New-audit wizard (/analyzer/v4) is where a
 * prospect enters the system, and this module is how that prospect BECOMES a
 * client — the audit's setup data (brand, domain, industry) is reshaped into
 * a `clients` row with lifecycle_stage 'active', exactly the shape the
 * /clients list and the analyzer client-picker already filter on.
 *
 * Everything here is pure so the rules are testable without HTTP or a DB:
 *   - readPromotion / linkedClientId — where an audit's client link lives
 *     (v4_setup.promoted_client_id for promotions, analyses.client_id when
 *     the audit was created for an existing client from the wizard).
 *   - buildClientRowFromAudit — the smallest `clients` insert that works
 *     with the existing RLS (clients_insert: user_id = auth.uid()) and the
 *     phase4a auto-owner trigger.
 *   - stampPromotion — the additive v4_setup patch (promoted_client_id +
 *     promoted_at), never dropping the other wizard keys.
 *
 * No migration needed: clients/client_members/analyses.client_id/v4_setup
 * all exist. The promotion state is jsonb by the same design rule as the
 * rest of v4_setup (nothing filters or joins on it server-side beyond the
 * conditional claim in the promote route).
 */

import { INDUSTRY_LABELS, type IndustryPreset } from '@/lib/v4/setup'

/** The analyses slice the promotion rules need. */
export interface PromotableAnalysis {
  id: string
  domain: string | null
  brand_name: string | null
  ref_date: string | null
  client_id: string | null
  industry_preset: string | null
  v4_setup: Record<string, unknown> | null
}

export interface PromotionState {
  promotedClientId: string | null
  promotedAt: string | null
}

/** The promotion stamp inside v4_setup, tolerant of any junk shape. */
export function readPromotion(
  v4Setup: Record<string, unknown> | null | undefined,
): PromotionState {
  const id = v4Setup?.promoted_client_id
  const at = v4Setup?.promoted_at
  return {
    promotedClientId: typeof id === 'string' && id.length > 0 ? id : null,
    promotedAt: typeof at === 'string' && at.length > 0 ? at : null,
  }
}

/**
 * The client this audit is already tied to, if any: a previous promotion
 * wins, else the client the wizard was opened for (?client=…). Either one
 * makes "Switch to client" read as "already a client".
 */
export function linkedClientId(a: {
  client_id: string | null
  v4_setup: Record<string, unknown> | null
}): string | null {
  return readPromotion(a.v4_setup).promotedClientId ?? a.client_id
}

/** Display name of the client the promotion would create. */
export function promotedClientName(a: {
  domain: string | null
  brand_name: string | null
}): string | null {
  const brand = a.brand_name?.trim()
  if (brand) return brand
  const domain = a.domain?.trim()
  return domain || null
}

export type ClientRowResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * The `clients` insert payload for a promotion — the V1 POST /api/clients
 * shape (so every existing list/RLS/trigger keeps working), fed from the
 * audit's setup:
 *   - name       = brand name, falling back to the domain
 *   - domain     = the audited domain (already bare-host normalized by setup)
 *   - industry   = the wizard's industry preset label, else its free-text sector
 *   - lifecycle_stage 'active' + engagement_started_at now: the phase4b
 *     trigger only stamps the start date on UPDATE prospect→active, so an
 *     INSERT born active must carry it itself.
 */
export function buildClientRowFromAudit(
  a: PromotableAnalysis,
  userId: string,
  now: Date = new Date(),
): ClientRowResult {
  const name = promotedClientName(a)
  if (!name) {
    return { ok: false, error: 'the audit has neither a brand name nor a domain' }
  }

  const domain = a.domain?.trim().toLowerCase() || null
  const sector = typeof a.v4_setup?.sector === 'string' ? a.v4_setup.sector.trim() : ''
  const presetLabel =
    a.industry_preset && a.industry_preset in INDUSTRY_LABELS
      ? INDUSTRY_LABELS[a.industry_preset as IndustryPreset]
      : null

  return {
    ok: true,
    row: {
      user_id: userId,
      name,
      domain,
      website_url: domain ? `https://${domain}` : null,
      industry: presetLabel ?? (sector || null),
      lifecycle_stage: 'active',
      engagement_started_at: now.toISOString(),
      notes: `Creato con "Switch to client" dall'audit V4 (${a.ref_date ?? a.id}).`,
    },
  }
}

/** v4_setup with the promotion stamped in — additive, nothing else touched. */
export function stampPromotion(
  v4Setup: Record<string, unknown> | null | undefined,
  clientId: string,
  now: Date = new Date(),
): Record<string, unknown> {
  return {
    ...(v4Setup ?? {}),
    promoted_client_id: clientId,
    promoted_at: now.toISOString(),
  }
}
