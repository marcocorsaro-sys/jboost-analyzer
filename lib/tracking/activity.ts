import { createClient } from '@/lib/supabase/server'

export interface LogActivityParams {
  userId: string
  action: string
  resourceType?: string | null
  resourceId?: string | null
  details?: Record<string, unknown> | null
  ipAddress?: string | null
}

/**
 * Log user activity. Non-blocking — never throws.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const supabase = await createClient()

    await supabase.from('activity_logs').insert({
      user_id: params.userId,
      action: params.action,
      resource_type: params.resourceType || null,
      resource_id: params.resourceId || null,
      details: params.details || null,
      ip_address: params.ipAddress || null,
    })
  } catch (err) {
    console.error('[logActivity] Failed:', err)
  }
}
