import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Monitoring run helper (Phase 4C).
 *
 * Triggers a single monitoring scan for one client by reusing the existing
 * analyses pipeline + run-analysis edge function. The new analyses row is
 * tagged with source='monitoring' so it can be distinguished from a manual
 * UI-driven run.
 *
 * Behaviour:
 *   1. Look up the most recent completed manual analysis for this client to
 *      reuse its config (domain, country, language, target_topic, competitors).
 *      Falls back to the client's own domain + 'IT'/'it' defaults.
 *   2. Insert the new analyses row with status='running', source='monitoring'.
 *   3. Fire-and-forget invoke of the run-analysis edge function. We don't
 *      await completion — the function runs async on Supabase and the trend
 *      chart picks up the result via the existing realtime subscription path.
 *   4. Update the subscription's last_run_at + recompute next_run_at via the
 *      compute_next_run_at SQL function.
 *
 * Returns the new analyses.id on success, or null + an error string on failure.
 */
export interface RunMonitoringResult {
  analysisId: string | null
  error: string | null
}

export async function runMonitoringForClient(
  supabase: SupabaseClient,
  clientId: string
): Promise<RunMonitoringResult> {
  // 1. Load the client and its current subscription in parallel.
  const [{ data: client, error: clientError }, { data: subscription }] =
    await Promise.all([
      supabase
        .from('clients')
        .select('id, user_id, domain, lifecycle_stage')
        .eq('id', clientId)
        .single(),
      supabase
        .from('client_update_subscriptions')
        .select('frequency, frequency_days, is_active, paused_until')
        .eq('client_id', clientId)
        .maybeSingle(),
    ])

  if (clientError || !client) {
    return { analysisId: null, error: clientError?.message || 'Client not found' }
  }
  if (!client.domain) {
    return { analysisId: null, error: 'Client has no domain configured' }
  }

  // 2. Reuse the most recent successful analysis as the config template.
  const { data: lastAnalysis } = await supabase
    .from('analyses')
    .select('domain, country, language, target_topic, competitors')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const config = {
    domain: lastAnalysis?.domain || client.domain,
    country: lastAnalysis?.country || 'IT',
    language: lastAnalysis?.language || 'it',
    target_topic: lastAnalysis?.target_topic ?? null,
    competitors: lastAnalysis?.competitors ?? [],
  }

  // 3. Insert the new analyses row tagged as monitoring.
  const { data: analysis, error: insertError } = await supabase
    .from('analyses')
    .insert({
      user_id: client.user_id,
      client_id: clientId,
      domain: config.domain,
      country: config.country,
      language: config.language,
      target_topic: config.target_topic,
      competitors: config.competitors,
      status: 'running',
      source: 'monitoring',
    })
    .select('id')
    .single()

  if (insertError || !analysis) {
    return {
      analysisId: null,
      error: insertError?.message || 'Failed to insert analyses row',
    }
  }

  // 4. Fire-and-forget trigger of the analysis run. Two paths gated by the
  // USE_NEXT_RUN_ANALYSIS env flag during the Phase 7 migration:
  //   - true  → in-process import of lib/analyses/run-analysis (Next.js Node)
  //   - false → legacy Supabase edge function (default)
  // Either way the orchestrator only bookkeeps last_run_at / next_run_at and
  // does not block on completion.
  if (process.env.USE_NEXT_RUN_ANALYSIS === 'true') {
    // Dynamic import keeps the 880-line orchestrator out of the cold-start
    // bundle when the flag is off. Same DB writes as the edge function plus
    // the Phase 7 race-fix on the global catch.
    import('@/lib/analyses/run-analysis')
      .then(mod => mod.runAnalysis(analysis.id))
      .catch(err => {
        console.error('[monitoring] runAnalysis (next route) failed', clientId, err)
      })
  } else {
    supabase.functions
      .invoke('run-analysis', { body: { analysisId: analysis.id } })
      .catch(err => {
        console.error('[monitoring] edge function invoke failed', clientId, err)
      })
  }

  // 5. Bookkeeping: stamp last_run_at and bump next_run_at via the SQL helper.
  const nowIso = new Date().toISOString()
  const { data: nextRunRpc } = await supabase.rpc('compute_next_run_at', {
    p_anchor: nowIso,
    p_frequency: subscription?.frequency || 'weekly',
    p_frequency_days: subscription?.frequency_days ?? null,
  })

  await supabase
    .from('client_update_subscriptions')
    .update({
      last_run_at: nowIso,
      next_run_at: nextRunRpc ?? nowIso,
    })
    .eq('client_id', clientId)

  return { analysisId: analysis.id, error: null }
}
