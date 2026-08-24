import Link from 'next/link'

/**
 * Shared back-affordance for every detail page (results, wizard, client
 * panel, admin): one consistent pattern instead of per-page variants.
 *
 * Server-safe (no hooks): usable from server pages directly; client pages
 * can render it too. Style follows the B scale via the Tailwind brand
 * mapping: 14px, muted, hover navy.
 *
 * Usage: <BackLink href="/audits"><T k="nav.audits" /></BackLink>
 */
export default function BackLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground no-underline transition-colors hover:text-primary"
    >
      <span aria-hidden>←</span>
      <span>{children}</span>
    </Link>
  )
}
