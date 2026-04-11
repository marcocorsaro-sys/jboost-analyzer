import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDomain(input: string): string {
  let domain = input.trim().toLowerCase()
  domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '')
  domain = domain.replace(/\/.*$/, '')
  return domain
}

export function isValidDomain(domain: string): boolean {
  const pattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/
  return pattern.test(formatDomain(domain))
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatScore(score: number | null): string {
  if (score === null || score === undefined) return 'N/A'
  return Math.round(score).toString()
}
