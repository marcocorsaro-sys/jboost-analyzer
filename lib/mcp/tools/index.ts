/**
 * MCP tool registry. The protocol layer (app/api/mcp/route.ts) lists and
 * dispatches from here; nothing else needs to know which file a tool lives in.
 */

import type { McpTool } from '@/lib/mcp/types'
import { READ_TOOLS } from '@/lib/mcp/tools/read'
import { WRITE_TOOLS } from '@/lib/mcp/tools/write'

/** Read tools first, then writes: the order clients show them in. */
export const MCP_TOOLS: McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS]

const BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]))

export function getMcpTool(name: string): McpTool | undefined {
  return BY_NAME.get(name)
}
