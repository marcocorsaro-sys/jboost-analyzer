'use client'

import type { ClientMemory, MemoryFact } from '@/lib/types/client'
import { useLocale, formatLocalDate } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface MemoryViewerProps {
  memory: ClientMemory
  onClose: () => void
}

export default function MemoryViewer({ memory, onClose }: MemoryViewerProps) {
  const { t, locale } = useLocale()
  const p = memory.profile

  const categoryLabels: Record<string, string> = {
    seo_performance: t('memory.catSeoPerformance'),
    business: t('memory.catBusiness'),
    technical: t('memory.catTechnical'),
    content: t('memory.catContent'),
    competitor: t('memory.catCompetitor'),
    martech: t('memory.catMartech'),
    contact: t('memory.catContact'),
    timeline: t('memory.catTimeline'),
    budget: t('memory.catBudget'),
    preference: t('memory.catPreference'),
    conversation_insight: t('memory.catConversationInsight'),
  }

  const groupFacts = (facts: MemoryFact[]) => {
    const grouped: Record<string, MemoryFact[]> = {}
    for (const f of facts) {
      if (!grouped[f.category]) grouped[f.category] = []
      grouped[f.category].push(f)
    }
    return grouped
  }

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[560px] max-w-[100vw] bg-background border-l border-border shadow-[-20px_0_60px_rgba(0,0,0,0.5)] z-[1000] flex flex-col overflow-hidden">
      {/* Overlay */}
      <div
        className="fixed top-0 left-0 right-[560px] bottom-0 bg-black/30 -z-[1]"
        onClick={onClose}
      />

      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-card flex justify-between items-center shrink-0">
        <div>
          <div className="font-mono text-sm font-bold text-primary">
            {'🧠 ' + t('memory.clientMemory')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {p.company_name || 'Cliente'} — {memory.completeness}% {t('memory.complete')}
          </div>
        </div>
        <button
          onClick={onClose}
          className="bg-secondary border-none text-muted-foreground text-sm cursor-pointer px-2.5 py-1.5 rounded-md font-mono"
        >
          {t('memory.close') + ' \u2715'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Profile Section */}
        <div className="mb-5">
          <div className="font-mono text-[13px] font-bold text-primary mb-2.5 pb-1.5 border-b border-border">
            {t('memory.companyProfile')}
          </div>
          {p.company_name && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelCompany')}:</span> {p.company_name}
            </div>
          )}
          {p.domain && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelDomain')}:</span> {p.domain}
            </div>
          )}
          {p.industry && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelIndustry')}:</span> {p.industry}
            </div>
          )}
          {p.description && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelDescription')}:</span> {p.description}
            </div>
          )}
          {p.founded && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelFounded')}:</span> {p.founded}
            </div>
          )}
          {p.headquarters && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelHeadquarters')}:</span> {p.headquarters}
            </div>
          )}
          {p.target_audience && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelTarget')}:</span> {p.target_audience}
            </div>
          )}
          {p.key_products_services && p.key_products_services.length > 0 && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelProducts')}:</span> {p.key_products_services.join(', ')}
            </div>
          )}
          {p.geographic_markets && p.geographic_markets.length > 0 && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelMarkets')}:</span> {p.geographic_markets.join(', ')}
            </div>
          )}
          {p.budget_info && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelBudget')}:</span> {p.budget_info}
            </div>
          )}
          {p.competitors && p.competitors.length > 0 && (
            <div className="text-[13px] text-foreground/90 mb-1 leading-normal">
              <span className="text-muted-foreground text-xs">{t('memory.labelCompetitors')}:</span> {p.competitors.join(', ')}
            </div>
          )}
          {p.team_contacts && p.team_contacts.length > 0 && (
            <div className="mt-2">
              <div className="text-muted-foreground text-xs">{t('memory.labelTeam')}:</div>
              {p.team_contacts.map((c, i) => (
                <div key={i} className="text-[13px] text-foreground/90 mb-1 leading-normal pl-3">
                  • {c.name} ({c.role}){c.email ? ` — ${c.email}` : ''}
                </div>
              ))}
            </div>
          )}
          {p.business_goals && p.business_goals.length > 0 && (
            <div className="mt-2">
              <div className="text-muted-foreground text-xs">{t('memory.labelGoals')}:</div>
              {p.business_goals.map((g, i) => (
                <div key={i} className="text-[13px] text-foreground/90 mb-1 leading-normal pl-3">• {g}</div>
              ))}
            </div>
          )}
          {p.challenges && p.challenges.length > 0 && (
            <div className="mt-2">
              <div className="text-muted-foreground text-xs">{t('memory.labelChallenges')}:</div>
              {p.challenges.map((c, i) => (
                <div key={i} className="text-[13px] text-foreground/90 mb-1 leading-normal pl-3">• {c}</div>
              ))}
            </div>
          )}
        </div>

        {/* Narrative */}
        {memory.narrative && (
          <div className="mb-5">
            <div className="font-mono text-[13px] font-bold text-primary mb-2.5 pb-1.5 border-b border-border">
              {t('memory.narrativeSummary')}
            </div>
            <div className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {memory.narrative}
            </div>
          </div>
        )}

        {/* Facts */}
        {memory.facts.length > 0 && (
          <div className="mb-5">
            <div className="font-mono text-[13px] font-bold text-primary mb-2.5 pb-1.5 border-b border-border">
              {t('memory.keyFacts')} ({memory.facts.length})
            </div>
            {Object.entries(groupFacts(memory.facts)).map(([cat, facts]) => (
              <div key={cat} className="mb-3">
                <div className="text-[11px] font-bold text-muted-foreground/80 mb-1 font-mono uppercase tracking-wide">
                  {categoryLabels[cat] || cat}
                </div>
                {facts.map((f, i) => (
                  <div key={i} className="text-xs text-foreground/80 pl-3 mb-0.5 leading-relaxed">
                    • {f.fact}
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      [{f.source}]
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* User Answers */}
        {memory.answers.length > 0 && (
          <div className="mb-5">
            <div className="font-mono text-[13px] font-bold text-primary mb-2.5 pb-1.5 border-b border-border">
              {t('memory.userAnswers')} ({memory.answers.length})
            </div>
            {memory.answers.map((a, i) => (
              <div key={i} className="p-2.5 px-3 bg-card rounded-lg mb-2 border border-border">
                <div className="text-xs text-muted-foreground mb-1">
                  D: {a.question}
                </div>
                <div className="text-[13px] text-foreground/90">
                  R: {a.answer}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {formatLocalDate(a.answered_at, locale)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
