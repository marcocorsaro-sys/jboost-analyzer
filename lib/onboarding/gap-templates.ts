// ============================================================
// JBoost — Phase 5D — Gap templates
//
// Converts a list of skipped onboarding field paths into
// `MemoryGap` rows so they show up in the existing
// `components/memory/MemoryGapsList.tsx` and can be answered
// asynchronously via the standard gap-answer flow.
//
// Kept pure (no Supabase, no i18n resolution) so it can be
// used by both the /onboarding/complete API route and any
// future background job.
// ============================================================

import type { MemoryGap, MemoryGapImportance } from '@/lib/types/client'
import { findFieldByPath, type OnboardingField } from './sections'

/**
 * Human-readable question templates for onboarding gap categories.
 * We intentionally don't pull from i18n here because gap questions are
 * stored in the DB and re-read by the LLM synthesizer, which operates
 * in Italian by convention (see lib/memory/prompts.ts).
 *
 * Each entry is a map from the last segment of the dotted path to the
 * prompt to ask the user. Falls back to a generic "Can you clarify X?"
 * question when the exact field isn't in the table.
 */
const QUESTION_TEMPLATES: Record<string, string> = {
  // Brand
  'brand.legal_name':  'Qual e\' la ragione sociale ufficiale dell\'azienda?',
  'brand.tagline':     'Esiste una tagline o un payoff ufficiale del brand?',
  'brand.uvp':         'Qual e\' la Unique Value Proposition del brand in una frase?',
  'brand.mission':     'Qual e\' la mission del brand?',
  'brand.values':      'Quali sono i valori fondanti del brand?',
  'brand.voice':       'Come descriveresti la brand voice (es. autorevole, friendly, tecnico)?',
  'brand.tone':        'Qual e\' il tono di comunicazione preferito?',
  'brand.do_not_say':  'Ci sono parole, claim o argomenti che il brand non deve mai usare?',

  // Markets
  'markets.primary_regions':   'Quali sono i mercati geografici primari del cliente?',
  'markets.secondary_regions': 'Quali sono i mercati secondari o di espansione futura?',
  'markets.languages':         'In quali lingue deve comunicare il brand?',
  'markets.b2b_b2c':           'Il business e\' principalmente B2B, B2C o misto?',
  'markets.icp':               'Qual e\' l\'Ideal Customer Profile del cliente?',
  'markets.personas':          'Quali sono le buyer personas prioritarie?',

  // Stakeholders
  'stakeholders': 'Chi sono i decision maker e gli approvatori chiave sul lato cliente (nome, ruolo, dipartimento)?',

  // Access
  'access.cms.platform':               'Quale CMS utilizza il sito del cliente?',
  'access.cms.credentials_location':   'Dove sono conservate le credenziali CMS per l\'accesso tecnico?',
  'access.analytics.ga4_property_id':  'Qual e\' il property ID di Google Analytics 4 del cliente?',
  'access.analytics.gsc_verified':     'La proprieta\' del dominio e\' verificata su Google Search Console?',
  'access.seo_tools.semrush':          'Il cliente ha un account SEMrush attivo?',
  'access.seo_tools.ahrefs':           'Il cliente ha un account Ahrefs attivo?',
  'access.seo_tools.notes':            'Ci sono altri tool SEO / dati storici a cui possiamo accedere?',
  'access.asset_repos':                'Dove sono conservati gli asset creativi (Drive, DAM, Figma, ...)?',
  'access.brand_guidelines_url':       'Esiste un documento di brand guidelines che possiamo consultare?',

  // SEO Foundation
  'seo_foundation.maturity_level':     'Qual e\' il livello di maturita\' SEO attuale del cliente?',
  'seo_foundation.priority_keywords':  'Quali sono le keyword strategiche su cui il cliente vuole posizionarsi?',
  'seo_foundation.priority_topics':    'Quali sono i topic / temi prioritari per la strategia SEO?',
  'seo_foundation.priority_pages':     'Quali sono le pagine strategiche del sito (landing, prodotti, blog)?',
  'seo_foundation.current_issues':     'Ci sono problemi SEO noti che il cliente vuole risolvere subito?',
  'seo_foundation.historical_context': 'Ci sono azioni SEO passate (buone o negative) da conoscere?',

  // GEO
  'geo.target_engines':                  'Su quali motori generativi vogliamo ottenere visibilita\' (ChatGPT, Perplexity, Google AI Overviews, Gemini, Claude, Copilot)?',
  'geo.entity_status.wikipedia':         'Il brand o i suoi founder hanno una pagina Wikipedia?',
  'geo.entity_status.knowledge_panel':   'Il brand ha un Knowledge Panel su Google?',
  'geo.entity_status.llms_txt':          'Esiste un file llms.txt pubblicato sul dominio?',
  'geo.schema_maturity':                 'A che livello e\' l\'implementazione di dati strutturati schema.org?',
  'geo.eeat_signals':                    'Quali sono i segnali E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) attualmente presenti sul sito?',
  'geo.author_entities':                 'Chi sono gli autori riconosciuti / firmatari dei contenuti (nome e credenziali)?',
  'geo.current_mentions':                'Ci sono menzioni attuali del brand negli output di ChatGPT / Perplexity / AI Overviews?',
  'geo.geo_goals':                       'Quali sono gli obiettivi specifici di visibilita\' sui motori generativi?',

  // Content Strategy
  'content_strategy.pillars':                 'Quali sono i pillar di contenuto principali del cliente?',
  'content_strategy.topic_clusters':          'Quali topic cluster sono gia\' coperti e quali sono in roadmap?',
  'content_strategy.editorial_calendar_url':  'Esiste un calendario editoriale consultabile?',
  'content_strategy.formats':                 'Quali formati di contenuto vengono prodotti (blog, video, podcast, whitepaper)?',
  'content_strategy.publishing_cadence':      'Qual e\' la cadenza di pubblicazione attuale?',
  'content_strategy.multilingual':            'La strategia di contenuti e\' multilingua?',
  'content_strategy.distribution_channels':   'Su quali canali vengono distribuiti i contenuti?',
  'content_strategy.content_inventory_size':  'Qual e\' la dimensione dell\'attuale content inventory?',

  // Goals & KPI
  'goals_kpis.short_term':       'Quali sono gli obiettivi di business a 90 giorni?',
  'goals_kpis.medium_term':      'Quali sono gli obiettivi a 6 mesi?',
  'goals_kpis.long_term':        'Quali sono gli obiettivi a 12 mesi o piu\'?',
  'goals_kpis.primary_kpi':      'Qual e\' il KPI primario su cui misuriamo il successo?',
  'goals_kpis.baselines':        'Quali sono i valori di baseline attuali dei KPI principali?',
  'goals_kpis.success_criteria': 'Cosa renderebbe questo progetto un successo agli occhi del cliente?',

  // Compliance
  'compliance.regulations':            'Ci sono regolamenti specifici (GDPR, HIPAA, MiFID, ...) a cui il brand deve attenersi?',
  'compliance.approval_workflow':      'Qual e\' il workflow di approvazione dei contenuti lato cliente?',
  'compliance.embargo_topics':         'Ci sono argomenti o claim che il cliente vuole evitare per motivi legali?',
  'compliance.legal_review_required':  'Ogni contenuto richiede review legale prima della pubblicazione?',
  'compliance.trademark_notes':        'Ci sono considerazioni su marchi registrati o competitive claims?',

  // Engagement
  'engagement.type':                      'Qual e\' il tipo di engagement (retainer, project-based, audit)?',
  'engagement.contract_type':             'Che tipo di contratto regola la collaborazione?',
  'engagement.services':                  'Quali servizi rientrano nello scope?',
  'preferences.communication_language':   'In quale lingua vuole comunicare il cliente?',
  'preferences.report_frequency':         'Con che frequenza vuole ricevere report?',
  'preferences.preferred_contact':        'Qual e\' il canale di contatto preferito?',
}

