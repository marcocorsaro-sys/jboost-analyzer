import {
  Home,
  Zap,
  Building2,
  MessageSquare,
  BookOpen,
  User,
  type LucideIcon,
} from 'lucide-react'

import type { TranslationKey } from '@/lib/i18n'

export interface NavItem {
  href: string
  labelKey: TranslationKey
  icon: LucideIcon
}

/**
 * Primary destinations shown in the desktop Icon Rail.
 * The same entries are also surfaced in the mobile tab bar
 * (with the last slot replaced by "Me").
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: '/home', labelKey: 'nav.home', icon: Home },
  { href: '/pre-sales', labelKey: 'nav.pre_sales', icon: Zap },
  { href: '/clients', labelKey: 'nav.clients', icon: Building2 },
  { href: '/ask-j', labelKey: 'nav.ask_j', icon: MessageSquare },
  { href: '/library', labelKey: 'nav.library', icon: BookOpen },
]

/**
 * Mobile bottom-bar tabs. Same order as PRIMARY_NAV but with the
 * fifth slot reserved for the user's profile menu.
 */
export const MOBILE_NAV: NavItem[] = [
  { href: '/home', labelKey: 'nav.home', icon: Home },
  { href: '/pre-sales', labelKey: 'nav.pre_sales', icon: Zap },
  { href: '/clients', labelKey: 'nav.clients', icon: Building2 },
  { href: '/ask-j', labelKey: 'nav.ask_j', icon: MessageSquare },
  { href: '/settings', labelKey: 'nav.me', icon: User },
]
