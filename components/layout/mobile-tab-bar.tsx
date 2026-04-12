'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'
import { MOBILE_NAV } from '@/components/layout/nav-items'
import { useLocale } from '@/lib/i18n'

export function MobileTabBar() {
  const pathname = usePathname()
  const { t } = useLocale()

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-stretch border-t bg-background md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {MOBILE_NAV.map((item) => {
        const active = isActive(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={t(item.labelKey)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 px-1 text-muted-foreground transition-colors',
              active && 'text-primary'
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="text-[10px] font-medium leading-none">
              {t(item.labelKey)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
