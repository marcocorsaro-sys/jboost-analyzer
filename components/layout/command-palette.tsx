'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  Building2,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  Shield,
  Sparkles,
  UserPlus,
} from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { PRIMARY_NAV } from '@/components/layout/nav-items'
import { useLocale } from '@/lib/i18n'

interface CommandPaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const CommandPaletteContext =
  React.createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = React.useContext(CommandPaletteContext)
  if (!ctx) {
    throw new Error(
      'useCommandPalette must be used within a CommandPaletteProvider'
    )
  }
  return ctx
}

interface CommandPaletteProviderProps {
  children: React.ReactNode
  isAdmin?: boolean
}

export function CommandPaletteProvider({
  children,
  isAdmin = false,
}: CommandPaletteProviderProps) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { setTheme } = useTheme()
  const { t } = useLocale()

  // Global keyboard shortcut: ⌘K / Ctrl+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  const runCommand = React.useCallback((command: () => unknown) => {
    setOpen(false)
    command()
  }, [])

  const value = React.useMemo<CommandPaletteContextValue>(
    () => ({ open, setOpen, toggle: () => setOpen((o) => !o) }),
    [open]
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('command.placeholder')} />
        <CommandList>
          <CommandEmpty>{t('command.empty')}</CommandEmpty>

          <CommandGroup heading={t('command.navigation')}>
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.href}
                  value={`${t(item.labelKey)} ${item.href}`}
                  onSelect={() => runCommand(() => router.push(item.href))}
                >
                  <Icon />
                  <span>{t(item.labelKey)}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t('command.quick_actions')}>
            <CommandItem
              value="new-prospect"
              onSelect={() => runCommand(() => router.push('/clients/new'))}
            >
              <Plus />
              <span>{t('command.new_prospect')}</span>
            </CommandItem>
            <CommandItem
              value="new-analysis"
              onSelect={() => runCommand(() => router.push('/analyzer'))}
            >
              <Sparkles />
              <span>{t('command.new_analysis')}</span>
            </CommandItem>
            <CommandItem
              value="invite-member"
              onSelect={() => runCommand(() => router.push('/settings'))}
            >
              <UserPlus />
              <span>{t('command.invite_member')}</span>
            </CommandItem>
            <CommandItem
              value="ask-j"
              onSelect={() => runCommand(() => router.push('/ask-j'))}
            >
              <MessageSquare />
              <span>{t('nav.ask_j')}</span>
            </CommandItem>
            <CommandItem
              value="clients"
              onSelect={() => runCommand(() => router.push('/clients'))}
            >
              <Building2 />
              <span>{t('nav.clients')}</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t('command.settings')}>
            <CommandItem
              value="toggle-theme-system"
              onSelect={() => runCommand(() => setTheme('system'))}
            >
              <Moon />
              <span>{t('command.toggle_theme')}</span>
              <CommandShortcut>{t('theme.system')}</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="toggle-theme-light"
              onSelect={() => runCommand(() => setTheme('light'))}
            >
              <Moon />
              <span>{t('theme.light')}</span>
            </CommandItem>
            <CommandItem
              value="toggle-theme-dark"
              onSelect={() => runCommand(() => setTheme('dark'))}
            >
              <Moon />
              <span>{t('theme.dark')}</span>
            </CommandItem>
            <CommandItem
              value="account-settings"
              onSelect={() => runCommand(() => router.push('/settings'))}
            >
              <Settings />
              <span>{t('nav.account')}</span>
            </CommandItem>
            {isAdmin && (
              <CommandItem
                value="admin-panel"
                onSelect={() => runCommand(() => router.push('/admin'))}
              >
                <Shield />
                <span>{t('nav.admin')}</span>
              </CommandItem>
            )}
            <CommandItem
              value="logout"
              onSelect={() => runCommand(() => router.push('/logout'))}
            >
              <LogOut />
              <span>{t('nav.logout')}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  )
}
