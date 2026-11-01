/** Only same-site relative paths may be used as a post-login destination. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  if (/[\r\n]/.test(value)) return null
  return value
}
