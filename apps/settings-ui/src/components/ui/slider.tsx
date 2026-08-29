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
      <BaseSlider.Control className="group/slider flex w-full cursor-pointer items-center py-2">
        <BaseSlider.Track className="relative h-1.5 w-full rounded-full bg-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] select-none">
          <BaseSlider.Indicator className="h-full rounded-full bg-accent select-none" />
          <BaseSlider.Thumb
            aria-label={ariaLabel}
            className={cn(
              'size-4 rounded-full bg-white border-2 border-accent outline-none select-none',
              'shadow-sm transition-[transform,box-shadow] duration-150',
              'group-hover/slider:scale-110 data-[dragging]:scale-120',
              'focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1'
            )}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
