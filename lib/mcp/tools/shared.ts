/**
 * MCP tools — shared helpers: argument validation, in-process route calls and
 * the trimming that keeps tool answers small enough for an LLM context.
 */

import { z } from 'zod'
import { callRoute, expectOk, type CallRouteOptions, type RouteResult } from '@/lib/mcp/call-route'
import { McpToolError, type McpToolContext } from '@/lib/mcp/types'
import { V4_DRIVERS } from '@/lib/scoring/registry'
import type { RouteLoader } from '@/lib/mcp/tools/routes'

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

export const DRIVER_KEYS = V4_DRIVERS.map((d) => d.key) as [string, ...string[]]

/** The audit id every audit-scoped tool takes. */
export const auditIdSchema = z
  .string({
    required_error: 'audit_id is required (use list_audits to find it)',
    invalid_type_error: 'audit_id must be a string UUID',
  })
  .uuid('audit_id must be a UUID such as 3f1c2b4e-8a6d-4c1e-9b7f-0a1b2c3d4e5f (use list_audits to find it)')

export const driverKeySchema = z.enum(DRIVER_KEYS, {
  errorMap: () => ({ message: `driver must be one of: ${DRIVER_KEYS.join(', ')}` }),
})

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path && !issue.message.startsWith(path) ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/** Validate tool arguments; the model gets a precise, actionable message. */
export function parseArgs<S extends z.ZodTypeAny>(schema: S, args: unknown, tool: string): z.output<S> {
  const parsed = schema.safeParse(args ?? {})
  if (!parsed.success) {
    throw new McpToolError(`Invalid arguments for ${tool}: ${formatZodIssues(parsed.error)}`, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `analysisIdOf` for every tool whose args carry audit_id. */
export function auditIdOfArgs(args: unknown): string | null {
  return isRecord(args) && typeof args.audit_id === 'string' ? args.audit_id : null
}

// ---------------------------------------------------------------------------
// In-process route calls
// ---------------------------------------------------------------------------

type CallOptions = Omit<CallRouteOptions, 'origin'>

/** Call a route and return the raw result (the caller inspects the status). */
export async function invokeRaw(
  ctx: McpToolContext,
  loader: RouteLoader,
  options: CallOptions,
): Promise<RouteResult> {
  const handler = await loader()
  return callRoute(handler, { ...options, origin: ctx.origin })
}

/** Call a route; a non-2xx answer becomes an McpToolError carrying the route's reason. */
export async function invoke(
  ctx: McpToolContext,
  loader: RouteLoader,
  options: CallOptions,
  label: string,
): Promise<unknown> {
  return expectOk(await invokeRaw(ctx, loader, options), label)
}

/** Same as invoke, but insists on a JSON object body. */
export async function invokeObject(
  ctx: McpToolContext,
  loader: RouteLoader,
  options: CallOptions,
  label: string,
): Promise<Record<string, unknown>> {
  const json = await invoke(ctx, loader, options, label)
  if (!isRecord(json)) {
    throw new McpToolError(`${label}: unexpected answer from the route (not a JSON object)`)
  }
  return json
}

export function auditPath(auditId: string, suffix = ''): string {
  return `/api/v4/analyses/${auditId}${suffix}`
}

// ---------------------------------------------------------------------------
// Compact answers
// ---------------------------------------------------------------------------

export interface TrimOptions {
  /** Longest string kept, in characters. */
  maxString: number
  /** Most array items kept. */
  maxArray: number
  /** Deepest object nesting kept. */
  maxDepth: number
  /** Most keys kept per object. */
  maxKeys: number
}

export const EVIDENCE_TRIM: TrimOptions = { maxString: 240, maxArray: 8, maxDepth: 3, maxKeys: 20 }
export const TEXT_TRIM: TrimOptions = { maxString: 1500, maxArray: 12, maxDepth: 5, maxKeys: 30 }
export const DECISION_TRIM: TrimOptions = { maxString: 4000, maxArray: 20, maxDepth: 4, maxKeys: 20 }

/** Shorten a string, saying how much was dropped. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text
}

/**
 * Deep-trim an arbitrary JSON value. Returns the trimmed copy and whether
 * anything was cut, so the caller can set `truncated: true` and add a hint.
 */
export function trimJson(value: unknown, options: TrimOptions): { value: unknown; truncated: boolean } {
  let truncated = false

  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === 'string') {
      if (node.length > options.maxString) truncated = true
      return clip(node, options.maxString)
    }
    if (Array.isArray(node)) {
      if (depth >= options.maxDepth) {
        truncated = true
        return `[array of ${node.length} items omitted]`
      }
      const kept = node.slice(0, options.maxArray).map((item) => walk(item, depth + 1))
      if (node.length > options.maxArray) {
        truncated = true
        kept.push(`… +${node.length - options.maxArray} more items`)
      }
      return kept
    }
    if (isRecord(node)) {
      if (depth >= options.maxDepth) {
        truncated = true
        return '[object omitted]'
      }
      const entries = Object.entries(node)
      const out: Record<string, unknown> = {}
      for (const [key, item] of entries.slice(0, options.maxKeys)) out[key] = walk(item, depth + 1)
      if (entries.length > options.maxKeys) {
        truncated = true
        out._omittedKeys = entries.length - options.maxKeys
      }
      return out
    }
    return node
  }

  const result = walk(value, 0)
  return { value: result, truncated }
}

/** Cap a list and report the cut. */
export function capList<T>(items: T[], max: number): { items: T[]; total: number; truncated: boolean } {
  return { items: items.slice(0, max), total: items.length, truncated: items.length > max }
}

/** Drop null / undefined / empty-array keys so optional noise does not reach the model. */
export function omitEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    ;(out as Record<string, unknown>)[key] = value
  }
  return out
}

export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
