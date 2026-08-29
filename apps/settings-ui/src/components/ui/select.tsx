import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePortalContainer } from '@/bridge/context'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  /** Falls back to `value` for keyboard type-ahead when the label is a node. */
  text?: string
}

interface SelectProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<SelectOption<T>>
  placeholder?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Popups portal into the app root rather than `document.body`: in production
 * the UI sits inside a modal `<dialog>`, and anything outside it is inert.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const container = usePortalContainer()
  const selected = options.find(option => option.value === value)

  return (
    <BaseSelect.Root
      value={value}
      onValueChange={next => onValueChange(next as T)}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-8 items-center justify-between gap-2 rounded-md border border-line',
          'bg-surface-alt px-2.5 text-[13px] text-fg transition-colors outline-none select-none',
          'hover:border-fg-subtle focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25',
          'data-[disabled]:opacity-60',
          className
        )}
      >
        <BaseSelect.Value className="truncate">
          {selected ? selected.label : <span className="text-fg-subtle">{placeholder}</span>}
        </BaseSelect.Value>
        <BaseSelect.Icon>
          <ChevronsUpDown className="size-3.5 text-fg-subtle" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup
            className={cn(
              'max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-line',
              'bg-canvas p-1 shadow-lg shadow-black/10 outline-none',
              'origin-[var(--transform-origin)]',
              'data-[starting-style]:animate-[gdp-pop-in_120ms_ease-out]',
              'data-[ending-style]:animate-[gdp-pop-out_100ms_ease-in]'
            )}
          >
            {options.map(option => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                label={option.text ?? option.value}
                className={cn(
                  'relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-6',
                  'text-[13px]',
                  'text-fg outline-none select-none',
                  'data-[highlighted]:bg-surface-hover'
                )}
              >
                <BaseSelect.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5 text-accent" />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText className="truncate">{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
