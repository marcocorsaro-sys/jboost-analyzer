export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { driverAgent, type DriverTurn, type DriverVerdict, MAX_AGENT_TURNS } from '@/lib/analyses/driver-agent';
import { DRIVERS } from '@/lib/constants';

// POST /api/analyses/[id]/driver/[name]/answer
//
// Body: { answers: Record<string, string> }
//
// 1. Merges answers into analyses.user_clarifications (global, for prompts).
// 2. Appends a 'user' turn to driver_results.agent_verdict.turns.
// 3. If the conversation hasn't hit MAX_AGENT_TURNS, calls driverAgent
//    again with the full history. New observations + (maybe) new
//    questions are produced, and the resulting agent turn is appended.
// 4. Replaces agent_verdict with the new state (observations/questions
//    reflect the latest turn).

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

  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v && typeof v === 'string' && v.trim()) trimmed[k] = v.trim();
  }
  if (Object.keys(trimmed).length === 0) {
    return NextResponse.json({ error: 'no non-empty answers' }, { status: 400 });
  }

  // RLS gates access. We need user_clarifications + analysis context fields
  // so we can re-invoke the driver agent.
  const { data: analysis, error: fetchErr } = await supabase
    .from('analyses')
    .select('id, domain, country, language, target_topic, competitors, user_clarifications')
    .eq('id', analysisId)
    .single();
  if (fetchErr || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 });
  }

  // 1. Merge clarifications into the global analyses.user_clarifications map.
  const prior = (analysis.user_clarifications && typeof analysis.user_clarifications === 'object')
    ? analysis.user_clarifications as Record<string, string>
    : {};
  const mergedClarifications = { ...prior, ...trimmed };
  await supabase
    .from('analyses')
    .update({ user_clarifications: mergedClarifications })
    .eq('id', analysisId);

  // 2. Read the current driver row.
  const { data: driverRow } = await supabase
    .from('driver_results')
    .select('agent_verdict, score, status, issues, raw_data')
    .eq('analysis_id', analysisId)
    .eq('driver_name', driverName)
    .maybeSingle();
  if (!driverRow) {
    return NextResponse.json({ error: 'driver row not found' }, { status: 404 });
  }

  const verdict: DriverVerdict =
    (driverRow.agent_verdict && typeof driverRow.agent_verdict === 'object')
      ? driverRow.agent_verdict as DriverVerdict
      : { observations: [], questions: [], needs_dialogue: false };

  const turns: DriverTurn[] = Array.isArray(verdict.turns) ? [...verdict.turns] : [];
  const agentTurnsSoFar = turns.filter(t => t.role === 'agent').length;
  const userTurnsSoFar = turns.filter(t => t.role === 'user').length;

  // 3. Append the user's turn.
  turns.push({
    role: 'user',
    content: Object.entries(trimmed).map(([k, v]) => `${k}=${v}`).join('\n'),
    turn_idx: userTurnsSoFar + 1,
    timestamp: new Date().toISOString(),
  });

  // 4. If we still have agent budget AND the user actually answered open
  //    questions, call the driver agent again with the full history.
  let nextVerdict: DriverVerdict = verdict;
  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const driverMeta = DRIVERS.find(d => d.key === driverName);

  if (agentTurnsSoFar < MAX_AGENT_TURNS && anthropicKey && driverMeta) {
    const issues = Array.isArray(driverRow.issues) ? driverRow.issues : [];
    const newVerdict = await driverAgent({
      driverName,
      driverLabel: driverMeta.label,
      driverDescription: driverMeta.description,
      score: driverRow.score,
      status: driverRow.status,
      issues,
      rawData: (driverRow.raw_data as Record<string, unknown>) ?? {},
      context: {
        domain: analysis.domain,
        country: analysis.country || 'us',
        language: analysis.language || 'en',
        targetTopic: analysis.target_topic || undefined,
        competitors: (analysis.competitors as string[]) || [],
        priorClarifications: mergedClarifications,
      },
      anthropicKey,
      priorTurns: turns,
    });

    turns.push({
      role: 'agent',
      content: JSON.stringify({
        observations: newVerdict.observations,
        questions: newVerdict.questions,
      }),
      turn_idx: agentTurnsSoFar + 1,
      timestamp: new Date().toISOString(),
    });

    nextVerdict = {
      ...newVerdict,
      turns,
      answered_at: new Date().toISOString(),
    };
  } else {
    // Budget exhausted or no key: lock the conversation as-is.
    nextVerdict = {
      ...verdict,
      turns,
      questions: [],
      needs_dialogue: false,
      locked: true,
      answered_at: new Date().toISOString(),
    };
  }

  const { error: updErr } = await supabase
    .from('driver_results')
    .update({ agent_verdict: nextVerdict })
    .eq('analysis_id', analysisId)
    .eq('driver_name', driverName);
  if (updErr) {
    return NextResponse.json(
      { error: 'failed to persist verdict', details: updErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: 'saved',
    analysisId,
    driverName,
    turn_count: nextVerdict.turn_count ?? agentTurnsSoFar,
    locked: nextVerdict.locked ?? false,
    has_more_questions: (nextVerdict.questions?.length ?? 0) > 0,
  });
}
