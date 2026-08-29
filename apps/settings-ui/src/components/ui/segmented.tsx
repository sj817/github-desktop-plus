import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  className?: string
  size?: 'sm' | 'md'
}

/**
 * Single-select pill group — used where a dropdown would be overkill. The
 * selected pill is a single element that slides between options rather than
 * each option toggling its own background.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = 'md',
}: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  const [settled, setSettled] = useState(false)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!active) {
      setPill(null)
      return
    }
    setPill({ left: active.offsetLeft, width: active.offsetWidth })
    // First measurement lands without a transition, so nothing slides in from 0.
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [value, options])

  return (
    <div
      ref={listRef}
      role="group"
      className={cn(
        'relative isolate inline-flex items-center gap-0.5 rounded-[7px] bg-inset p-[3px]',
        className
      )}
    >
      {pill ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-[3px] bottom-[3px] -z-10 rounded-[5px] bg-elevated shadow-sm',
            settled && 'transition-[transform,width] duration-200 ease-[var(--ease-out-quart)]'
          )}
          style={{ width: pill.width, transform: `translateX(${pill.left - 3}px)` }}
        />
      ) : null}
      {options.map(option => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'relative rounded-[5px] font-medium whitespace-nowrap transition-colors duration-150',
              size === 'sm' ? 'h-[22px] px-2 text-[11.5px]' : 'h-6 px-2.5 text-[12px]',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
