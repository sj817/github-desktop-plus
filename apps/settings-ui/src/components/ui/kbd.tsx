import { cn } from '@/lib/utils'

/** A key cap, or a whole shortcut when given several keys. */
export function Kbd({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map(key => (
        <kbd
          key={key}
          className={cn(
            'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded px-1',
            'bg-black/[0.04] text-[10px] font-sans font-medium text-fg-muted',
            'border border-black/[0.08] dark:bg-white/[0.08] dark:border-white/[0.1] dark:text-fg-subtle',
            'shadow-none select-none'
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
