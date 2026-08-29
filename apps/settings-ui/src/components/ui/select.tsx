import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePortalContainer } from '@/bridge/context'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  /** Falls back to `value` for keyboard type-ahead when the label is a node. */
  text?: string
  description?: ReactNode
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
          'inline-flex h-[32px] items-center justify-between gap-2.5 rounded-lg border border-line bg-elevated',
          'px-3 text-[12.5px] font-medium text-fg shadow-xs outline-none select-none dark:bg-field',
          'transition-[border-color,background-color,box-shadow] duration-150',
          'hover:border-line-strong hover:bg-hover data-[popup-open]:border-accent data-[popup-open]:ring-2 data-[popup-open]:ring-accent/20',
          'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20',
          'data-[disabled]:opacity-50',
          className
        )}
      >
        <BaseSelect.Value className="truncate">
          {selected ? selected.label : <span className="text-fg-subtle">{placeholder}</span>}
        </BaseSelect.Value>
        <BaseSelect.Icon className="text-fg-subtle transition-transform duration-200 data-[popup-open]:rotate-180">
          <ChevronDown className="size-3.5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-50">
          <BaseSelect.Popup
            className={cn(
              'max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border border-line bg-elevated/95 p-1.5 backdrop-blur-md',
              'shadow-lg outline-none origin-[var(--transform-origin)]',
              'data-[starting-style]:animate-pop-in data-[ending-style]:animate-pop-out'
            )}
          >
            {options.map(option => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                label={option.text ?? option.value}
                className={cn(
                  'relative flex cursor-pointer items-center gap-2 rounded-lg py-2 pr-2.5 pl-7',
                  'text-[12.5px] font-medium text-fg outline-none select-none transition-colors duration-100',
                  'data-[highlighted]:bg-hover'
                )}
              >
                <BaseSelect.ItemIndicator className="absolute left-2 text-accent">
                  <Check className="size-3.5" strokeWidth={2.5} />
                </BaseSelect.ItemIndicator>
                <span className="min-w-0 flex-1">
                  <BaseSelect.ItemText className="block truncate">{option.label}</BaseSelect.ItemText>
                  {option.description ? (
                    <span className="block truncate text-[11px] font-normal text-fg-subtle mt-0.5">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
