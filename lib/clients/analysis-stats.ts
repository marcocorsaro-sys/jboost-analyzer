/**
 * Client card analysis stats (count, latest score, previous score, date).
 *
 * Bug (Giulia 29/10): the counter on the client card only knew V1 analyses
 * (`analyses.status = 'completed'`). V4 audits never reach that status (they
 * stay 'pending' — their state lives in driver_runs/edits), so a client whose
 * audits are all V4 showed 0 / a stale number that did not match the audits
 * overview. The card now folds the client's V4 audits (listV4Audits, the SAME
 * source as /audits, so the two can never disagree) in with the V1 completed
 * ones.
 */

export interface ClientAnalysisItem {
  /** Overall score 0-100, null while nothing has been scored. */
  score: number | null
  /** ISO date of the analysis (completion for V1, creation for V4). */
  at: string | null
}

export interface ClientAnalysisStats {
  count: number
  latest_score: number | null
  previous_score: number | null
  latest_analysis_at: string | null
}

export function summarizeClientAnalyses(items: ClientAnalysisItem[]): ClientAnalysisStats | null {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return {
    count: sorted.length,
    latest_score: sorted[0].score ?? null,
    previous_score: sorted[1]?.score ?? null,
    latest_analysis_at: sorted[0].at ?? null,
  }
}

/** Group V1-completed rows and started V4 audits by client and summarize. */
export function buildClientStats(
  v1: Array<{ client_id: string; overall_score: number | null; completed_at: string | null }>,
  v4: Array<{ clientId: string | null; overallScore: number | null; createdAt: string; started: boolean }>,
): Map<string, ClientAnalysisStats> {
  const byClient = new Map<string, ClientAnalysisItem[]>()
  const push = (id: string, item: ClientAnalysisItem) => {
    const list = byClient.get(id) ?? []
    list.push(item)
    byClient.set(id, list)
  }
  for (const a of v1) push(a.client_id, { score: a.overall_score ?? null, at: a.completed_at })
  // A setup saved as draft and never launched is not an analysis yet.
  for (const a of v4) if (a.clientId && a.started) push(a.clientId, { score: a.overallScore, at: a.createdAt })

  const out = new Map<string, ClientAnalysisStats>()
  for (const [id, items] of byClient) {
    const s = summarizeClientAnalyses(items)
    if (s) out.set(id, s)
  }
  return out
}