/**
 * Build a natural-language question for a given field path, falling
 * back to a generic template when no custom copy exists.
 */
function questionForField(path: string): string {
  const templated = QUESTION_TEMPLATES[path]
  if (templated) return templated
  // Generic fallback built from the last path segment.
  const last = path.split('.').pop() || path
  return `Puoi fornire informazioni sul campo "${last}" dell'onboarding?`
}

/**
 * Turn skipped onboarding field paths into MemoryGap rows.
 * Each gap inherits its `importance` and `category` from the field
 * definition in `sections.ts`, and carries a `context` that references
 * the source so the synthesizer can reason about it.
 */
export function buildGapsFromSkippedFields(skipped: string[]): MemoryGap[] {
  const gaps: MemoryGap[] = []
  const seen = new Set<string>()

  skipped.forEach((path, idx) => {
    if (seen.has(path)) return
    seen.add(path)

    const field: OnboardingField | undefined = findFieldByPath(path)

    // If the path is unknown to us (shouldn't happen in practice),
    // default to the lowest priority gap so it doesn't dominate the UI.
    const importance: MemoryGapImportance = field?.importance ?? 'low'
    const category = field?.gapCategory ?? 'business'

    gaps.push({
      id: `gap_onboarding_${Date.now()}_${idx}`,
      category,
      question: questionForField(path),
      importance,
      context: `Campo skippato durante l'onboarding strutturato (path: ${path}).`,
    })
  })

  return gaps
}
