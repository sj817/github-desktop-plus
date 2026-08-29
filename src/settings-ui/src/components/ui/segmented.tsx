import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  className?: string
}

/** Single-select pill group — used where a dropdown would be overkill. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cn('flex items-center gap-0.5 rounded-md bg-surface p-0.5', className)}>
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'rounded-[5px] px-2 py-1 text-[12px] font-medium transition-colors',
              active
                ? 'bg-surface-alt text-fg shadow-sm'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
