import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Tooltip } from '@heroui/react'

interface Item { to: string; label: string; icon: string }

const items: Item[] = [
  { to: '/', label: '仪表盘', icon: '◐' },
  { to: '/locales', label: '语言包', icon: '✦' },
  { to: '/logs', label: '日志', icon: '⌘' },
  { to: '/settings', label: '设置', icon: '⚙' },
]

export function Sidebar() {
  return (
    <aside className="glass m-4 mr-0 flex w-[230px] shrink-0 flex-col p-5">
      <div className="mb-8 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary-500/15 text-lg text-primary-500 shadow-glow-sm">
          ✦
        </div>
        <div className="flex-1">
          <div className="title-grad text-[15px] font-semibold leading-none tracking-wide">
            GitHub Desktop Plus
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-default-400">
            Control Plane
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1.5">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.to === '/'}>
            {({ isActive }) => (
              <motion.div
                whileHover={{ x: 2 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className={[
                  'group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] transition',
                  isActive
                    ? 'bg-primary-500/15 text-primary-500 shadow-glow-sm'
                    : 'text-default-600 hover:bg-foreground/5 hover:text-foreground',
                ].join(' ')}
              >
                <span className="text-base opacity-90">{it.icon}</span>
                <span className="font-medium">{it.label}</span>
                {isActive && (
                  <motion.span
                    layoutId="nav-bar"
                    className="absolute inset-y-1.5 right-1 w-[3px] rounded-full bg-primary-500"
                  />
                )}
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto pt-6">
        <Tooltip content="GDP 运行在本机 7788 端口" placement="right">
          <div className="rounded-xl border border-divider/60 bg-content2/40 p-3 text-[11px] text-default-400 backdrop-blur">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-block h-2 w-2 animate-breath rounded-full bg-emerald-400" />
              <span className="uppercase tracking-[0.2em]">在线</span>
            </div>
            <div className="font-mono text-[10.5px] opacity-70">127.0.0.1:7788</div>
          </div>
        </Tooltip>
      </div>
    </aside>
  )
}
