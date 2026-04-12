'use client'

import * as React from 'react'

import { IconRail } from '@/components/layout/icon-rail'
import { MobileTabBar } from '@/components/layout/mobile-tab-bar'
import { CommandPaletteProvider } from '@/components/layout/command-palette'

interface ShellProps {
  children: React.ReactNode
  userEmail?: string
  isAdmin?: boolean
  notificationCount?: number
}

/**
 * Application shell. Provides:
 *  - Desktop Icon Rail (md+)
 *  - Mobile Bottom Tab Bar (<md)
 *  - Global Command Palette (⌘K) available from any page
 *
 * The shell is a client component because the Icon Rail, Mobile Tab Bar
 * and Command Palette all read `usePathname()` / manage keyboard events.
 * The children passed in may still be server components.
 */
export function Shell({
  children,
  userEmail,
  isAdmin = false,
  notificationCount = 0,
}: ShellProps) {
  return (
    <CommandPaletteProvider isAdmin={isAdmin}>
      <div className="flex min-h-screen bg-background text-foreground">
        <IconRail
          userEmail={userEmail}
          isAdmin={isAdmin}
          notificationCount={notificationCount}
        />
        <div className="flex min-h-screen flex-1 flex-col pb-16 md:pb-0">
          {children}
        </div>
      </div>
      <MobileTabBar />
    </CommandPaletteProvider>
  )
}
