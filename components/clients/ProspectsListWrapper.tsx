'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ClientCard from '@/components/clients/ClientCard'
import { useLocale } from '@/lib/i18n'
import type { ClientData } from '@/components/clients/ClientsListWrapper'

interface Props {
  initialProspects: ClientData[]
}

export default function ProspectsListWrapper({ initialProspects }: Props) {
  const { t } = useLocale()
  const [prospects, setProspects] = useState<ClientData[]>(initialProspects)
  const [search, setSearch] = useState('')

  const filtered = useMemo(
    () => prospects.filter(c => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        c.name.toLowerCase().includes(q) ||
        (c.domain && c.domain.toLowerCase().includes(q)) ||
        (c.industry && c.industry.toLowerCase().includes(q))
      )
    }),
    [prospects, search],
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '24px', fontWeight: 700, color: '#ffffff',
          }}>
            {t('clients.prospects_page_title')}
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
            {t('clients.prospects_page_subtitle')} · {prospects.length}
          </p>
        </div>
        <Link
          href="/pre-sales/new"
          style={{
            padding: '10px 20px', background: '#c8e64a', color: '#111318',
            borderRadius: '8px', fontSize: '14px', fontWeight: 700,
            textDecoration: 'none', fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {t('clients.new_prospect_button')}
        </Link>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder={t('clients.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '10px 14px', background: '#1a1c24',
            border: '1px solid #2a2d35', borderRadius: '8px',
            color: '#ffffff', fontSize: '14px', outline: 'none',
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280' }}>
          <p style={{ fontSize: '16px', marginBottom: '12px' }}>
            {search ? t('clients.empty_search') : t('clients.empty_prospects')}
          </p>
          {!search && (
            <Link
              href="/pre-sales/new"
              style={{ color: '#c8e64a', textDecoration: 'underline', fontSize: '14px' }}
            >
              {t('clients.create_first_prospect')}
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
              onDeleted={(id) => setProspects(prev => prev.filter(c => c.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
