import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  valueColor?: string
  className?: string
}

export default function StatCard({ label, value, subtitle, valueColor, className }: StatCardProps) {
  return (
    <div className={cn('rounded-xl border bg-card p-5 text-center', className)}>
      <div className="mono-label mb-2">{label}</div>
      <div
        className="font-mono text-4xl font-bold"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )
}
