'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

export interface ContextualTab {
  label: string
  href: string
  /** Optional badge count shown after the label */
  count?: number
}

interface ContextualTabsProps {
  tabs: ContextualTab[]
  className?: string
}

/**
 * Horizontal tab row rendered above the main content of a section.
 * Relies on `usePathname()` for active state, so the caller just
 * needs to pass the list of tabs and their hrefs.
 *
 * On mobile, horizontal-scrolls when the tabs overflow the viewport.
 */
export function ContextualTabs({ tabs, className }: ContextualTabsProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (pathname === href) return true
    // Only mark as active on a prefix match if the prefix is not the dashboard root.
    if (href !== '/' && pathname.startsWith(href + '/')) return true
    return false
  }

  if (tabs.length === 0) return null

  return (
    <div
      className={cn(
        'relative -mx-4 mb-4 border-b md:-mx-6 md:mb-6',
        className
      )}
    >
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto px-4 md:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const active = isActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative whitespace-nowrap px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                active && 'text-foreground'
              )}
            >
              <span className="inline-flex items-center gap-2">
                {tab.label}
                {typeof tab.count === 'number' && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {tab.count}
                  </span>
                )}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
