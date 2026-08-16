'use client'

import { useLocale } from '@/lib/i18n'

/**
 * 'Switch to client' — promotion hook (UX-UI Bibbia 04: "open the analysis
 * or promote ('switch to client')"; README 01 §9: promotion belongs to the
 * ongoing phase). Deliberately a DISABLED stub: the affordance is visible so
 * the flow reads as the Bibbia describes it, the action ships with the
 * ongoing/client phase. Tooltip via native title (no extra dependency).
 */
export default function SwitchToClientButton() {
  const { t } = useLocale()
  return (
    // Title lives on the wrapper: some browsers swallow pointer events (and
    // the tooltip with them) on a disabled button itself.
    <span title={t('audits.switch_tooltip')} className="inline-block">
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="pointer-events-none inline-block cursor-not-allowed rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-muted-foreground opacity-60"
      >
        {t('audits.switch_to_client')}
      </button>
    </span>
  )
}
