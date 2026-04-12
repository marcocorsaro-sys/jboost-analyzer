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

export type ClientMemoryStatus = 'empty' | 'building' | 'ready' | 'refreshing' | 'failed'

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
