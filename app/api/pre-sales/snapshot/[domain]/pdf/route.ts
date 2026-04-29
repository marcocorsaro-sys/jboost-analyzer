/**
 * GET /api/pre-sales/snapshot/[domain]/pdf
 *
 * Genera al volo un report PDF executive del DomainSnapshot per il dominio
 * passato in route param e lo restituisce come download.
 *
 * Auth: caller deve essere loggato (cookie session Supabase). Service-role
 * client viene poi usato dall'orchestrator per scrivere su integration_call_log.
 *
 * Performance: l'orchestrator può prendere 10–40s; @react-pdf/renderer
 * il pdfStream è veloce (~1-2s). Settiamo maxDuration=90 per stare larghi.
 *
 * Nota: questo endpoint NON cacha lo snapshot a livello pagina. Per
 * generare PDF "fresh" sempre. Caching cross-call dei provider è già a
 * livello integration_cache (Phase 7E future-work).
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createUserClient } from '@/lib/supabase/server'
import { buildDomainSnapshot } from '@/lib/integrations/use-cases/pre-sales/domain-snapshot'
import { renderToStream } from '@react-pdf/renderer'
import { DomainSnapshotPdf } from '@/lib/pre-sales/pdf-template'
import { Readable } from 'node:stream'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function GET(
  _request: Request,
  { params }: { params: { domain: string } },
) {
  // 1. Auth gate
  const supabaseUser = await createUserClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Validate domain
  const domain = decodeURIComponent(params.domain).trim().toLowerCase()
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: 'invalid domain' }, { status: 400 })
  }

  // 3. Service-role client per orchestrator
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 })
  }
  const supabase = createServiceClient(SUPABASE_URL, SERVICE_KEY)

  // 4. Build snapshot (10–40s)
  const snapshot = await buildDomainSnapshot({
    supabase,
    domain,
    country: 'Italy',
    language: 'it',
    userId: user.id,
    deadlineMs: 60_000,
  })

  // 5. Render PDF in Node stream + convert to web ReadableStream for Response
  const pdfStream = await renderToStream(<DomainSnapshotPdf snapshot={snapshot} />)
  const webStream = nodeStreamToWeb(pdfStream as unknown as Readable)

  const filename = `jboost-snapshot-${domain.replace(/[^a-z0-9.-]/g, '_')}-${snapshot.startedAt.slice(0, 10)}.pdf`
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Node.js Readable → Web ReadableStream. @react-pdf/renderer ritorna un
 * Node stream classico; Next.js Response vuole un Web stream. Il helper
 * sotto fa il bridging senza dipendenze esterne.
 */
function nodeStreamToWeb(node: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      node.on('data', (chunk) => {
        const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk)
        controller.enqueue(new Uint8Array(buf))
      })
      node.on('end', () => controller.close())
      node.on('error', (err) => controller.error(err))
    },
    cancel() {
      node.destroy()
    },
  })
}
