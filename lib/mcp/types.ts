/**
 * MCP connector — shared contract between the protocol layer (jsonrpc.ts,
 * app/api/mcp/route.ts) and the tool registry (lib/mcp/tools/*).
 *
 * A tool is a thin, typed wrapper. It NEVER talks to the database with
 * elevated rights on behalf of the caller: reads and writes go through the
 * existing /api/v4 route handlers (lib/mcp/call-route.ts), which authenticate
 * with the caller's own OAuth bearer token, so RLS and every existing guard
 * apply exactly as in the web app.
 */

export interface McpToolContext {
  /** Authenticated user (already verified against Supabase Auth). */
  userId: string
  email: string | null
  /** Public origin of this deployment, e.g. https://jboost-analyzer.vercel.app */
  origin: string
}

export interface McpToolResultText {
  /** Serializable payload; the protocol layer renders it as compact JSON text. */
  data: unknown
  /** True = the tool ran but the operation failed (MCP isError). */
  isError?: boolean
}

export interface McpTool {
  /** snake_case, stable: clients cache it. */
  name: string
  /** Human title shown in the Claude tool list. */
  title: string
  /** What it does, when to use it, what it costs. Written for the model. */
  description: string
  /** JSON Schema (draft 2020-12 subset) of the arguments object. */
  inputSchema: Record<string, unknown>
  /** true = read only (MCP readOnlyHint); false = changes data or spends API units. */
  readOnly: boolean
  /** Run the tool. Validate `args` with zod inside; throw McpToolError for user-facing failures. */
  run(args: unknown, ctx: McpToolContext): Promise<McpToolResultText>
  /** Audit this tool call carries (for the usage log); extracted from args. */
  analysisIdOf?(args: unknown): string | null
}

/** A failure the model should see as a normal tool error, not a protocol error. */
export class McpToolError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message)
    this.name = 'McpToolError'
  }
}
