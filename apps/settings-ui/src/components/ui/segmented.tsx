import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  className?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
}

export function Segmented<T extends string>({ value, onValueChange, options, className, 'aria-label': label }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('gdp-segmented', className)}>
      {options.map(option => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
