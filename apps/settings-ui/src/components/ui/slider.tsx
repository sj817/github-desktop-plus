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

export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, className, 'aria-label': ariaLabel }: SliderProps) {
  return (
    <BaseSlider.Root value={value} onValueChange={next => onValueChange(typeof next === 'number' ? next : (next[0] ?? min))} min={min} max={max} step={step} className={cn('gdp-slider', className)}>
      <BaseSlider.Control className="gdp-slider-control">
        <BaseSlider.Track className="gdp-slider-track">
          <BaseSlider.Indicator className="gdp-slider-indicator" />
          <BaseSlider.Thumb aria-label={ariaLabel} className="gdp-slider-thumb" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
