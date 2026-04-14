// ============================================================
// JBoost — Phase 5D — Onboarding question bank
//
// Central definition of the onboarding wizard. Each `OnboardingSection`
// maps one-to-one to a wizard step; each `OnboardingField` is rendered
// by `components/onboarding/SectionForm.tsx` and writes to a dotted path
// inside `MemoryProfile` (e.g. `brand.voice`).
//
// Every field is OPTIONAL by design: the user can answer, skip, or come
// back later. Skipped fields are recorded on `profile.onboarding
// .skipped_fields` and converted to `MemoryGap`s by `gap-templates.ts`
// at completion time.
//
// Keep this file pure data — no React, no server code — so it can be
// imported from both client and server contexts (wizard UI + API routes).
// ============================================================

import type { MemoryGapCategory, MemoryGapImportance } from '@/lib/types/client'

/** Current onboarding schema version. Bump when the question bank
 *  changes in a way that invalidates stored `completed_sections`. */
export const ONBOARDING_VERSION = 1

export type OnboardingFieldType =
  | 'text'          // single-line string
  | 'textarea'      // multi-line string
  | 'list'          // string[] (one item per line or chip input)
  | 'select'        // single choice from `options`
  | 'multiselect'   // multiple choices from `options`
  | 'toggle'        // boolean
  | 'personas'      // Array<{ name, description, pain_points[] }>
  | 'stakeholders'  // Array<{ name, role, department, email, ... }>
  | 'authors'       // Array<{ name, credentials }>
  | 'kv'            // Record<string, string> (baselines)

export interface OnboardingFieldOption {
  value: string
  labelKey: string  // i18n key
}

export interface OnboardingField {
  /** Dotted path inside MemoryProfile (e.g. "brand.voice"). */
  path: string
  type: OnboardingFieldType
  labelKey: string
  helpKey?: string
  placeholderKey?: string
  /** Priority used when a skipped field is turned into a MemoryGap. */
  importance: MemoryGapImportance
  /** MemoryGapCategory to assign when this field becomes a gap. */
  gapCategory: MemoryGapCategory
  /** For select / multiselect. */
  options?: OnboardingFieldOption[]
}

export interface OnboardingSection {
  id: string
  titleKey: string
  descriptionKey?: string
  icon: string  // emoji or short marker (no real icon system in place)
  fields: OnboardingField[]
}

/**
 * The 10 onboarding sections. Order matters: the wizard walks them
 * sequentially, and the completeness / progress bar is computed from
 * this order.
 */
