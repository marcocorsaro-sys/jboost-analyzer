export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel Pro: up to 300s

import { NextResponse, unstable_after as after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { runAnalysis } from '@/lib/analyses/run-analysis';

const Body = z.object({ analysisId: z.string().uuid() });

export async function POST(request: Request) {
  // 1. AuthZ: caller must be authenticated and have access to this analysis
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse + validate
  let parsed;
  try { parsed = Body.parse(await request.json()); }
  catch (e: any) { return NextResponse.json({ error: 'invalid body', details: String(e?.message ?? e) }, { status: 400 }); }
  const { analysisId } = parsed;

  // 3. AuthZ#2: verify the user owns this analysis (or has client access to it)
  //    We rely on RLS via the user-scoped supabase client: if SELECT fails,
  //    the user has no access.
  const { data: analysis, error: fetchErr } = await supabase
    .from('analyses')
    .select('id, status, client_id, user_id')
    .eq('id', analysisId)
    .single();
  if (fetchErr || !analysis) {
    return NextResponse.json({ error: 'analysis not found or no access' }, { status: 404 });
  }

  // 4. Idempotency: if already completed or failed, refuse re-run.
  if (analysis.status === 'completed' || analysis.status === 'failed') {
    return NextResponse.json({
      error: `analysis already ${analysis.status}`,
      analysisId,
      status: analysis.status,
    }, { status: 409 });
  }

  // 5. Schedule the orchestration in background and return 202 immediately.
  //    next/after() guarantees the work runs after the response is sent,
  //    bounded by maxDuration of this route (300s).
  after(async () => {
    try {
      const result = await runAnalysis(analysisId);
      console.log(`[api/analyses/run] runtime=${result.runtime_ms}ms success=${result.success}`);
    } catch (err) {
      // runAnalysis already marks the row failed — this is just defense in depth.
      console.error('[api/analyses/run] unexpected throw:', err);
    }
  });

  return NextResponse.json({ status: 'accepted', analysisId }, { status: 202 });
}
