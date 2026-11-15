/**
 * Telegram bot — pure text helpers (no I/O).
 */

/** Telegram refuses messages over 4096 characters. */
export const TELEGRAM_MAX = 4000

/** Split a long answer on paragraph / line / word boundaries, never mid-word when avoidable. */
export function splitMessage(text: string, max = TELEGRAM_MAX): string[] {
  const clean = text.trim()
  if (clean.length === 0) return []
  if (clean.length <= max) return [clean]
  const parts: string[] = []
  let rest = clean
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = window.lastIndexOf('\n\n')
    if (cut < max * 0.4) cut = window.lastIndexOf('\n')
    if (cut < max * 0.4) cut = window.lastIndexOf(' ')
    if (cut < max * 0.4) cut = max
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts.filter(Boolean)
}

/** Alphabet without look-alikes (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LINK_CODE_LENGTH = 8
export const LINK_CODE_TTL_MINUTES = 10

/** Random link code from a byte source (injectable for tests). */
export function makeLinkCode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < LINK_CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

/** Code as people type it: spaces, dashes and case ignored. Null = not a valid code shape. */
export function normalizeLinkCode(value: string): string | null {
  const code = value.replace(/[\s-]/g, '').toUpperCase()
  if (code.length !== LINK_CODE_LENGTH) return null
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null
  return code
}

export type BotCommand =
  | { kind: 'start' }
  | { kind: 'help' }
  | { kind: 'link'; code: string | null }
  | { kind: 'unlink' }
  | { kind: 'reset' }
  | { kind: 'cancel' }
  | { kind: 'text'; text: string }

/** Parse a Telegram message into a command or plain text. `/cmd@botname` is accepted. */
export function parseCommand(text: string): BotCommand {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return { kind: 'text', text: trimmed }
  const [head, ...rest] = trimmed.split(/\s+/)
  const cmd = head.slice(1).split('@')[0].toLowerCase()
  const arg = rest.join(' ')
  switch (cmd) {
    case 'start':
      return { kind: 'start' }
    case 'help':
    case 'aiuto':
      return { kind: 'help' }
    case 'collega':
    case 'link':
      return { kind: 'link', code: normalizeLinkCode(arg) }
    case 'scollega':
    case 'unlink':
      return { kind: 'unlink' }
    case 'nuovo':
    case 'reset':
      return { kind: 'reset' }
    case 'annulla':
    case 'cancel':
      return { kind: 'cancel' }
    default:
      return { kind: 'help' }
  }
}

/** Constant-time string comparison (webhook secret). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** One line per argument, for the confirmation message. */
export function describeArgs(args: unknown, maxValue = 160): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const lines: string[] = []
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    let shown = typeof value === 'string' ? value : JSON.stringify(value)
    if (shown.length > maxValue) shown = `${shown.slice(0, maxValue)}…`
    lines.push(`• ${key}: ${shown}`)
  }
  return lines.join('\n')
}
