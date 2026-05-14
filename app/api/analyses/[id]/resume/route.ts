export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { runAnalysis } from '@/lib/analyses/run-analysis';

const Body = z.object({
  decision: z.enum(['continue', 'stop']),
  // Map of question id -> user's answer (free text). Merged into
  // analyses.user_clarifications so the next phase's prompts can use it.
  answers: z.record(z.string()).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(analysisId)) {
    return NextResponse.json({ error: 'invalid analysis id' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let parsed;
  try { parsed = Body.parse(await request.json()); }
  catch (e: any) {
    return NextResponse.json({ error: 'invalid body', details: String(e?.message ?? e) }, { status: 400 });
  }
  const { decision, answers } = parsed;

  // RLS gates access: if the user can't SELECT the row, they can't resume it.
  const { data: analysis, error: fetchErr } = await supabase
    .from('analyses')
    .select('id, status, paused_at_phase, user_clarifications')
    .eq('id', analysisId)
    .single();
  if (fetchErr || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 });
  }

  if (analysis.status !== 'paused') {
    return NextResponse.json(
      { error: `analysis is not paused (status=${analysis.status})` },
      { status: 409 },
    );
  }

  const pausedPhase = analysis.paused_at_phase as string | null;
  if (!pausedPhase) {
    return NextResponse.json(
      { error: 'analysis has no paused_at_phase recorded' },
      { status: 409 },
    );
  }

  // Mark the checkpoint with the user's decision. RLS policy
  // checkpoints_update_decision allows owners + client members.
  const { error: ckptErr } = await supabase
    .from('analysis_checkpoints')
    .update({ user_decision: decision, decided_at: new Date().toISOString() })
    .eq('analysis_id', analysisId)
    .eq('phase', pausedPhase);
  if (ckptErr) {
    return NextResponse.json(
      { error: 'failed to record decision', details: ckptErr.message },
      { status: 500 },
    );
  }

  // Merge any user-provided answers into analyses.user_clarifications so
  // downstream phases' prompts can pick them up. We merge rather than
  // replace so answers accumulate across multiple paused checkpoints.
  if (answers && Object.keys(answers).length > 0) {
    const prior = (analysis.user_clarifications && typeof analysis.user_clarifications === 'object')
      ? analysis.user_clarifications as Record<string, string>
      : {};
    const merged = { ...prior, ...answers };
    const { error: clarErr } = await supabase
      .from('analyses')
      .update({ user_clarifications: merged })
      .eq('id', analysisId);
    if (clarErr) {
      console.warn('[resume] failed to persist clarifications:', clarErr.message);
      // Soft fail — the analysis can still resume without the answers.
    }
  }

  if (decision === 'stop') {
    await supabase.from('analyses').update({
      status: 'failed',
      error_message: `Stopped by user after phase: ${pausedPhase}`,
      current_phase: 'stopped',
      completed_at: new Date().toISOString(),
    }).eq('id', analysisId);
    return NextResponse.json({ status: 'stopped', analysisId }, { status: 200 });
  }

  // decision === 'continue': fire-and-forget runAnalysis. It will pick up
  // paused_at_phase from the DB row, clear it, and resume from the next phase.
  void runAnalysis(analysisId)
    .then((result) => {
      console.log(`[api/analyses/resume] runtime=${result.runtime_ms}ms success=${result.success}`);
    })
    .catch((err) => {
      console.error('[api/analyses/resume] unexpected throw:', err);
    });

  return NextResponse.json({ status: 'resumed', analysisId, from_phase: pausedPhase }, { status: 202 });
}
