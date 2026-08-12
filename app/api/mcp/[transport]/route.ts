import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { registerTools } from '@/lib/mcp/tools'
import { verifySupabaseToken } from '@/lib/mcp/auth'

// The 9-driver orchestration can run long; match the analyses run ceiling.
export const runtime = 'nodejs'
export const maxDuration = 300

// Remote MCP server exposing JBoost Analyzer's capabilities as MCP tools.
// Transport: Streamable HTTP (SSE disabled — not part of the current spec).
const handler = createMcpHandler(
  (server) => {
    registerTools(server)
  },
  {
    serverInfo: { name: 'jboost-analyzer', version: '1.0.0' },
  },
  {
    basePath: '/api/mcp',
    maxDuration: 300,
    verboseLogs: false,
    disableSse: true,
  }
)

// Every request must carry a valid Supabase JWT as a bearer token. The token
// is forwarded to each tool so the whole chain runs under the caller's
// identity, with Supabase RLS enforced — no service-role escalation.
const authHandler = withMcpAuth(handler, verifySupabaseToken, { required: true })

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
