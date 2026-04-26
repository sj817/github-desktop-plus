import { motion } from 'framer-motion'
import { ReactNode } from 'react'

export function GlassCard({
  children,
  className = '',
  delay = 0,
  hoverable = true,
}: {
  children: ReactNode
  className?: string
  delay?: number
  hoverable?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: [0.4, 0, 0.2, 1] }}
      className={['glass p-6', hoverable && 'glass-hover', className].filter(Boolean).join(' ')}
    >
      {children}
    </motion.div>
  )
}
