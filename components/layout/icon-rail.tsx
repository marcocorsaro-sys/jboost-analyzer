'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Bell, Globe, History, LogOut, Search, Settings, Shield } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PRIMARY_NAV, LEGACY_NAV } from '@/components/layout/nav-items'
import { showLegacy } from '@/lib/feature-flags'
import { useCommandPalette } from '@/components/layout/command-palette'
import { useLocale, LOCALE_LABELS, type Locale } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/client'

interface IconRailProps {
  userEmail?: string
  isAdmin?: boolean
  notificationCount?: number
}

export function IconRail({
  userEmail,
  isAdmin = false,
  notificationCount = 0,
}: IconRailProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { locale, setLocale, t } = useLocale()
  const LOCALES: Locale[] = ['en', 'it', 'es', 'fr']
  const { setOpen } = useCommandPalette()

  const isActive = (href: string) => {
    // Legacy /analyzer must not light up while the user is on /analyzer/v4
    // (New audit): the V1 entry only matches itself.
    if (href === '/analyzer') return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

  const legacyEnabled = showLegacy()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = (userEmail || 'J')
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase()

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className="sticky top-0 z-30 hidden h-screen w-14 shrink-0 flex-col items-center border-r bg-background py-3 md:flex"
        aria-label="Primary navigation"
      >
        {/* Logo — J·Boost mark: the JAKALA navy "goccia" with a white J. */}
        <Link
          href="/home"
          className="mb-2 flex h-9 w-9 items-center justify-center"
          aria-label="J·Boost"
        >
          <svg viewBox="0 0 36 36" className="h-9 w-9" aria-hidden>
            {/* drop */}
            <path
              d="M18 2c7 9.5 11 15.7 11 21a11 11 0 1 1-22 0c0-5.3 4-11.5 11-21Z"
              className="fill-primary"
            />
            <text
              x="18"
              y="27.5"
              textAnchor="middle"
              fontSize="13"
              fontWeight="700"
              fill="#ffffff"
            >
              J
            </text>
          </svg>
        </Link>

        <Separator className="my-2 w-8" />

        {/* Primary nav */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {PRIMARY_NAV.map((item) => {
            const active = isActive(item.href)
            const Icon = item.icon
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-label={t(item.labelKey)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                      active && 'bg-accent text-accent-foreground'
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-6 w-0.5 -translate-x-2 -translate-y-1/2 rounded-full bg-primary"
                      />
                    )}
                    <Icon className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
              </Tooltip>
            )
          })}

          {/* Legacy (V1) — collapsed section, only with NEXT_PUBLIC_JBA_LEGACY=1.
              The parked V1 destinations (Comparazione 07) live in a dropdown
              so the rail stays five-entry Bibbia-clean. */}
          {legacyEnabled && (
            <>
              <Separator className="my-2 w-8" />
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t('nav.legacy')}
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                          LEGACY_NAV.some((i) => isActive(i.href)) &&
                            'bg-accent text-accent-foreground'
                        )}
                      >
                        <History className="h-5 w-5" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t('nav.legacy')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="right" align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    {t('nav.legacy')}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {LEGACY_NAV.map((item) => {
                    const Icon = item.icon
                    return (
                      <DropdownMenuItem
                        key={item.href}
                        onClick={() => router.push(item.href)}
                      >
                        <Icon />
                        <span>{t(item.labelKey)}</span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          <Separator className="my-2 w-8" />

          {/* Notifications — not part of the V4 one-off flow (Comparazione 07):
              parked behind the legacy flag, never deleted. */}
          {legacyEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('nav.notifications')}
                  className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Bell className="h-5 w-5" />
                  {notificationCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                      {notificationCount > 9 ? '9+' : notificationCount}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t('nav.notifications')}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Command palette trigger */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('nav.search')}
                onClick={() => setOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Search className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>{t('nav.search')}</span>
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </TooltipContent>
          </Tooltip>
        </nav>

        {/* Account menu */}
        <div className="mt-auto pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('nav.account')}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs font-medium">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              {userEmail && (
                <>
                  <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                    {userEmail}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Settings />
                <span>{t('nav.settings')}</span>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => router.push('/admin')}>
                  <Shield />
                  <span>{t('nav.admin')}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Globe />
                  <span>{locale.toUpperCase()}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {LOCALES.map((l) => (
                    <DropdownMenuItem
                      key={l}
                      onClick={() => setLocale(l)}
                      className={locale === l ? 'text-primary font-semibold' : ''}
                    >
                      <span className="w-6 font-mono text-xs font-bold uppercase">{l}</span>
                      <span>{LOCALE_LABELS[l]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut />
                <span>{t('nav.logout')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  )
}