export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  // ── 1. Brand & Azienda ───────────────────────────────────────
  {
    id: 'brand',
    titleKey: 'onboarding.sections.brand.title',
    descriptionKey: 'onboarding.sections.brand.description',
    icon: 'B',
    fields: [
      { path: 'brand.legal_name', type: 'text',
        labelKey: 'onboarding.fields.brand.legal_name',
        importance: 'medium', gapCategory: 'brand' },
      { path: 'brand.tagline', type: 'text',
        labelKey: 'onboarding.fields.brand.tagline',
        importance: 'low', gapCategory: 'brand' },
      { path: 'brand.uvp', type: 'textarea',
        labelKey: 'onboarding.fields.brand.uvp',
        helpKey: 'onboarding.fields.brand.uvp_help',
        importance: 'high', gapCategory: 'brand' },
      { path: 'brand.mission', type: 'textarea',
        labelKey: 'onboarding.fields.brand.mission',
        importance: 'medium', gapCategory: 'brand' },
      { path: 'brand.values', type: 'list',
        labelKey: 'onboarding.fields.brand.values',
        importance: 'low', gapCategory: 'brand' },
      { path: 'brand.voice', type: 'textarea',
        labelKey: 'onboarding.fields.brand.voice',
        helpKey: 'onboarding.fields.brand.voice_help',
        importance: 'high', gapCategory: 'brand' },
      { path: 'brand.tone', type: 'text',
        labelKey: 'onboarding.fields.brand.tone',
        importance: 'medium', gapCategory: 'brand' },
      { path: 'brand.do_not_say', type: 'list',
        labelKey: 'onboarding.fields.brand.do_not_say',
        helpKey: 'onboarding.fields.brand.do_not_say_help',
        importance: 'medium', gapCategory: 'brand' },
    ],
  },

  // ── 2. Mercati & Target ──────────────────────────────────────
  {
    id: 'markets',
    titleKey: 'onboarding.sections.markets.title',
    descriptionKey: 'onboarding.sections.markets.description',
    icon: 'M',
    fields: [
      { path: 'markets.primary_regions', type: 'list',
        labelKey: 'onboarding.fields.markets.primary_regions',
        importance: 'high', gapCategory: 'markets' },
      { path: 'markets.secondary_regions', type: 'list',
        labelKey: 'onboarding.fields.markets.secondary_regions',
        importance: 'low', gapCategory: 'markets' },
      { path: 'markets.languages', type: 'list',
        labelKey: 'onboarding.fields.markets.languages',
        importance: 'medium', gapCategory: 'markets' },
      { path: 'markets.b2b_b2c', type: 'select',
        labelKey: 'onboarding.fields.markets.b2b_b2c',
        importance: 'high', gapCategory: 'markets',
        options: [
          { value: 'b2b',    labelKey: 'onboarding.options.b2b_b2c.b2b' },
          { value: 'b2c',    labelKey: 'onboarding.options.b2b_b2c.b2c' },
          { value: 'b2b2c',  labelKey: 'onboarding.options.b2b_b2c.b2b2c' },
          { value: 'mixed',  labelKey: 'onboarding.options.b2b_b2c.mixed' },
        ],
      },
      { path: 'markets.icp', type: 'textarea',
        labelKey: 'onboarding.fields.markets.icp',
        helpKey: 'onboarding.fields.markets.icp_help',
        importance: 'high', gapCategory: 'markets' },
      { path: 'markets.personas', type: 'personas',
        labelKey: 'onboarding.fields.markets.personas',
        importance: 'medium', gapCategory: 'markets' },
    ],
  },

  // ── 3. Stakeholders ─────────────────────────────────────────
  {
    id: 'stakeholders',
    titleKey: 'onboarding.sections.stakeholders.title',
    descriptionKey: 'onboarding.sections.stakeholders.description',
    icon: 'S',
    fields: [
      { path: 'stakeholders', type: 'stakeholders',
        labelKey: 'onboarding.fields.stakeholders.list',
        helpKey: 'onboarding.fields.stakeholders.help',
        importance: 'high', gapCategory: 'stakeholders' },
    ],
  },

  // ── 4. Accessi & Asset ──────────────────────────────────────
  {
    id: 'access',
    titleKey: 'onboarding.sections.access.title',
    descriptionKey: 'onboarding.sections.access.description',
    icon: 'A',
    fields: [
      { path: 'access.cms.platform', type: 'text',
        labelKey: 'onboarding.fields.access.cms_platform',
        importance: 'high', gapCategory: 'access' },
      { path: 'access.cms.credentials_location', type: 'text',
        labelKey: 'onboarding.fields.access.cms_credentials_location',
        importance: 'medium', gapCategory: 'access' },
      { path: 'access.analytics.ga4_property_id', type: 'text',
        labelKey: 'onboarding.fields.access.ga4_property_id',
        importance: 'high', gapCategory: 'access' },
      { path: 'access.analytics.gsc_verified', type: 'toggle',
        labelKey: 'onboarding.fields.access.gsc_verified',
        importance: 'high', gapCategory: 'access' },
      { path: 'access.seo_tools.semrush', type: 'toggle',
        labelKey: 'onboarding.fields.access.semrush',
        importance: 'medium', gapCategory: 'access' },
      { path: 'access.seo_tools.ahrefs', type: 'toggle',
        labelKey: 'onboarding.fields.access.ahrefs',
        importance: 'medium', gapCategory: 'access' },
      { path: 'access.seo_tools.notes', type: 'textarea',
        labelKey: 'onboarding.fields.access.seo_tools_notes',
        importance: 'low', gapCategory: 'access' },
      { path: 'access.asset_repos', type: 'list',
        labelKey: 'onboarding.fields.access.asset_repos',
        importance: 'low', gapCategory: 'access' },
      { path: 'access.brand_guidelines_url', type: 'text',
        labelKey: 'onboarding.fields.access.brand_guidelines_url',
        importance: 'medium', gapCategory: 'access' },
    ],
  },

  // ── 5. SEO Foundation ───────────────────────────────────────
  {
    id: 'seo_foundation',
    titleKey: 'onboarding.sections.seo_foundation.title',
    descriptionKey: 'onboarding.sections.seo_foundation.description',
    icon: 'SEO',
    fields: [
      { path: 'seo_foundation.maturity_level', type: 'select',
        labelKey: 'onboarding.fields.seo_foundation.maturity_level',
        importance: 'high', gapCategory: 'seo_foundation',
        options: [
          { value: 'none',         labelKey: 'onboarding.options.maturity.none' },
          { value: 'basic',        labelKey: 'onboarding.options.maturity.basic' },
          { value: 'intermediate', labelKey: 'onboarding.options.maturity.intermediate' },
          { value: 'advanced',     labelKey: 'onboarding.options.maturity.advanced' },
        ],
      },
      { path: 'seo_foundation.priority_keywords', type: 'list',
        labelKey: 'onboarding.fields.seo_foundation.priority_keywords',
        helpKey: 'onboarding.fields.seo_foundation.priority_keywords_help',
        importance: 'high', gapCategory: 'seo_foundation' },
      { path: 'seo_foundation.priority_topics', type: 'list',
        labelKey: 'onboarding.fields.seo_foundation.priority_topics',
        importance: 'medium', gapCategory: 'seo_foundation' },
      { path: 'seo_foundation.priority_pages', type: 'list',
        labelKey: 'onboarding.fields.seo_foundation.priority_pages',
        importance: 'high', gapCategory: 'seo_foundation' },
      { path: 'seo_foundation.current_issues', type: 'list',
        labelKey: 'onboarding.fields.seo_foundation.current_issues',
        importance: 'medium', gapCategory: 'seo_foundation' },
      { path: 'seo_foundation.historical_context', type: 'textarea',
        labelKey: 'onboarding.fields.seo_foundation.historical_context',
        importance: 'low', gapCategory: 'seo_foundation' },
    ],
  },

  // ── 6. GEO — Generative Engine Optimization ─────────────────
  {
    id: 'geo',
    titleKey: 'onboarding.sections.geo.title',
    descriptionKey: 'onboarding.sections.geo.description',
    icon: 'GEO',
    fields: [
      { path: 'geo.target_engines', type: 'multiselect',
        labelKey: 'onboarding.fields.geo.target_engines',
        helpKey: 'onboarding.fields.geo.target_engines_help',
        importance: 'high', gapCategory: 'geo',
        options: [
          { value: 'chatgpt',    labelKey: 'onboarding.options.engines.chatgpt' },
          { value: 'perplexity', labelKey: 'onboarding.options.engines.perplexity' },
          { value: 'claude',     labelKey: 'onboarding.options.engines.claude' },
          { value: 'google_aio', labelKey: 'onboarding.options.engines.google_aio' },
          { value: 'gemini',     labelKey: 'onboarding.options.engines.gemini' },
          { value: 'copilot',    labelKey: 'onboarding.options.engines.copilot' },
        ],
      },
      { path: 'geo.entity_status.wikipedia', type: 'toggle',
        labelKey: 'onboarding.fields.geo.wikipedia',
        importance: 'medium', gapCategory: 'geo' },
      { path: 'geo.entity_status.knowledge_panel', type: 'toggle',
        labelKey: 'onboarding.fields.geo.knowledge_panel',
        importance: 'medium', gapCategory: 'geo' },
      { path: 'geo.entity_status.llms_txt', type: 'toggle',
        labelKey: 'onboarding.fields.geo.llms_txt',
        importance: 'medium', gapCategory: 'geo' },
      { path: 'geo.schema_maturity', type: 'select',
        labelKey: 'onboarding.fields.geo.schema_maturity',
        importance: 'high', gapCategory: 'geo',
        options: [
          { value: 'none',     labelKey: 'onboarding.options.schema.none' },
          { value: 'basic',    labelKey: 'onboarding.options.schema.basic' },
          { value: 'advanced', labelKey: 'onboarding.options.schema.advanced' },
        ],
      },
      { path: 'geo.eeat_signals', type: 'list',
        labelKey: 'onboarding.fields.geo.eeat_signals',
        helpKey: 'onboarding.fields.geo.eeat_signals_help',
        importance: 'high', gapCategory: 'geo' },
      { path: 'geo.author_entities', type: 'authors',
        labelKey: 'onboarding.fields.geo.author_entities',
        importance: 'medium', gapCategory: 'geo' },
      { path: 'geo.current_mentions', type: 'textarea',
        labelKey: 'onboarding.fields.geo.current_mentions',
        helpKey: 'onboarding.fields.geo.current_mentions_help',
        importance: 'low', gapCategory: 'geo' },
      { path: 'geo.geo_goals', type: 'list',
        labelKey: 'onboarding.fields.geo.geo_goals',
        importance: 'high', gapCategory: 'geo' },
    ],
  },

  // ── 7. Content Strategy ─────────────────────────────────────
  {
    id: 'content_strategy',
    titleKey: 'onboarding.sections.content_strategy.title',
    descriptionKey: 'onboarding.sections.content_strategy.description',
    icon: 'C',
    fields: [
      { path: 'content_strategy.pillars', type: 'list',
        labelKey: 'onboarding.fields.content.pillars',
        importance: 'high', gapCategory: 'content_strategy' },
      { path: 'content_strategy.topic_clusters', type: 'list',
        labelKey: 'onboarding.fields.content.topic_clusters',
        importance: 'medium', gapCategory: 'content_strategy' },
      { path: 'content_strategy.editorial_calendar_url', type: 'text',
        labelKey: 'onboarding.fields.content.editorial_calendar_url',
        importance: 'low', gapCategory: 'content_strategy' },
      { path: 'content_strategy.formats', type: 'list',
        labelKey: 'onboarding.fields.content.formats',
        importance: 'medium', gapCategory: 'content_strategy' },
      { path: 'content_strategy.publishing_cadence', type: 'text',
        labelKey: 'onboarding.fields.content.publishing_cadence',
        importance: 'medium', gapCategory: 'content_strategy' },
      { path: 'content_strategy.multilingual', type: 'toggle',
        labelKey: 'onboarding.fields.content.multilingual',
        importance: 'low', gapCategory: 'content_strategy' },
      { path: 'content_strategy.distribution_channels', type: 'list',
        labelKey: 'onboarding.fields.content.distribution_channels',
        importance: 'medium', gapCategory: 'content_strategy' },
      { path: 'content_strategy.content_inventory_size', type: 'text',
        labelKey: 'onboarding.fields.content.content_inventory_size',
        importance: 'low', gapCategory: 'content_strategy' },
    ],
  },

  // ── 8. Obiettivi & KPI ──────────────────────────────────────
  {
    id: 'goals_kpis',
    titleKey: 'onboarding.sections.goals_kpis.title',
    descriptionKey: 'onboarding.sections.goals_kpis.description',
    icon: 'K',
    fields: [
      { path: 'goals_kpis.short_term', type: 'list',
        labelKey: 'onboarding.fields.goals.short_term',
        importance: 'high', gapCategory: 'goals' },
      { path: 'goals_kpis.medium_term', type: 'list',
        labelKey: 'onboarding.fields.goals.medium_term',
        importance: 'medium', gapCategory: 'goals' },
      { path: 'goals_kpis.long_term', type: 'list',
        labelKey: 'onboarding.fields.goals.long_term',
        importance: 'medium', gapCategory: 'goals' },
      { path: 'goals_kpis.primary_kpi', type: 'text',
        labelKey: 'onboarding.fields.goals.primary_kpi',
        importance: 'high', gapCategory: 'goals' },
      { path: 'goals_kpis.baselines', type: 'kv',
        labelKey: 'onboarding.fields.goals.baselines',
        helpKey: 'onboarding.fields.goals.baselines_help',
        importance: 'medium', gapCategory: 'goals' },
      { path: 'goals_kpis.success_criteria', type: 'textarea',
        labelKey: 'onboarding.fields.goals.success_criteria',
        importance: 'high', gapCategory: 'goals' },
    ],
  },

  // ── 9. Compliance & Vincoli ─────────────────────────────────
  {
    id: 'compliance',
    titleKey: 'onboarding.sections.compliance.title',
    descriptionKey: 'onboarding.sections.compliance.description',
    icon: 'L',
    fields: [
      { path: 'compliance.regulations', type: 'list',
        labelKey: 'onboarding.fields.compliance.regulations',
        helpKey: 'onboarding.fields.compliance.regulations_help',
        importance: 'medium', gapCategory: 'compliance' },
      { path: 'compliance.approval_workflow', type: 'textarea',
        labelKey: 'onboarding.fields.compliance.approval_workflow',
        importance: 'medium', gapCategory: 'compliance' },
      { path: 'compliance.embargo_topics', type: 'list',
        labelKey: 'onboarding.fields.compliance.embargo_topics',
        importance: 'medium', gapCategory: 'compliance' },
      { path: 'compliance.legal_review_required', type: 'toggle',
        labelKey: 'onboarding.fields.compliance.legal_review_required',
        importance: 'low', gapCategory: 'compliance' },
      { path: 'compliance.trademark_notes', type: 'textarea',
        labelKey: 'onboarding.fields.compliance.trademark_notes',
        importance: 'low', gapCategory: 'compliance' },
    ],
  },

  // ── 10. Engagement ──────────────────────────────────────────
  {
    id: 'engagement',
    titleKey: 'onboarding.sections.engagement.title',
    descriptionKey: 'onboarding.sections.engagement.description',
    icon: 'E',
    fields: [
      { path: 'engagement.type', type: 'text',
        labelKey: 'onboarding.fields.engagement.type',
        importance: 'medium', gapCategory: 'business' },
      { path: 'engagement.contract_type', type: 'text',
        labelKey: 'onboarding.fields.engagement.contract_type',
        importance: 'low', gapCategory: 'business' },
      { path: 'engagement.services', type: 'list',
        labelKey: 'onboarding.fields.engagement.services',
        importance: 'medium', gapCategory: 'business' },
      { path: 'preferences.communication_language', type: 'text',
        labelKey: 'onboarding.fields.engagement.communication_language',
        importance: 'low', gapCategory: 'business' },
      { path: 'preferences.report_frequency', type: 'text',
        labelKey: 'onboarding.fields.engagement.report_frequency',
        importance: 'low', gapCategory: 'business' },
      { path: 'preferences.preferred_contact', type: 'text',
        labelKey: 'onboarding.fields.engagement.preferred_contact',
        importance: 'low', gapCategory: 'business' },
    ],
  },
]

/** Flat array of all ONBOARDING_SECTIONS field paths, useful for
 *  validating incoming PATCH bodies. */
export const ALL_ONBOARDING_FIELD_PATHS: string[] =
  ONBOARDING_SECTIONS.flatMap(s => s.fields.map(f => f.path))

/** Look up a field definition by its dotted path. */
export function findFieldByPath(path: string): OnboardingField | undefined {
  for (const s of ONBOARDING_SECTIONS) {
    for (const f of s.fields) {
      if (f.path === path) return f
    }
  }
  return undefined
}

/** Look up a section by id. */
export function findSectionById(id: string): OnboardingSection | undefined {
  return ONBOARDING_SECTIONS.find(s => s.id === id)
}
