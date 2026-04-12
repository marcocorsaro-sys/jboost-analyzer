import { cn } from '@/lib/utils'

interface SectionCardProps {
  children: React.ReactNode
  title?: string
  className?: string
}

export default function SectionCard({ children, title, className }: SectionCardProps) {
  return (
    <div className={cn('rounded-xl border bg-card p-5', className)}>
      {title && (
        <h2 className="mb-4 font-mono text-[13px] font-semibold uppercase tracking-wider text-primary">
          {title}
        </h2>
      )}
      {children}
    </div>
  )
}
