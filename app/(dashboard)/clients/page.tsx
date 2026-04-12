'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ClientCard from '@/components/clients/ClientCard'
import { useLocale } from '@/lib/i18n'
import type { ClientLifecycleStage } from '@/lib/types/client'

interface ClientData {
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

// Stages shown on the "Active Clients" page: everything except prospects.
const NON_PROSPECT_STAGES: ClientLifecycleStage[] = ['active', 'churned', 'archived']

export default function ClientsPage() {
  const { t } = useLocale()
  const [clients, setClients] = useState<ClientData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'archived'>('active')

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      // Fetch all client stages except prospect in parallel
      const results = await Promise.all(
        NON_PROSPECT_STAGES.map((stage) =>
          fetch(`/api/clients?stage=${stage}`).then((r) => r.json())
        )
      )
      const merged: ClientData[] = results.flatMap((r) => r.clients || [])
      // Preserve most-recently-updated ordering across the merged set
      merged.sort((a, b) => {
        const aTs = (a as unknown as { updated_at?: string }).updated_at || ''
        const bTs = (b as unknown as { updated_at?: string }).updated_at || ''
        return bTs.localeCompare(aTs)
      })
      setClients(merged)
    } catch (err) {
      console.error('Failed to fetch clients:', err)
    } finally {
      setLoading(false)
    }
  }

  const filtered = clients.filter((c) => {
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
  })

  const activeCount = clients.filter(
    (c) => c.status === 'active' && c.lifecycle_stage === 'active'
  ).length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '24px',
            fontWeight: 700,
            color: '#ffffff',
          }}>
            {t('clients.active_clients_title')}
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
            {t('clients.active_clients_subtitle')} · {activeCount}
          </p>
        </div>
        <Link
          href="/pre-sales/new"
          style={{
            padding: '10px 20px',
            background: '#c8e64a',
            color: '#111318',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            textDecoration: 'none',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {t('clients.new_prospect_button')}
        </Link>
      </div>

      {/* Search & Filter bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder={t('clients.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: '#1a1c24',
            border: '1px solid #2a2d35',
            borderRadius: '8px',
            color: '#ffffff',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: '4px', background: '#1a1c24', borderRadius: '8px', padding: '3px' }}>
          {(['active', 'archived', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '7px 14px',
                background: filter === f ? '#2a2d35' : 'transparent',
                color: filter === f ? '#ffffff' : '#6b7280',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
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

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
          {t('common.loading')}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 0',
          color: '#6b7280',
        }}>
          <p style={{ fontSize: '16px', marginBottom: '12px' }}>
            {search ? t('clients.empty_search') : t('clients.empty_active')}
          </p>
          {!search && (
            <Link
              href="/pre-sales"
              style={{ color: '#c8e64a', textDecoration: 'underline', fontSize: '14px' }}
            >
              {t('clients.see_prospects_link')}
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
            <ClientCard key={client.id} {...client} />
          ))}
        </div>
      )}
    </div>
  )
}
