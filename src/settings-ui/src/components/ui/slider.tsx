import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from '@/lib/utils'

interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  'aria-label'?: string
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  'aria-label': ariaLabel,
}: SliderProps) {
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={next => onValueChange(typeof next === 'number' ? next : (next[0] ?? min))}
      min={min}
      max={max}
      step={step}
      className={cn('flex w-full items-center', className)}
    >
      <BaseSlider.Control className="flex w-full items-center py-2">
        <BaseSlider.Track className="h-1 w-full rounded-full bg-surface-hover select-none">
          <BaseSlider.Indicator className="rounded-full bg-accent select-none" />
          <BaseSlider.Thumb
            aria-label={ariaLabel}
            className={cn(
              'size-3.5 rounded-full border border-line bg-canvas shadow-sm outline-none select-none',
              'focus-visible:ring-2 focus-visible:ring-accent/40'
            )}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
