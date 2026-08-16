import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser, getProfileRole } from '@/lib/supabase/server'
import { getSettingsInventory } from '@/lib/admin/connector-status'
import T from '@/components/ui/T'
import PreferencesForm from '@/components/settings/PreferencesForm'

export const dynamic = 'force-dynamic'

/**
 * Settings (UX-UI Bibbia 04, "Navigation & Screens"):
 * "APIs / data sources / preferences (API keys, connectors, defaults)".
 *
 * Three sections:
 *  a) Connectors — configured/missing per data-source key. Presence ONLY,
 *     never a value (lib/admin/connector-status). Shown to admins, the same
 *     gate as the admin integration probes this reuses the key-resolution of.
 *  b) Defaults — the V4 run defaults (spend cap + LLM models), read-only
 *     with a link to Admin where the app_config editor already lives.
 *  c) Preferences — the pre-existing profile/password island, for everyone.
 *
 * Admin is linked from here, NOT from the sidebar (Bibbia: five entries).
 */
export default async function SettingsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const isAdmin = (await getProfileRole(user.id)) === 'admin'

  const supabase = await createClient()
  // Connector presence + defaults follow the admin probes' access model:
  // admin-only. Non-admins still get their preferences.
  const inventory = isAdmin ? await getSettingsInventory(supabase) : null

  return (
    <div className="max-w-[640px] p-8">
      <h1 className="mb-8 font-mono text-2xl font-bold text-foreground">
        <T k="settings.title" />
      </h1>

      {/* a) APIs & data sources — presence only, values never leave the server */}
      {inventory && (
        <div className="mb-5 rounded-xl border bg-card p-6">
          <h2 className="mb-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            <T k="settings.connectors" />
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            <T k="settings.connectors_hint" />
          </p>
          <div className="flex flex-col gap-2">
            {inventory.connectors.map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between rounded-lg bg-background px-3.5 py-2.5"
              >
                <span className="font-mono text-xs text-foreground">{c.key}</span>
                <span
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={
                    c.configured
                      ? { background: '#22c55e18', color: '#22c55e' }
                      : { background: '#ef444418', color: '#ef4444' }
                  }
                >
                  {c.configured ? (
                    <>
                      <T k="settings.connector_configured" />
                      {c.source === 'db' ? ' · db' : ' · env'}
                    </>
                  ) : (
                    <T k="settings.connector_missing" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* b) Defaults — read-only; editing stays in the Admin app_config panel */}
      {inventory && (
        <div className="mb-5 rounded-xl border bg-card p-6">
          <h2 className="mb-2 font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
            <T k="settings.defaults" />
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            <T k="settings.defaults_hint" />
          </p>
          <div className="flex flex-col gap-2">
            {(
              [
                ['daily_spend_limit_eur', inventory.defaults.daily_spend_limit_eur],
                ['v4_llm_driver_model', inventory.defaults.v4_llm_driver_model],
                ['v4_llm_summary_model', inventory.defaults.v4_llm_summary_model],
              ] as const
            ).map(([key, value]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg bg-background px-3.5 py-2.5"
              >
                <span className="font-mono text-xs text-muted-foreground">{key}</span>
                <span className="font-mono text-xs text-foreground">
                  {value}
                  {inventory.defaults.sources[key] === 'default' && (
                    <span className="ml-2 text-muted-foreground">
                      (<T k="settings.default_builtin" />)
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* c) Admin link — Admin left the sidebar (Bibbia: five entries) but
             stays one click away for the rest (probes, config editor, users). */}
      {isAdmin && (
        <div className="mb-5 rounded-xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
                <T k="nav.admin" />
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                <T k="settings.admin_hint" />
              </p>
            </div>
            <Link
              href="/admin"
              className="rounded-lg border border-border px-4 py-2 text-[13px] font-semibold text-foreground no-underline transition-colors hover:bg-accent"
            >
              <T k="settings.open_admin" />
            </Link>
          </div>
        </div>
      )}

      {/* Preferences — profile, language, password (pre-existing island) */}
      <PreferencesForm />
    </div>
  )
}
