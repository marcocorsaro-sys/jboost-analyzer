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
  pre_sales_notes?: string
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

// Client with stats (for list views)
export interface ClientWithStats extends Client {
  analyses_count: number
  latest_score: number | null
  latest_analysis_at: string | null
}
