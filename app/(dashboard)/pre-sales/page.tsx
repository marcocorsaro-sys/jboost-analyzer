import { redirect } from 'next/navigation'

/**
 * Pre-Sales workspace entry point.
 *
 * In Horizon 1 Stage 2 the pre-sales area became a tabbed workspace
 * (Pipeline / Pitch Generator / Benchmarks) so we redirect the naked
 * /pre-sales URL to the first tab. The actual prospect pipeline content
 * lives in /pre-sales/pipeline.
 */
export default function PreSalesIndexPage() {
  redirect('/pre-sales/pipeline')
}
