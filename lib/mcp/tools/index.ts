/**
 * MCP tool registry. The protocol layer (app/api/mcp/route.ts) lists and
 * dispatches from here; nothing else needs to know which file a tool lives in.
 */

import { McpToolError, type McpTool } from '@/lib/mcp/types'
import { READ_TOOLS } from '@/lib/mcp/tools/read'
import { WRITE_TOOLS } from '@/lib/mcp/tools/write'
import { sources } from '@/lib/mcp/tools/routes'
import { isRecord, normalizeProjectCode } from '@/lib/mcp/tools/shared'

const CODE_HINT = ' Accepts the project code (e.g. JBA-0020, preferred: names can be ambiguous) or the UUID.'

/**
 * Every audit-scoped tool takes `audit_id` as a project code (JBA-0020) or as
 * the UUID. A code is resolved to the UUID here, through the caller's own
 * RLS-scoped client, before the tool runs — so the tools themselves keep one
 * strict contract (a UUID) and a code that is not visible to the user fails
 * like any other unknown audit.
 */
export function withProjectCode(tool: McpTool): McpTool {
  const props = tool.inputSchema.properties
  if (!isRecord(props) || !isRecord(props.audit_id)) return tool
  const { format: _format, ...auditProp } = props.audit_id as Record<string, unknown>
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...props,
        audit_id: {
          ...auditProp,
          description: `${String(auditProp.description ?? 'Audit id.').replace(/\.$/, '')}.${CODE_HINT}`,
        },
      },
    },
    async run(args, ctx) {
      const code = isRecord(args) ? normalizeProjectCode(args.audit_id) : null
      if (!code) return tool.run(args, ctx)
      const id = await sources.auditIdByCode(code)
      if (!id) {
        throw new McpToolError(`No audit with project code ${code} is visible to you (use list_audits to see the codes).`)
      }
      return tool.run({ ...(args as Record<string, unknown>), audit_id: id }, ctx)
    },
  }
}

/** Read tools first, then writes: the order clients show them in. */
export const MCP_TOOLS: McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS].map(withProjectCode)

const BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]))

export function getMcpTool(name: string): McpTool | undefined {
  return BY_NAME.get(name)
}
