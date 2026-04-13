// ============================================================
// JBoost v2 — Client & related types
// ============================================================

/**
 * Lifecycle stage of a client in the engagement pipeline.
 * - prospect:  pre-sales, not yet engaged
 * - active:    active engagement (monitored, billable)
 * - churned:   engagement ended
 * - archived:  historical / not visible by default
 */
export type ClientLifecycleStage = 'prospect' | 'active' | 'churned' | 'archived'

export interface Client {
  id: string
  user_id: string
  name: string
  domain: string | null
  industry: string | null
  website_url: string | null
  logo_url: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  status: 'active' | 'archived'
  lifecycle_stage: ClientLifecycleStage
  engagement_started_at: string | null
  engagement_ended_at: string | null
  pre_sales_notes: string | null
  created_at: string
  updated_at: string
}

export interface ClientCreateInput {
  name: string
  domain?: string
  industry?: string
  website_url?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  notes?: string
  lifecycle_stage?: ClientLifecycleStage
  pre_sales_notes?: string | null
}

export interface ClientUpdateInput extends Partial<ClientCreateInput> {
  status?: 'active' | 'archived'
  lifecycle_stage?: ClientLifecycleStage
  engagement_started_at?: string | null
  engagement_ended_at?: string | null
  pre_sales_notes?: string | null
}

// MarTech Stack
export type MartechCategory =
  | 'cms'
  | 'cdn'
  | 'analytics'
  | 'marketing_automation'
  | 'tag_manager'
  | 'ab_testing'
  | 'personalization'
  | 'email_platform'
  | 'crm'
  | 'ad_platforms'
  | 'social'

export interface ClientMartech {
  id: string
  client_id: string
  category: MartechCategory
  tool_name: string
  tool_version: string | null
  confidence: number
  details: Record<string, unknown> | null
  detected_at: string
}

// Files
export interface ClientFile {
  id: string
  client_id: string
  user_id: string
  file_name: string
  file_type: string | null
  file_size: number | null
  storage_path: string
  description: string | null
  tags: string[] | null
  extracted_text: string | null
  extraction_status: 'pending' | 'completed' | 'failed' | 'unsupported' | null
  created_at: string
}

// Conversations
export interface Conversation {
  id: string
  user_id: string
  client_id: string | null
  title: string | null
  mode: 'contextual' | 'assistant'
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: Record<string, unknown> | null
  created_at: string
}

// API Keys
export interface ApiKey {
  id: string
  user_id: string
  name: string
  key_hash: string
  key_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
}

// ─── Client Memory ──────────────────────────────────────────

export interface MemoryProfile {
  company_name?: string
  domain?: string
  industry?: string
  description?: string
  founded?: string
  headquarters?: string
  key_products_services?: string[]
  target_audience?: string
  geographic_markets?: string[]
  team_contacts?: { name: string; role: string; email?: string }[]
  business_goals?: string[]
  budget_info?: string
  challenges?: string[]
  competitors?: string[]
  tools_platforms?: string[]
  engagement?: {
    type?: string
    started_at?: string
    contract_type?: string
    services?: string[]
  }
  preferences?: {
    communication_language?: string
    report_frequency?: string
    preferred_contact?: string
  }

  // ─── Phase 5D — Onboarding seed (all optional, backward-compatible) ───
  // Populated by the structured onboarding wizard + discovery chat.
  // These sections become the first authoritative "user_answer" source
  // for a new client, so the memory synthesizer has real context from
  // day 1 instead of waiting for SEO analyses / uploaded files to arrive.

  brand?: {
    legal_name?: string
    tagline?: string
    uvp?: string
    mission?: string
    values?: string[]
    voice?: string
    tone?: string
    do_not_say?: string[]
  }

  markets?: {
    primary_regions?: string[]
    secondary_regions?: string[]
    languages?: string[]
    b2b_b2c?: 'b2b' | 'b2c' | 'b2b2c' | 'mixed'
    icp?: string
    personas?: Array<{
      name: string
      description: string
      pain_points?: string[]
    }>
  }

  // Extended stakeholder directory. `team_contacts` stays for legacy
  // LLM-extracted contacts; `stakeholders` is the structured onboarding
  // version with department + decision-maker flags.
  stakeholders?: Array<{
    name: string
    role: string
    department?: 'c_level' | 'marketing' | 'content' | 'technical' | 'legal' | 'agency'
    email?: string
    phone?: string
    is_decision_maker?: boolean
    approval_scope?: string
  }>

  access?: {
    cms?: { platform?: string; credentials_location?: string }
    analytics?: { ga4_property_id?: string; gsc_verified?: boolean }
    seo_tools?: { semrush?: boolean; ahrefs?: boolean; notes?: string }
    asset_repos?: string[]
    brand_guidelines_url?: string
  }

  seo_foundation?: {
    maturity_level?: 'none' | 'basic' | 'intermediate' | 'advanced'
    priority_keywords?: string[]
    priority_topics?: string[]
    priority_pages?: string[]
    current_issues?: string[]
    historical_context?: string
  }

