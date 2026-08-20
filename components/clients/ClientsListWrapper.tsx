'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ClientCard from '@/components/clients/ClientCard'
import { useLocale } from '@/lib/i18n'
import type { ClientLifecycleStage } from '@/lib/types/client'
import { B } from '@/lib/brand'

export interface ClientData {
  id: string
  name: string
  domain: string | null
  industry: string | null
  status: 'active' | 'archived'
  lifecycle_stage: ClientLifecycleStage
  analyses_count: number
  latest_score: number | null
  latest_analysis_at: string | null
}

interface Props {
  initialClients: ClientData[]
}

export default function ClientsListWrapper({ initialClients }: Props) {
  const { t } = useLocale()
  const [clients, setClients] = useState<ClientData[]>(initialClients)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active')

  const filtered = useMemo(
    () => clients.filter(c => {
      if (filter === 'active' && c.status !== 'active') return false
      if (filter === 'archived' && c.status !== 'archived') return false
      if (search) {
        const q = search.toLowerCase()
        return (
          c.name.toLowerCase().includes(q) ||
          (c.domain && c.domain.toLowerCase().includes(q)) ||
          (c.industry && c.industry.toLowerCase().includes(q))
        )
      }
      return true
    }),
    [clients, filter, search],
  )

  const activeCount = clients.filter(
    c => c.status === 'active' && c.lifecycle_stage === 'active',
  ).length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{
            fontFamily: B.fontMono,
            fontSize: '24px', fontWeight: 700, color: B.ink,
          }}>
            {t('clients.active_clients_title')}
          </h1>
          <p style={{ fontSize: '14px', color: B.muted, marginTop: '4px' }}>
            {t('clients.active_clients_subtitle')} · {activeCount}
          </p>
        </div>
        {/* One onboarding mechanic (V4): a new client starts as a New-audit
            prospect and is promoted with "Switch to client" — so this CTA
            goes to the wizard, not to the parked V1 /pre-sales intake. */}
        <Link
          href="/analyzer/v4"
          style={{
            padding: '10px 20px', background: B.primary, color: B.bg,
            borderRadius: '8px', fontSize: '14px', fontWeight: 700,
            textDecoration: 'none', fontFamily: B.fontMono,
          }}
        >
          {t('clients.new_client_button')}
        </Link>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder={t('clients.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '10px 14px', background: B.surface,
            border: `1px solid ${B.border}`, borderRadius: '8px',
            color: B.ink, fontSize: '14px', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: '4px', background: B.surface, borderRadius: '8px', padding: '3px' }}>
          {(['active', 'archived', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '7px 14px',
                background: filter === f ? B.border : 'transparent',
                color: filter === f ? B.ink : B.muted,
                border: 'none', borderRadius: '6px',
                fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {f === 'all'
                ? t('clients.filter_all')
                : f === 'active'
                  ? t('clients.filter_active')
                  : t('clients.filter_archived')}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: B.muted }}>
          <p style={{ fontSize: '16px', marginBottom: '12px' }}>
            {search ? t('clients.empty_search') : t('clients.empty_active')}
          </p>
          {!search && (
            /* Empty state → straight into the single onboarding: the wizard. */
            <Link
              href="/analyzer/v4"
              style={{ color: B.primary, textDecoration: 'underline', fontSize: '14px' }}
            >
              {t('clients.empty_start_audit')}
            </Link>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '16px',
        }}>
          {filtered.map((client) => (
            <ClientCard
              key={client.id}
              {...client}
              onDeleted={(id) => setClients((prev) => prev.filter((c) => c.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
