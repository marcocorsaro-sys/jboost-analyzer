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
