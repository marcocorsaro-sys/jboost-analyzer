import {
  Home,
  Plus,
  ClipboardList,
  Building2,
  Settings,
  LayoutDashboard,
  Zap,
  Search,
  FileText,
  type LucideIcon,
} from 'lucide-react'

import type { TranslationKey } from '@/lib/i18n'

export interface NavItem {
  href: string
  labelKey: TranslationKey
  icon: LucideIcon
}

/**
 * The five Bibbia entries (UX-UI 04, sheet "Navigation & Screens"), in the
 * exact order the sheet lists them:
 *   Home · New audit · Audits · Clients · Settings
 *
 * Shown in the desktop Icon Rail AND in the mobile tab bar (five slots).
 * Nothing else belongs here: V1 destinations live in LEGACY_NAV below,
 * behind the NEXT_PUBLIC_JBA_LEGACY flag (lib/feature-flags).
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/home', labelKey: 'nav.home', icon: Home },
  { href: '/analyzer/v4', labelKey: 'nav.new_audit', icon: Plus },
  { href: '/audits', labelKey: 'nav.audits', icon: ClipboardList },
  { href: '/clients', labelKey: 'nav.clients', icon: Building2 },
  { href: '/settings', labelKey: 'nav.settings', icon: Settings },
]

/**
 * Mobile bottom-bar tabs — the Bibbia five fill the five slots exactly.
 */
export const MOBILE_NAV: NavItem[] = PRIMARY_NAV

/**
 * V1 destinations PARKED behind the legacy flag (Comparazione 07: not part
 * of the one-off V4 flow). Routes remain deployed — reachable by direct URL
 * even with the flag off — but only surface in the shell when
 * NEXT_PUBLIC_JBA_LEGACY=1 (collapsed "Legacy (V1)" section).
 *
 * Admin is deliberately NOT here: it stays reachable from Settings.
 */
export const LEGACY_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/pre-sales', labelKey: 'nav.pre_sales', icon: Zap },
  { href: '/analyzer', labelKey: 'nav.analyzeDomain', icon: Search },
  { href: '/results', labelKey: 'nav.results', icon: FileText },
  // Ask J e' PARCHEGGIATO anche fuori dal legacy shell: la route /ask-j ora
  // reindirizza a /home (Comparazione 07: non prioritaria per V4 one-off).
  // Voce rimossa: { href: '/ask-j', labelKey: 'nav.ask_j', icon: MessageSquare }
]

/**
 * Detail routes that belong to a nav section WITHOUT sharing its URL prefix.
 * /results/v4/<id> is the detail page of an audit, so the "Audits" entry must
 * stay highlighted there (the user never loses the sense of where they are).
 */
const SECTION_ALIASES: Record<string, string[]> = {
  '/audits': ['/results/v4'],
}

const matches = (prefix: string, pathname: string) =>
  pathname === prefix || pathname.startsWith(prefix + '/')

/**
 * Single active-state matcher shared by the Icon Rail and the Mobile Tab Bar,
 * so desktop and mobile always agree on which section is lit.
 *
 * Rules:
 *  - '/analyzer' (legacy V1) only matches itself — it must not light up while
 *    the user is on '/analyzer/v4' (New audit).
 *  - '/results' (legacy V1) must not match '/results/v4/...' — those detail
 *    pages belong to Audits.
 *  - '/audits' also matches its detail pages under '/results/v4'.
 */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === '/analyzer') return pathname === href
  if (href === '/results' && matches('/results/v4', pathname)) return false
  if (matches(href, pathname)) return true
  return (SECTION_ALIASES[href] ?? []).some((p) => matches(p, pathname))
}
