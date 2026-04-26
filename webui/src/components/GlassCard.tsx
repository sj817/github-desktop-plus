import { motion, type HTMLMotionProps } from 'framer-motion'
import { ReactNode } from 'react'

interface Props extends Omit<HTMLMotionProps<'div'>, 'ref'> {
  children: ReactNode
  delay?: number
  hoverable?: boolean
  className?: string
}

export function GlassCard({ children, className = '', delay = 0, hoverable = true, ...rest }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] }}
      className={['glass p-6', hoverable && 'glass-hover', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
