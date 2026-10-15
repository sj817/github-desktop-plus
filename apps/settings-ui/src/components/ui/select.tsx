import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePortalContainer } from '@/bridge/context'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
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

export function Select<T extends string>({ value, onValueChange, options, placeholder, className, disabled, 'aria-label': ariaLabel }: SelectProps<T>) {
  const container = usePortalContainer()
  const selected = options.find(option => option.value === value)
  return (
    <BaseSelect.Root value={value} onValueChange={next => { if (next !== null) onValueChange(next as T) }} disabled={disabled}>
      <BaseSelect.Trigger aria-label={ariaLabel} className={cn('gdp-select', className)}>
        <BaseSelect.Value className="gdp-select-value">{selected ? selected.label : placeholder}</BaseSelect.Value>
        <BaseSelect.Icon><ChevronDown /></BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="gdp-popup-positioner">
          <BaseSelect.Popup className="gdp-select-popup">
            {options.map(option => (
              <BaseSelect.Item key={option.value} value={option.value} label={option.text ?? (typeof option.label === 'string' ? option.label : option.value)} className="gdp-select-item">
                <BaseSelect.ItemIndicator className="gdp-select-check"><Check /></BaseSelect.ItemIndicator>
                <span>
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  {option.description ? <span className="gdp-select-description">{option.description}</span> : null}
                </span>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