  // Generative Engine Optimization — visibility on ChatGPT, Perplexity,
  // Google AI Overviews, Gemini, Claude, Copilot. Paired with the
  // existing "AI Relevance" SEO driver.
  geo?: {
    target_engines?: Array<
      'chatgpt' | 'perplexity' | 'claude' | 'google_aio' | 'gemini' | 'copilot'
    >
    entity_status?: {
      wikipedia?: boolean
      knowledge_panel?: boolean
      llms_txt?: boolean
    }
    schema_maturity?: 'none' | 'basic' | 'advanced'
    eeat_signals?: string[]
    author_entities?: Array<{ name: string; credentials?: string }>
    current_mentions?: string
    geo_goals?: string[]
  }

  content_strategy?: {
    pillars?: string[]
    topic_clusters?: string[]
    editorial_calendar_url?: string
    formats?: string[]
    publishing_cadence?: string
    multilingual?: boolean
    distribution_channels?: string[]
    content_inventory_size?: string
  }

  goals_kpis?: {
    short_term?: string[]   // 90 days
    medium_term?: string[]  // 6 months
    long_term?: string[]    // 12 months+
    primary_kpi?: string
    baselines?: Record<string, string>
    success_criteria?: string
  }

  compliance?: {
    regulations?: string[]
    approval_workflow?: string
    embargo_topics?: string[]
    legal_review_required?: boolean
    trademark_notes?: string
  }

  onboarding?: {
    version: number
    status: 'not_started' | 'in_progress' | 'completed'
    completed_sections: string[]
    skipped_fields: string[]
    last_section?: string
    started_at?: string
    completed_at?: string
    discovery_chat_completed?: boolean
  }
}

export type MemoryFactCategory =
  | 'seo_performance'
  | 'business'
  | 'technical'
  | 'content'
  | 'competitor'
  | 'martech'
  | 'contact'
  | 'timeline'
  | 'budget'
  | 'preference'
  | 'conversation_insight'

export interface MemoryFact {
  id: string
  category: MemoryFactCategory
  fact: string
  source: 'analysis' | 'knowledge_file' | 'conversation' | 'executive_summary' | 'martech' | 'user_answer' | 'company_context'
  source_id?: string
  confidence: number
  extracted_at: string
}

export type MemoryGapImportance = 'high' | 'medium' | 'low'
export type MemoryGapCategory =
  | 'business'
  | 'team'
  | 'technical'
  | 'goals'
  | 'budget'
  | 'timeline'
  | 'competitor'
  | 'content_strategy'
  | 'tools'
  // Phase 5C: surfaced when two sources contradict each other on the same
  // topic. The gap question is "We saw X in source A and Y in source B —
  // which one is correct?", produced by the synthesizer when it detects
  // a conflict instead of silently picking a side.
  | 'conflict_resolution'
  // Phase 5D — Onboarding-driven gap categories. These surface when the
  // user skipped a field in the structured onboarding wizard or when the
  // synthesizer notices a missing piece inside one of the new profile
  // sections (brand voice, markets, stakeholder decision chain, tool
  // access, SEO baseline, Generative Engine Optimization targets,
  // regulatory constraints).
  | 'brand'
  | 'markets'
  | 'stakeholders'
  | 'access'
  | 'seo_foundation'
  | 'geo'
  | 'compliance'

export interface MemoryGap {
  id: string
  category: MemoryGapCategory
  question: string
  importance: MemoryGapImportance
  context: string
}

export interface MemoryAnswer {
  id: string
  gap_id: string
  question: string
  answer: string
  answered_at: string
  answered_by: string
}

export type ClientMemoryStatus =
  | 'empty'
  | 'building'
  | 'ready'
  | 'refreshing'
  // Phase 5A: a previously-ready memory whose data sources have changed
  // (new analysis completed, file uploaded/deleted, martech updated, ...).
  // The DB triggers in phase5a_client_memory.sql automatically transition
  // 'ready' rows to 'stale' when one of those sources changes.
  | 'stale'
  | 'failed'

export interface ClientMemory {
  id: string
  client_id: string
  profile: MemoryProfile
  facts: MemoryFact[]
  gaps: MemoryGap[]
  narrative: string | null
  answers: MemoryAnswer[]
  status: ClientMemoryStatus
  completeness: number
  source_versions: Record<string, unknown>
  error_message: string | null
  last_refreshed_at: string | null
  created_at: string
  updated_at: string
}

// Client with stats (for list views)
export interface ClientWithStats extends Client {
  analyses_count: number
  latest_score: number | null
  latest_analysis_at: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-tenant membership (Phase 4A)
// ─────────────────────────────────────────────────────────────────────────────

export type ClientMemberRole = 'owner' | 'editor' | 'viewer'

export interface ClientMember {
  id: string
  client_id: string
  user_id: string
  role: ClientMemberRole
  added_by: string | null
  added_at: string
}

export interface ClientMemberWithProfile extends ClientMember {
  full_name: string | null
  company: string | null
  email: string | null
}
