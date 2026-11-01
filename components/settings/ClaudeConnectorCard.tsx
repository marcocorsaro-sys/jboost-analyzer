import T from '@/components/ui/T'
import CopyUrlButton from './CopyUrlButton'
import { B } from '@/lib/brand'
import { mcpEndpointUrl, supabaseAuthIssuer } from '@/lib/mcp/auth'
import { getUsageSummary } from '@/lib/mcp/usage'
import UsageLine from './UsageLine'

async function oauthServerActive(): Promise<boolean> {
  const issuer = supabaseAuthIssuer()
  if (!issuer) return false
  try {
    const base = issuer.replace(/\/auth\/v1$/, '')
    const res = await fetch(`${base}/.well-known/oauth-authorization-server/auth/v1`, {
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

export default async function ClaudeConnectorCard({ origin, isAdmin }: { origin: string; isAdmin: boolean }) {
  const url = mcpEndpointUrl(origin)
  const [active, usage] = await Promise.all([oauthServerActive(), getUsageSummary()])

  return (
    <div className="mb-5 rounded-xl border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
          <T k="mcp.title" />
        </h2>
        <span
          className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
          style={active ? { background: `${B.success}18`, color: B.success } : { background: `${B.error}18`, color: B.error }}
        >
          <T k={active ? 'mcp.status_active' : 'mcp.status_inactive'} />
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        <T k="mcp.hint" />
      </p>
      {!active && (
        <p className="mb-4 text-sm" style={{ color: B.error }}>
          <T k="mcp.status_inactive_hint" />
        </p>
      )}

      <div className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        <T k="mcp.url" />
      </div>
      <div className="mb-4 flex items-center gap-2">
        <code className="flex-1 select-all overflow-x-auto rounded-lg bg-background px-3.5 py-2.5 font-mono text-[13px] text-foreground">
          {url}
        </code>
        <CopyUrlButton value={url} />
      </div>

      <details className="mb-4">
        <summary className="cursor-pointer text-[14px] font-semibold text-foreground">
          <T k="mcp.guide" />
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li><T k="mcp.guide_1" /></li>
          <li><T k="mcp.guide_2" /></li>
          <li><T k="mcp.guide_3" /></li>
          <li><T k="mcp.guide_4" /></li>
        </ol>
      </details>

      <div className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        <T k="mcp.usage" />
      </div>
      {usage.totalCalls === 0 ? (
        <p className="text-sm text-muted-foreground"><T k="mcp.usage_none" /></p>
      ) : (
        <UsageLine calls={usage.totalCalls} people={usage.people} lastCallAt={usage.lastCallAt!} />
      )}

      {isAdmin && usage.perPerson.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            <T k="mcp.per_person" />
          </div>
          <div className="flex flex-col gap-1.5">
            {usage.perPerson.map((p) => (
              <div key={`${p.email}-${p.lastCallAt}`} className="flex items-center justify-between rounded-lg bg-background px-3.5 py-2">
                <span className="text-[13px] text-foreground">{p.email ?? '—'}</span>
                <span className="font-mono text-[13px] text-muted-foreground">{p.calls}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
