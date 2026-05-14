export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// POST /api/analyses/[id]/driver/[name]/answer
//
// Body: { answers: Record<string, string> }
//
// Merges the user's answers into analyses.user_clarifications (so they're
// available to future LLM calls) and resets agent_verdict.needs_dialogue
// on the targeted driver_results row so the UI updates after submission.
//
// This endpoint does NOT trigger a re-run. If the user wants to re-evaluate
// the analysis with the new context, they can launch a new analysis or
// hit the PR3 resume flow with decision='rerun' on a paused phase.

const Body = z.object({
  answers: z.record(z.string()),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; name: string }> },
) {
  const { id: analysisId, name: driverName } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(analysisId)) {
    return NextResponse.json({ error: 'invalid analysis id' }, { status: 400 });
  }
  if (!/^[a-z0-9_]{1,64}$/i.test(driverName)) {
    return NextResponse.json({ error: 'invalid driver name' }, { status: 400 });
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
  const { answers } = parsed;

  // RLS gates access.
  const { data: analysis, error: fetchErr } = await supabase
    .from('analyses')
    .select('id, user_clarifications')
    .eq('id', analysisId)
    .single();
  if (fetchErr || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 });
  }

  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v && typeof v === 'string' && v.trim()) trimmed[k] = v.trim();
  }
  if (Object.keys(trimmed).length === 0) {
    return NextResponse.json({ error: 'no non-empty answers' }, { status: 400 });
  }

  const prior = (analysis.user_clarifications && typeof analysis.user_clarifications === 'object')
    ? analysis.user_clarifications as Record<string, string>
    : {};
  const merged = { ...prior, ...trimmed };

  const { error: clarErr } = await supabase
    .from('analyses')
    .update({ user_clarifications: merged })
    .eq('id', analysisId);
  if (clarErr) {
    return NextResponse.json(
      { error: 'failed to persist clarifications', details: clarErr.message },
      { status: 500 },
    );
  }

  // Mark this driver's questions as answered so the UI stops showing them.
  const { data: driverRow, error: drvFetchErr } = await supabase
    .from('driver_results')
    .select('agent_verdict')
    .eq('analysis_id', analysisId)
    .eq('driver_name', driverName)
    .maybeSingle();
  if (!drvFetchErr && driverRow) {
    const verdict = (driverRow.agent_verdict && typeof driverRow.agent_verdict === 'object')
      ? driverRow.agent_verdict as Record<string, unknown>
      : {};
    const nextVerdict = {
      ...verdict,
      needs_dialogue: false,
      questions: [],
      answered_at: new Date().toISOString(),
    };
    await supabase
      .from('driver_results')
      .update({ agent_verdict: nextVerdict })
      .eq('analysis_id', analysisId)
      .eq('driver_name', driverName);
  }

  return NextResponse.json({
    status: 'saved',
    analysisId,
    driverName,
    clarifications_count: Object.keys(merged).length,
  });
}
