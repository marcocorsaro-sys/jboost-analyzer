'use client'

import { useLocale } from '@/lib/i18n'

/**
 * Compact informative card shown in place of MonitoringPanel when the
 * client is still a prospect. The real panel (weekly/biweekly/monthly
 * scheduling) is gated on an active engagement because:
 *   - client_update_subscriptions rows are created by the promote endpoint
 *   - the cron orchestrator only considers subscriptions with is_active=true
 *   - running analyses against a prospect would burn API credits on a
 *     client that hasn't been formally onboarded
 *
 * Rather than hiding the section entirely (which was confusing users into
 * thinking the scheduling feature had been removed), we surface the section
 * as a "locked" card that explains the gate and points at the Activate CTA
 * in the LifecycleActions bar at the top of the page.
 */
export default function MonitoringLockedCard() {
  const { t } = useLocale()

  return (
    <div
      style={{
        background: '#1a1c24',
        borderRadius: '12px',
        border: '1px solid #2a2d35',
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div style={{ marginBottom: '12px' }}>
        <h3
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            fontWeight: 600,
            color: '#c8e64a',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            margin: 0,
          }}
        >
          {t('clients.monitoring_title')}
        </h3>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
          {t('clients.monitoring_subtitle')}
        </div>
      </div>

      <div
        style={{
          padding: '12px 16px',
          background: '#f59e0b10',
          border: '1px solid #f59e0b33',
          borderRadius: '8px',
          color: '#f59e0b',
          fontSize: '12px',
          lineHeight: 1.5,
        }}
      >
        {t('clients.monitoring_locked_prospect')}
      </div>
    </div>
  )
}
