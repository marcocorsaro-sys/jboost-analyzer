/**
 * V4 LLM — deterministic JSON repair (Sprint 1, review 2.1).
 *
 * The real failure this fixes: driver-insight responses truncated mid-array
 * ("unparsable JSON after 3 attempts ... position 5099" on Content and
 * Awareness). A truncated response is not garbage, it is a valid prefix of a
 * valid document: closing the open strings/arrays/objects and dropping the
 * incomplete tail recovers everything the model DID finish writing.
 *
 * Pure module, no I/O, no LLM: the orchestrator calls repairJson between
 * retries, so a repairable truncation costs zero extra tokens.
 *
 * What it handles, in order:
 *  1. extraction of the JSON block from surrounding prose / code fences
 *     (take from the first '{'; trailing garbage after the balanced end is
 *     dropped by the scanner itself);
 *  2. truncation inside a string, after a comma, after a key, inside a
 *     number/boolean/null literal: the incomplete tail is cut back to the
 *     last COMPLETE value and every still-open scope is closed;
 *  3. trailing commas left by the cut.
 *
 * What it refuses: input with no '{' at all, or input whose repaired form
 * still does not parse. The caller falls back to its own retry/degraded path.
 */

export interface RepairResult {
  /** The parsed object, or null when no repair produced valid JSON. */
  value: Record<string, unknown> | null
  /** True when the value came from a repair (not a clean parse). */
  repaired: boolean
  error: string | null
}

/** A point in the scan where a value has just been completed. */
interface SafePoint {
  /** Slice end (exclusive) of the candidate prefix. */
  index: number
  /** Open scopes at that point, outermost first ('{' / '['). */
  stack: string[]
}

/**
 * Repair a (possibly truncated) LLM response into a parsed JSON object.
 * Deterministic and side-effect free.
 */
export function repairJson(text: string): RepairResult {
  const start = text.indexOf('{')
  if (start < 0) {
    return { value: null, repaired: false, error: 'the response contains no JSON object' }
  }
  const s = text.slice(start)

  // Fast path: the block (up to the last '}') parses as-is.
  const lastBrace = s.lastIndexOf('}')
  if (lastBrace > 0) {
    const clean = tryParseObject(s.slice(0, lastBrace + 1))
    if (clean) return { value: clean, repaired: false, error: null }
  }

  // Scan, tracking open scopes and the last point where a value completed.
  const stack: string[] = []
  let inString = false
  let escaped = false
  const safePoints: SafePoint[] = []
  let balancedEnd = -1

  const markSafe = (endExclusive: number) => {
    safePoints.push({ index: endExclusive, stack: [...stack] })
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
        // A closing quote completes a value ONLY if the string is not a key:
        // peek at the next non-whitespace char; ':' means it was a key.
        const next = nextNonWs(s, i + 1)
        if (next !== ':') markSafe(i + 1)
      }
      continue
    }

    switch (ch) {
      case '"':
        inString = true
        escaped = false
        break
      case '{':
      case '[':
        stack.push(ch)
        break
      case '}':
      case ']': {
        const opener = stack.pop()
        // Mismatched closer: cut here, the tail is garbage.
        if ((ch === '}' && opener !== '{') || (ch === ']' && opener !== '[')) {
          return finishFromSafePoints(s, safePoints)
        }
        markSafe(i + 1)
        if (stack.length === 0) {
          balancedEnd = i + 1
          i = s.length // stop: anything after the balanced end is garbage
        }
        break
      }
      default: {
        // Number / true / false / null literals: safe once followed by a
        // delimiter (so a truncated "tru" or "12." never counts).
        if (/[-0-9tfn]/.test(ch)) {
          const m = s.slice(i).match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/)
          if (m) {
            const end = i + m[0].length
            if (end < s.length && /[\s,\]}]/.test(s[end])) markSafe(end)
            i = end - 1
          }
        }
        break
      }
    }
  }

  if (balancedEnd > 0) {
    const parsed = tryParseObject(s.slice(0, balancedEnd))
    if (parsed) return { value: parsed, repaired: true, error: null }
  }

  return finishFromSafePoints(s, safePoints)
}

/** Cut to the last complete value and close every open scope. */
function finishFromSafePoints(s: string, safePoints: SafePoint[]): RepairResult {
  for (let p = safePoints.length - 1; p >= 0; p--) {
    const point = safePoints[p]
    let candidate = s.slice(0, point.index).replace(/[\s]+$/, '')
    if (candidate.endsWith(',')) candidate = candidate.slice(0, -1)
    for (let d = point.stack.length - 1; d >= 0; d--) {
      candidate += point.stack[d] === '{' ? '}' : ']'
    }
    const parsed = tryParseObject(candidate)
    if (parsed) return { value: parsed, repaired: true, error: null }
  }
  return { value: null, repaired: false, error: 'truncated JSON could not be repaired' }
}

function nextNonWs(s: string, from: number): string | null {
  for (let i = from; i < s.length; i++) {
    if (!/\s/.test(s[i])) return s[i]
  }
  return null
}

function tryParseObject(candidate: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}
